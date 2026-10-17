/**
 * Post-send reconciliation for weak signal.
 *
 * On a flaky connection a transfer's broadcast can error or time out AFTER the
 * node already accepted it. If we just show "Failed", the user re-sends and
 * double-pays. So when a send errors, we poll the chain to check whether the
 * transfer actually landed before declaring failure.
 *
 * Match is on the address-scoped tx list (already only this wallet's txs): a
 * transfer to `to` of `amount` (raw base units) `token` that wasn't already
 * present before the send (`knownIds` baseline). Content + newness is specific
 * enough; a genuine failure simply never matches and the caller treats it as
 * failed (safe default — the user can retry).
 */
import { rc } from '@/lib/rougechain';
import { EVM_CHAINS, getChain, rpc } from '@/lib/evm-rpc';

interface TxLite {
  txId: string;
  to: string;
  amount: number;
  token: string;
  txType: string;
}

const pick = (...vals: unknown[]): unknown => vals.find((v) => v !== undefined && v !== null);

/** Extract the fields we match on, mirroring the wallet's tx normalizer. */
function extractTx(entry: Record<string, unknown>): TxLite {
  const inner = (entry.tx ?? {}) as Record<string, unknown>;
  const payload = (inner.payload ?? {}) as Record<string, unknown>;
  return {
    txId: String(pick(entry.txId, entry.tx_id, entry.hash, entry.id) ?? ''),
    to: String(
      pick(payload.to_pub_key_hex, payload.toPubKeyHex, payload.to, payload.recipient, inner.to, entry.to) ?? '',
    ),
    amount: Number(pick(payload.amount, payload.amount_in, inner.amount, entry.amount) ?? NaN),
    token: String(pick(payload.token_symbol, payload.tokenSymbol, payload.token, inner.token) ?? 'XRGE'),
    txType: String(pick(inner.tx_type, inner.txType, inner.type, entry.type) ?? '').toLowerCase(),
  };
}

async function fetchRecentTxEntries(address: string): Promise<Record<string, unknown>[]> {
  const raw = await rc.get(`/address/${encodeURIComponent(address)}/transactions?limit=25`);
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const found = o.txs ?? o.transactions ?? o.data;
    if (Array.isArray(found)) return found as Record<string, unknown>[];
  }
  return [];
}

/**
 * The tx ids currently visible for `address` — a baseline so reconcileSend only
 * counts a NEW matching tx as "landed" (not an identical older one). Fire this
 * just before broadcasting and don't await it on the happy path. Never throws;
 * returns null if the baseline couldn't be fetched (reconcile then matches on
 * content alone).
 */
export async function fetchRecentTxIds(address: string): Promise<Set<string> | null> {
  try {
    const ids = (await fetchRecentTxEntries(address)).map((e) => extractTx(e).txId).filter(Boolean);
    return new Set(ids);
  } catch {
    return null;
  }
}

export interface ReconcileParams {
  /** Sender's rouge1 address (the address-scoped endpoint). */
  address: string;
  /** Recipient exactly as sent. Omit to match on amount/token/type only (e.g. a shield, whose "to" is a commitment). */
  to?: string;
  /** Amount in raw base units (what was broadcast). */
  amount: number;
  /** Token symbol (defaults to XRGE). */
  token: string;
  /** Require the tx type to contain this substring (e.g. "shield"). */
  txTypeIncludes?: string;
  /** Tx ids present before the send, from fetchRecentTxIds. */
  knownIds?: Set<string> | null;
  /** How long to keep checking (default 25s). */
  timeoutMs?: number;
  /** Delay between polls (default 4s). */
  intervalMs?: number;
}

function amountsMatch(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  // Amounts are raw integer base units, so require an exact match — with only a
  // tiny relative tolerance to absorb float rounding on values beyond 2^53.
  return Math.abs(a - b) <= Math.abs(b) * 1e-9;
}

/**
 * Poll for up to `timeoutMs` to confirm the transfer landed. Returns true as
 * soon as a matching new transfer appears, false if none is seen in the window.
 * Never throws.
 */
export async function reconcileSend(p: ReconcileParams): Promise<boolean> {
  const timeoutMs = p.timeoutMs ?? 25_000;
  const intervalMs = p.intervalMs ?? 4_000;
  const toWant = p.to?.trim().toLowerCase();
  const tokenWant = (p.token || 'XRGE').toLowerCase();
  const typeWant = p.txTypeIncludes?.toLowerCase();
  const deadline = Date.now() + timeoutMs;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  for (;;) {
    try {
      for (const e of await fetchRecentTxEntries(p.address)) {
        const tx = extractTx(e);
        if (p.knownIds && tx.txId && p.knownIds.has(tx.txId)) continue; // already existed
        if (toWant !== undefined && tx.to.toLowerCase() !== toWant) continue;
        if (typeWant && !tx.txType.includes(typeWant)) continue;
        if ((tx.token || 'XRGE').toLowerCase() !== tokenWant) continue;
        if (!amountsMatch(tx.amount, p.amount)) continue;
        return true;
      }
    } catch {
      /* transient — keep polling until the deadline */
    }
    if (Date.now() + intervalMs >= deadline) return false;
    await sleep(intervalMs);
  }
}

// ── Base / EVM ────────────────────────────────────────────────────────────

/** The account's transaction count (nonce) at `tag`, or null if unreachable. */
export async function getEvmNonce(
  chainId: number,
  address: string,
  tag: 'latest' | 'pending' = 'latest',
): Promise<number | null> {
  try {
    const chain = getChain(chainId) ?? EVM_CHAINS[8453];
    const hex = await rpc<string>(chain.rpcUrl, 'eth_getTransactionCount', [address, tag]);
    const n = parseInt(hex, 16);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Reconcile a Base send whose broadcast errored. A tx that reached the mempool
 * or a block bumps the account nonce, so if the latest/pending count rose above
 * the pre-send value, a tx from this account is in flight — treat the send as
 * done rather than let the user re-send (double-pay). `nonceBefore` is the
 * `latest` count captured before broadcasting. Never throws.
 */
export async function reconcileBaseSend(p: {
  chainId: number;
  address: string;
  nonceBefore: number | null;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<boolean> {
  if (p.nonceBefore == null) return false;
  const timeoutMs = p.timeoutMs ?? 30_000;
  const intervalMs = p.intervalMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  for (;;) {
    const [latest, pending] = await Promise.all([
      getEvmNonce(p.chainId, p.address, 'latest'),
      getEvmNonce(p.chainId, p.address, 'pending'),
    ]);
    if ((latest != null && latest > p.nonceBefore) || (pending != null && pending > p.nonceBefore)) {
      return true;
    }
    if (Date.now() + intervalMs >= deadline) return false;
    await sleep(intervalMs);
  }
}
