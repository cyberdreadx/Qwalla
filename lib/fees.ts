import { TRANSFER_FEE } from '@/constants/config';

/**
 * Network fee in XRGE.
 *
 * The RougeChain node charges a FLAT fee (TRANSFER_FEE = 1 XRGE) for transfers,
 * stake/unstake, and swaps. It ignores the fee the client submits and does not
 * use /api/fee, so there's nothing dynamic to fetch — these helpers just return
 * the flat fee. (Kept as async + a sync variant so existing callers are
 * unchanged; if the node ever reintroduces dynamic fees, restore the /api/fee
 * lookup here.)
 */

export async function getSuggestedFee(): Promise<number> {
  return TRANSFER_FEE;
}

/** Synchronous flat fee for instant UI. */
export function getLastKnownFee(): number {
  return TRANSFER_FEE;
}
