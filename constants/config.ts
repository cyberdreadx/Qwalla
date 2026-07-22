/**
 * Legacy config shims — network endpoints now live in constants/networks.ts
 * and are selected at runtime via stores/network.ts. These constants remain
 * for modules that want the historical defaults.
 */
import { NETWORKS } from '@/constants/networks';

/** @deprecated Use getActiveNetwork().api — kept as the testnet default. */
export const ROUGECHAIN_API = NETWORKS.testnet.api;

/** @deprecated Use getActiveNetwork().ws — kept as the testnet default. */
export const ROUGECHAIN_WS = NETWORKS.testnet.ws;

/** Qwalla's own mail domain — resolves the same on-chain registry as rouge.quant */
export const MAIL_DOMAIN = 'qwalla.mail';

/**
 * Fallback transfer fee in XRGE. The live base fee is EIP-1559-style dynamic —
 * use lib/fees.ts `getSuggestedFee()` and treat this as the offline fallback.
 */
export const TRANSFER_FEE = 0.1;
