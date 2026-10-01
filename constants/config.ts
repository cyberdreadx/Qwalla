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
 * Flat network fee in XRGE. Per the RougeChain node, every transfer (and
 * stake / unstake / swap) costs a FLAT 1 XRGE — the node ignores both the fee
 * the client sends and /api/fee, so there is no dynamic fee to look up. Keep
 * this at 1 and compute Max as balance − 1. (Token creation is a separate,
 * larger fee handled on the create-token screen.)
 */
export const TRANSFER_FEE = 1;
