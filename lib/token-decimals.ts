import { getActiveNetworkId, rc } from '@/lib/rougechain';
import { formatNumber, setDynamicTokenDecimals } from '@/lib/format';

/**
 * Token decimals, from the node's `GET /api/tokens` (the source of truth), with exact
 * (BigInt, no float drift) conversion between raw integer base units and human amounts.
 *
 * Balances and amounts on RougeChain are integer base units. Each token's `decimals` says where
 * the point goes: XRGE 0 (native XRGE is already in XRGE units), qBTC 8, qETH 6, qUSDC 6, and 0
 * for tokens created on RougeChain. We fetch the map once per session (refreshed on network
 * switch) and fall back to a built-in map if the call fails — never guessing 18.
 */

// Built-in fallback for the bridge tokens; everything else is 0 until /api/tokens is read.
const FALLBACK: Record<string, number> = { QBTC: 8, QETH: 6, QUSDC: 6 };

let cache: Record<string, number> | null = null;
let cachedNetwork: string | null = null;
let inflight: Promise<void> | null = null;

/** Fetch + cache the symbol→decimals map for the active network (once, unless `force`). */
export async function loadTokenDecimals(force = false): Promise<void> {
  const net = getActiveNetworkId();
  if (!force && cache && cachedNetwork === net) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const data = (await rc.get('/tokens')) as unknown;
      const list = (Array.isArray(data)
        ? data
        : ((data as { tokens?: unknown[]; data?: unknown[] })?.tokens ??
           (data as { data?: unknown[] })?.data ??
           [])) as Record<string, unknown>[];
      const map: Record<string, number> = {};
      for (const t of list) {
        const sym = String(t?.symbol ?? t?.token_symbol ?? t?.tokenSymbol ?? '').toUpperCase();
        const d = Number(t?.decimals ?? t?.token_decimals);
        if (sym && Number.isInteger(d) && d >= 0 && d <= 30) map[sym] = d;
      }
      if (Object.keys(map).length) {
        cache = map;
        cachedNetwork = net;
        setDynamicTokenDecimals(map); // so l1ToHuman / formatL1Human use real decimals too
      }
    } catch {
      /* keep the fallback — never block on this */
    }
  })();
  try {
    await inflight;
  } finally {
    inflight = null;
  }
}

/** Decimals for `symbol`: the fetched value, else the built-in fallback, else 0. Never 18. */
export function tokenDecimals(symbol: string): number {
  const s = (symbol || '').toUpperCase();
  if (cache && s in cache) return cache[s];
  return FALLBACK[s] ?? 0;
}

/** Test/reset helper. */
export function resetTokenDecimals(): void {
  cache = null;
  cachedNetwork = null;
  inflight = null;
}

/**
 * Exact human string from integer base units — BigInt math, trailing zeros trimmed. `raw` may be
 * a number, a bigint, or a string of integer units (use a string for values above 2^53).
 */
export function formatUnits(raw: number | string | bigint, decimals: number): string {
  let u: bigint;
  try {
    if (typeof raw === 'bigint') u = raw;
    else if (typeof raw === 'number') u = BigInt(Math.trunc(raw));
    else u = BigInt((String(raw).trim().split('.')[0] || '0') || '0');
  } catch {
    return '0';
  }
  const neg = u < 0n;
  if (neg) u = -u;
  if (decimals <= 0) return (neg ? '-' : '') + u.toString();
  const s = u.toString().padStart(decimals + 1, '0');
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return (neg ? '-' : '') + (frac ? `${int}.${frac}` : int);
}

/** Exact human string with thousands separators on the integer part (for display). */
export function formatTokenAmount(symbol: string, raw: number | string | bigint): string {
  const exact = formatUnits(raw, tokenDecimals(symbol));
  const [int, frac] = exact.split('.');
  const withCommas = int.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const signed = int.startsWith('-') ? `-${withCommas}` : withCommas;
  return frac ? `${signed}.${frac}` : signed;
}

/**
 * Exact integer base units from a human input string: `input × 10^decimals`. Throws on malformed
 * input or more fractional digits than the token has. Returns a BigInt (lossless).
 */
export function parseUnits(input: string, decimals: number): bigint {
  const str = String(input).trim();
  if (str === '' || str === '.' || !/^\d*\.?\d*$/.test(str)) {
    throw new Error('Enter a valid amount');
  }
  const [whole = '0', frac = ''] = str.split('.');
  if (frac.length > decimals) {
    throw new Error(decimals === 0 ? 'This token has no decimals' : `Too many decimals — max ${decimals}`);
  }
  const padded = frac.padEnd(decimals, '0');
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

/**
 * Node 1.6.4+ forward-compat. The balance route gains exact integer fields — `balance_raw` and
 * `token_balances_raw` (base units, possibly strings above 2^53) — alongside the older float
 * fields. Prefer the raw fields when present (detected by presence); otherwise fall back to the
 * existing float fields, so this is safe against today's 1.6.3 nodes too.
 */
export function pickXrgeBalance(b: Record<string, unknown>): number {
  const raw = b?.balance_raw;
  if (raw !== undefined && raw !== null) return Number(raw);
  const v = b?.balance;
  return typeof v === 'number' ? v : Number(v ?? 0);
}

export function pickTokenBalances(b: Record<string, unknown>): Record<string, number> {
  const src =
    (b?.token_balances_raw as Record<string, unknown>) ??
    (b?.token_balances as Record<string, unknown>) ??
    (b?.tokens as Record<string, unknown>) ??
    {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(src)) out[k] = typeof v === 'number' ? v : Number(v ?? 0);
  return out;
}

export { formatNumber };
