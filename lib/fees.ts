import { TRANSFER_FEE } from '@/constants/config';
import { getActiveNetworkId, rc } from '@/lib/rougechain';

/**
 * EIP-1559-style dynamic fee lookup with a short cache and a safe fallback.
 * The chain adjusts base fees ±12.5% per block, so a 30s cache is plenty.
 */

const CACHE_MS = 30_000;

let cachedFee = TRANSFER_FEE;
let cachedAt = 0;
let cachedNetwork = getActiveNetworkId();

function parseFeeInfo(info: unknown): number | null {
  if (typeof info === 'number' && isFinite(info) && info > 0) return info;
  if (!info || typeof info !== 'object') return null;
  const o = info as Record<string, unknown>;
  // Mainnet /api/fee shape: { base_fee, fee_floor, priority_fee_suggestion,
  // total_fee_suggestion, success } — prefer the all-in suggestion.
  const candidates = [
    o.total_fee_suggestion,
    o.totalFeeSuggestion,
    o.suggested_fee,
    o.suggestedFee,
    o.base_fee,
    o.baseFee,
    o.fee,
  ];
  for (const c of candidates) {
    const n = typeof c === 'string' ? Number(c) : c;
    if (typeof n === 'number' && isFinite(n) && n > 0) return n;
  }
  // Some nodes nest it: { fees: { base_fee: ... } }
  if (o.fees && typeof o.fees === 'object') return parseFeeInfo(o.fees);
  return null;
}

/**
 * Current suggested transfer fee in XRGE.
 * Falls back to TRANSFER_FEE (0.1) when the node is unreachable.
 */
export async function getSuggestedFee(): Promise<number> {
  const now = Date.now();
  const net = getActiveNetworkId();
  if (net === cachedNetwork && now - cachedAt < CACHE_MS) return cachedFee;

  try {
    const info = await rc.getFeeInfo();
    const fee = parseFeeInfo(info);
    if (fee !== null) {
      cachedFee = fee;
      cachedAt = now;
      cachedNetwork = net;
      return fee;
    }
  } catch {
    /* node unreachable or endpoint missing — fall through */
  }
  cachedAt = now;
  cachedNetwork = net;
  return cachedFee;
}

/** Synchronous best-known fee (last fetched or fallback) for instant UI. */
export function getLastKnownFee(): number {
  return cachedFee;
}
