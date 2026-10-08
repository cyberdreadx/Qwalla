/**
 * Network binding of signatures.
 *
 * Every payload Qwalla signs for a RougeChain node — transactions and signed requests (messenger,
 * mail, names, votes, contracts) — carries `chainId`, the exact chain id of the network it is for.
 * Payloads are serialized with sorted keys, so the field is inside the signed bytes and the
 * signature commits to that one network. Nodes refuse a payload whose `chainId` is not theirs.
 *
 * The chain id comes from the network config (`constants/networks.ts`) and is cross-checked once
 * per session against what the node reports (`GET /api/health` → `chain_id`). If they disagree,
 * signing and submitting on that network are refused until the app restarts.
 */
import {
  ChainIdMismatchError as SdkChainIdMismatchError,
  MAINNET_CHAIN_ID,
  TESTNET_CHAIN_ID,
  bindWalletToChain,
  signRequest,
  type SignedTx,
} from '@rougechain/sdk';

import { NETWORKS, type NetworkId } from '@/constants/networks';

// The chain ids themselves come from @rougechain/sdk (>= 1.15.0), so Qwalla, the SDK and the site
// can never disagree on them.
export { MAINNET_CHAIN_ID, TESTNET_CHAIN_ID };

/**
 * Thrown when the node reports a different chain id than the network config expects. A subclass of
 * the SDK's `ChainIdMismatchError` (same `code`, `"CHAIN_ID_MISMATCH"`), so one `instanceof` check
 * covers refusals from Qwalla's own check and from the SDK client.
 */
export class ChainIdMismatchError extends SdkChainIdMismatchError {
  constructor(
    readonly network: NetworkId,
    expected: string,
    readonly reported: string,
  ) {
    super(expected, reported);
    this.message = `Refusing to sign: ${NETWORKS[network].label} expects chain id "${expected}" but the node reports "${reported}".`;
    this.name = 'ChainIdMismatchError';
  }
}

/** Per network: the session check (in flight or done). */
const checks = new Map<NetworkId, Promise<string | null>>();
/** Per network: the chain id a node reported when it disagreed with the config. */
const mismatches = new Map<NetworkId, string>();
/** Per network without a configured id (devnet): the id its node reported. */
const adopted = new Map<NetworkId, string>();

async function fetchReportedChainId(api: string, fetchFn: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchFn(`${api.replace(/\/+$/, '')}/health`);
    if (!res.ok) return null;
    const data = (await res.json()) as { chain_id?: unknown };
    return typeof data?.chain_id === 'string' && data.chain_id ? data.chain_id : null;
  } catch {
    return null;
  }
}

/**
 * The chain id to sign for on `network`, without a network round trip: the configured id (or, on
 * a devnet, the id its node reported). Throws `ChainIdMismatchError` once the session check found
 * a disagreement. `null` only for a devnet that has not been reached yet.
 */
export function signingChainId(network: NetworkId): string | null {
  const configured = NETWORKS[network].chainId;
  const reported = mismatches.get(network);
  if (reported !== undefined && configured) {
    throw new ChainIdMismatchError(network, configured, reported);
  }
  return configured ?? adopted.get(network) ?? null;
}

/**
 * Cross-check `network`'s chain id with its node, once per session, and return the chain id to
 * sign for. Rejects with `ChainIdMismatchError` when the node reports another id. A node that
 * cannot be reached does not block (the node itself still refuses a payload for another network);
 * the check is retried on the next call.
 */
export async function verifyChainId(network: NetworkId, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const configured = NETWORKS[network].chainId;
  let check = checks.get(network);
  if (!check) {
    check = fetchReportedChainId(NETWORKS[network].api, fetchFn);
    checks.set(network, check);
  }
  const reported = await check;
  if (reported === null) {
    checks.delete(network); // unreachable: try again next time
    return signingChainId(network);
  }
  if (!configured) {
    adopted.set(network, reported);
    return reported;
  }
  if (reported !== configured) {
    mismatches.set(network, reported);
    throw new ChainIdMismatchError(network, configured, reported);
  }
  return configured;
}

/** `payload` with `chainId` set (unchanged when `chainId` is null). Never re-targets a payload. */
export function withChainId<T extends Record<string, unknown>>(payload: T, chainId: string | null): T {
  if (!chainId) return payload;
  const existing = payload.chainId;
  if (existing !== undefined && existing !== chainId) {
    throw new Error(`Refusing to sign: payload is for chain id "${String(existing)}", not "${chainId}".`);
  }
  return { ...payload, chainId };
}

/**
 * `wallet` bound to `chainId` (SDK `bindWalletToChain`): every SDK builder (`createSigned*`,
 * `signRequest`) called with the result puts `chainId` inside the signed bytes. Unchanged when
 * `chainId` is null (a devnet whose node has not been reached).
 */
export function bindWallet<W extends { publicKey: string; privateKey: string; chainId?: string }>(
  wallet: W,
  chainId: string | null,
): W {
  return chainId ? bindWalletToChain(wallet, chainId) : wallet;
}

/**
 * Sign a node payload with the network's chain id inside the signed bytes — the SDK's own
 * `signRequest` (`from`, `timestamp`, random `nonce`) on a wallet bound to `chainId`. A payload
 * that already names another chain id is refused.
 */
export function signNodePayload(
  wallet: { publicKey: string; privateKey: string },
  payload: Record<string, unknown>,
  chainId: string | null,
): SignedTx {
  return signRequest(bindWallet(wallet, chainId), withChainId(payload, chainId));
}

/** Human name of the network a chain id belongs to (approval screens). */
export function networkNameForChainId(chainId: unknown): string {
  if (typeof chainId !== 'string' || !chainId) return 'No network specified';
  for (const id of Object.keys(NETWORKS) as NetworkId[]) {
    const known = NETWORKS[id].chainId ?? adopted.get(id);
    if (known === chainId) return `RougeChain ${NETWORKS[id].label}`;
  }
  return `Unknown network (${chainId})`;
}

export type DappChainCheck =
  | { ok: true; status: 'match'; networkName: string }
  | { ok: true; status: 'missing'; networkName: string }
  | { ok: false; error: string };

/**
 * The network gate for a dApp `signTransaction` payload on the selected network:
 *  - `chainId` equal to the selected network's → allowed;
 *  - `chainId` present and different (or not a string) → refused;
 *  - no `chainId` (older dApps) → allowed with a visible warning, for now.
 */
export function checkDappChainId(payload: Record<string, unknown>, selected: NetworkId): DappChainCheck {
  let expected: string | null;
  try {
    expected = signingChainId(selected);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const selectedName = `RougeChain ${NETWORKS[selected].label}`;
  if (!('chainId' in payload) || payload.chainId === undefined) {
    return { ok: true, status: 'missing', networkName: selectedName };
  }
  const got = payload.chainId;
  if (typeof got !== 'string' || !got) {
    return { ok: false, error: 'chainId must be the chain id string of the network' };
  }
  if (!expected) {
    return { ok: false, error: `Cannot confirm the chain id of ${selectedName}: its node is not reachable.` };
  }
  if (got !== expected) {
    return {
      ok: false,
      error: `This request is for ${networkNameForChainId(got)}, but Qwalla is on ${selectedName}. Switch networks in Qwalla and try again.`,
    };
  }
  return { ok: true, status: 'match', networkName: selectedName };
}

/**
 * A `fetch` for the RougeChain client of `network`: every write (non-GET) request waits for the
 * session chain-id check and is refused when the node reports another chain id.
 */
export function chainCheckedFetch(network: NetworkId): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      await verifyChainId(network);
    }
    return fetch(input, init);
  }) as typeof fetch;
}

/** Test helper: forget the session state. */
export function resetChainIdChecks(): void {
  checks.clear();
  mismatches.clear();
  adopted.clear();
}
