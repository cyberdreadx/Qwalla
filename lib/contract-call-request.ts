/**
 * dApp `callContract` requests: a player-signed `contract_call`, optionally PAYABLE.
 *
 * Same transaction as rougechain.io (`packages/core/src/contracts.ts` `buildContractCallPayload`),
 * `@rougechain/sdk` >= 1.10 (`createSignedContractCall`, `rc.contracts.execute`) and the browser
 * extension (`apps/extension/src/lib/contract-tx.ts`), so one dApp code path works everywhere:
 *
 *   { type: "contract_call", from, contractAddr, method, args, gasLimit, timestamp, nonce,
 *     chainId, attach?: { symbol, amount } }
 *
 * - `contractAddr` is trimmed and lower-cased; `args` defaults to `{}`.
 * - `gasLimit` is an integer 1..10,000,000 (the node's DEFAULT_FUEL_LIMIT). The fee is
 *   gasLimit × 0.000001 XRGE (= gasLimit × 1,000 quanta), charged up front.
 * - `attach` (payable calls, node `v2_binding::parse_attach`): `symbol` is "XRGE" or a token
 *   symbol (1-32 of A-Z 0-9 _ -, upper-cased); `amount` is a positive INTEGER — quanta for XRGE
 *   (1 XRGE = 1,000,000,000 quanta), raw units for a token. The node rejects decimals and strings
 *   in the signed payload, so a digit string from the dApp is converted to a JSON number (as the
 *   SDK's `normalizeContractAttach` does) and must be <= Number.MAX_SAFE_INTEGER. No `attach`
 *   key at all when nothing is attached: a non-payable call is byte-for-byte the call it was.
 *   The payment moves to the contract only if the call succeeds; the fee is charged either way.
 * - `chainId` (signatures commit to the network): the selected network's chain id, cross-checked
 *   with its node once per session (lib/chain-id). A dApp MAY name the network it means with
 *   `chainId`: another network's id (or a non-string) is refused, none is allowed with a visible
 *   warning — the same rule as `signTransaction`. Either way Qwalla signs the selected network's
 *   id, so the signature is valid on that one network. (Only a local devnet whose node has not
 *   been reached has no id to sign; then there is no `chainId` key.)
 *
 * Signed bytes = `serializePayload(payload)` (keys sorted recursively, JSON, UTF-8): the exact
 * text the approval sheet shows, and the `payload_bytes_hex` submitted to
 * `POST /api/v2/contract/execute` (the 31a532c signTransaction rule).
 *
 * Pure apart from the injected lookups in {@link authorizeCallContract}: no wallet, no UI.
 */
import { bytesToHex, generateNonce, serializePayload } from '@rougechain/sdk';

import { networkNameForChainId } from '@/lib/chain-id';
import { l1TokenDecimals } from '@/lib/format';
import { formatUnits } from '@/lib/token-decimals';

/** Max gas per call (the node's `DEFAULT_FUEL_LIMIT`). */
export const CONTRACT_MAX_GAS = 10_000_000;
/** Quanta per XRGE (XRGE has 9 decimals). */
export const QUANTA_PER_XRGE = 1_000_000_000n;
/** Quanta charged per unit of signed gas limit (0.000001 XRGE). */
export const QUANTA_PER_GAS = 1_000n;
/**
 * The sheet turns red when the attached amount is at least this percentage of the wallet's
 * spendable balance of that asset (measured before the call).
 */
export const LARGE_PAYMENT_PERCENT = 50n;

export const CALL_NOT_CONNECTED = 'Site not connected. Call connect() first.';
export const CALL_NEEDS_CONTRACT_AND_METHOD = 'callContract requires contractAddr and method';
export const CALL_BAD_CONTRACT = 'contractAddr must be a hex contract address';
export const CALL_BAD_METHOD = 'method must be a contract function name';
export const CALL_BAD_ARGS = 'args must be JSON';
export const CALL_BAD_GAS = `gasLimit must be an integer between 1 and ${CONTRACT_MAX_GAS}`;
export const CALL_BAD_ATTACH = 'attach must be { symbol, amount }';
export const CALL_BAD_ATTACH_SYMBOL = 'attach.symbol must be "XRGE" or a token symbol (1-32 letters, digits, _ or -)';
export const CALL_BAD_ATTACH_AMOUNT =
  'attach.amount must be a positive integer (quanta for XRGE, raw units for tokens)';
export const CALL_ATTACH_TOO_LARGE = `attach.amount exceeds Number.MAX_SAFE_INTEGER (${Number.MAX_SAFE_INTEGER})`;
export const CALL_BALANCE_UNAVAILABLE = 'Could not read the wallet balance; try again';
export const CALL_BAD_CHAIN_ID = 'chainId must be the chain id string of the network';

/** A payment attached to a contract call, as signed. */
export interface ContractAttach {
  symbol: string;
  /** Positive safe integer: quanta for XRGE, raw units for tokens. */
  amount: number;
}

/** What the dApp asked for, validated. */
export interface CallContractRequest {
  contractAddr: string;
  method: string;
  args: unknown;
  /** Absent: Qwalla dry-runs the call and signs the SDK's suggested limit. */
  gasLimit?: number;
  attach: ContractAttach | null;
  /** The network the dApp says the call is for (`chainId`), when it names one. */
  chainId?: string;
}

/** The subset of `GET /api/balance/:pubkey` used here. `*_raw` / `_quanta` are exact (node >= MONETARY_INTEGRITY). */
export interface BalanceLike {
  balance?: number;
  balance_quanta?: string | number;
  token_balances?: Record<string, number>;
  token_balances_raw?: Record<string, string | number>;
}

/** Everything the approval sheet shows for a contract call. */
export interface ContractCallReview {
  /** Full contract address (lower case) — never shortened in the sheet. */
  contractAddr: string;
  method: string;
  /** `args` pretty-printed. */
  argsPretty: string;
  gasLimit: number;
  /** True when the dApp gave no gasLimit and Qwalla signed the dry-run suggestion. */
  gasLimitEstimated: boolean;
  /** Exact XRGE decimal string: gasLimit × 0.000001. */
  maxFeeXrge: string;
  /** The payment, or null for a non-payable call. `display` is exact (XRGE formatted from quanta). */
  attach: (ContractAttach & { display: string }) | null;
  /** Exact XRGE decimal string: max fee + an XRGE payment. */
  maxTotalXrge: string;
  /** Spendable balance of the attached asset (display form), when a payment is attached. */
  attachBalanceDisplay: string | null;
  /** Payment ≥ LARGE_PAYMENT_PERCENT of that asset's spendable balance: the sheet warns in red. */
  large: boolean;
  /**
   * The network the call is signed for: its name, the signed `chainId` (null only for an
   * unreached devnet), and whether the dApp named none (shown with a warning).
   */
  network: { name: string; chainId: string | null; missingChainId: boolean };
}

export interface PreparedContractCall {
  /** The payload in canonical (signed) key order. */
  payload: Record<string, unknown>;
  /** The exact JSON text that is signed (shown in the sheet). */
  signedText: string;
  /** UTF-8 of `signedText`: the bytes handed to ML-DSA-65 and sent as `payload_bytes_hex`. */
  bytes: Uint8Array;
  review: ContractCallReview;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Exact XRGE decimal string for integer quanta, e.g. 500000000n -> "0.5". */
export function quantaToXrge(quanta: bigint): string {
  const neg = quanta < 0n;
  const q = neg ? -quanta : quanta;
  const whole = q / QUANTA_PER_XRGE;
  const frac = (q % QUANTA_PER_XRGE).toString().padStart(9, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/**
 * Human label for a signed attachment, e.g. "0.5 XRGE" or "0.00001647 qBTC (1647 raw)".
 * The amount is signed in raw units; we show the decimal-adjusted amount (using the token's
 * real decimals) so the user sees what they're actually paying, with the raw units in parens
 * when they differ. XRGE is already shown as whole XRGE from quanta.
 */
export function formatAttach(a: ContractAttach): string {
  if (a.symbol === 'XRGE') return `${quantaToXrge(BigInt(a.amount))} XRGE`;
  const decimals = l1TokenDecimals(a.symbol);
  if (decimals <= 0) return `${a.amount} ${a.symbol}`;
  const human = formatUnits(BigInt(a.amount), decimals);
  return `${human} ${a.symbol} (${a.amount} raw)`;
}

/** Gas limit to sign for a call that used `gasUsed` in a dry run (same rule as the SDK and site). */
export function suggestGasLimit(gasUsed: number): number {
  return Math.min(Math.ceil(gasUsed * 1.5) + 1000, CONTRACT_MAX_GAS);
}

/**
 * Validate an attachment and normalize it to what is signed (node `parse_attach` + the SDK's
 * `normalizeContractAttach`). `undefined`/`null` = no payment.
 */
export function normalizeAttach(v: unknown): { attach: ContractAttach | null } | { error: string } {
  if (v === undefined || v === null) return { attach: null };
  if (!isPlainObject(v)) return { error: CALL_BAD_ATTACH };
  const symbol = typeof v.symbol === 'string' ? v.symbol.trim().toUpperCase() : '';
  if (!/^[A-Z0-9_-]{1,32}$/.test(symbol)) return { error: CALL_BAD_ATTACH_SYMBOL };
  const raw = v.amount;
  let amount: bigint;
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw)) return { error: CALL_BAD_ATTACH_AMOUNT };
    if (!Number.isSafeInteger(raw)) return { error: CALL_ATTACH_TOO_LARGE };
    amount = BigInt(raw);
  } else if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    amount = BigInt(raw.trim());
  } else {
    return { error: CALL_BAD_ATTACH_AMOUNT };
  }
  if (amount <= 0n) return { error: CALL_BAD_ATTACH_AMOUNT };
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) return { error: CALL_ATTACH_TOO_LARGE };
  return { attach: { symbol, amount: Number(amount) } };
}

/**
 * Validate `callContract(params)`. Field names are the site/SDK payload names (`contractAddr`,
 * `method`, `args`, `gasLimit`, `attach`); `address` / `contract` are accepted for
 * `contractAddr` because earlier Qwalla builds documented them.
 */
export function parseCallContractParams(params: unknown): CallContractRequest | { error: string } {
  const p = isPlainObject(params) ? params : {};
  const rawAddr = p.contractAddr ?? p.address ?? p.contract;
  const method = p.method;
  if (typeof rawAddr !== 'string' || !rawAddr.trim() || typeof method !== 'string' || !method) {
    return { error: CALL_NEEDS_CONTRACT_AND_METHOD };
  }
  const contractAddr = rawAddr.trim().toLowerCase();
  if (!/^[0-9a-f]{16,128}$/.test(contractAddr)) return { error: CALL_BAD_CONTRACT };
  // The node only needs a non-empty name; no control characters, so the sheet shows it as signed.
  if (method.length > 256 || /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(method)) {
    return { error: CALL_BAD_METHOD };
  }

  const args = p.args === undefined ? {} : p.args;
  try {
    if (JSON.stringify(args) === undefined) return { error: CALL_BAD_ARGS };
  } catch {
    return { error: CALL_BAD_ARGS };
  }

  let gasLimit: number | undefined;
  if (p.gasLimit !== undefined && p.gasLimit !== null) {
    const g = p.gasLimit;
    if (typeof g !== 'number' || !Number.isInteger(g) || g < 1 || g > CONTRACT_MAX_GAS) return { error: CALL_BAD_GAS };
    gasLimit = g;
  }

  const att = normalizeAttach(p.attach);
  if ('error' in att) return { error: att.error };

  let chainId: string | undefined;
  if (p.chainId !== undefined && p.chainId !== null) {
    if (typeof p.chainId !== 'string' || !p.chainId) return { error: CALL_BAD_CHAIN_ID };
    chainId = p.chainId;
  }
  return { contractAddr, method, args, gasLimit, attach: att.attach, ...(chainId !== undefined ? { chainId } : {}) };
}

/**
 * The unsigned `contract_call` payload — field for field what the site signs
 * (`buildContractCallPayload` + `signTransaction`, which adds `chainId`) and the SDK's
 * `createSignedContractCall` with a chain-bound wallet. `chainId` is the SELECTED network's
 * (required, so a caller cannot forget it; `null` only for an unreached devnet → no `chainId`
 * key). `timestamp` / `nonce` are injectable for tests.
 */
export function buildContractCallPayload(
  from: string,
  req: Omit<CallContractRequest, 'gasLimit'> & { gasLimit: number },
  opts: { chainId: string | null; timestamp?: number; nonce?: string },
): Record<string, unknown> {
  if (!Number.isInteger(req.gasLimit) || req.gasLimit < 1 || req.gasLimit > CONTRACT_MAX_GAS) {
    throw new Error(CALL_BAD_GAS);
  }
  const payload: Record<string, unknown> = {
    type: 'contract_call',
    from,
    contractAddr: req.contractAddr.trim().toLowerCase(),
    method: req.method,
    args: req.args === undefined ? {} : req.args,
    gasLimit: req.gasLimit,
    timestamp: opts.timestamp ?? Date.now(),
    nonce: opts.nonce ?? generateNonce(),
  };
  // Signatures commit to the network: the selected network's chain id, inside the signed bytes.
  if (opts.chainId) payload.chainId = opts.chainId;
  if (req.attach) payload.attach = { symbol: req.attach.symbol, amount: req.attach.amount };
  return payload;
}

function toBigIntFloor(v: unknown, scale: bigint): bigint | null {
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return BigInt(v.trim());
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
    // Older nodes report a float; floor so Qwalla never claims more than the node holds.
    return scale === 1n ? BigInt(Math.floor(v)) : BigInt(Math.floor(v * Number(scale)));
  }
  return null;
}

/** Spendable XRGE in quanta (exact `balance_quanta` when the node sends it). */
export function spendableXrgeQuanta(bal: BalanceLike): bigint | null {
  return toBigIntFloor(bal.balance_quanta, 1n) ?? toBigIntFloor(bal.balance, QUANTA_PER_XRGE);
}

/** Spendable raw units of a token (exact `token_balances_raw` when the node sends it). 0 if not held. */
export function spendableTokenUnits(bal: BalanceLike, symbol: string): bigint {
  const raw = bal.token_balances_raw?.[symbol];
  const exact = raw !== undefined ? toBigIntFloor(raw, 1n) : null;
  if (exact !== null) return exact;
  const f = bal.token_balances?.[symbol];
  return (f !== undefined ? toBigIntFloor(f, 1n) : null) ?? 0n;
}

/**
 * Balance check before the sheet opens (the node refuses the same cases at submit):
 * max fee + an XRGE payment ≤ XRGE balance, and a token payment ≤ that token's balance.
 */
export function checkCallBalance(
  bal: BalanceLike,
  gasLimit: number,
  attach: ContractAttach | null,
): { error: string } | { large: boolean; attachBalanceDisplay: string | null } {
  const xrge = spendableXrgeQuanta(bal);
  if (xrge === null) return { error: CALL_BALANCE_UNAVAILABLE };
  const fee = BigInt(gasLimit) * QUANTA_PER_GAS;
  const payX = attach && attach.symbol === 'XRGE' ? BigInt(attach.amount) : 0n;
  if (xrge < fee + payX) {
    return {
      error:
        `Insufficient XRGE for the gas fee${payX > 0n ? ' and the attached payment' : ''}: ` +
        `have ${quantaToXrge(xrge)} XRGE, need ${quantaToXrge(fee + payX)} XRGE`,
    };
  }
  if (!attach) return { large: false, attachBalanceDisplay: null };
  if (attach.symbol === 'XRGE') {
    return {
      large: payX * 100n >= xrge * LARGE_PAYMENT_PERCENT,
      attachBalanceDisplay: `${quantaToXrge(xrge)} XRGE`,
    };
  }
  const have = spendableTokenUnits(bal, attach.symbol);
  const need = BigInt(attach.amount);
  if (have < need) {
    return { error: `Insufficient ${attach.symbol} for the attached payment: have ${have}, need ${need}` };
  }
  return { large: need * 100n >= have * LARGE_PAYMENT_PERCENT, attachBalanceDisplay: `${have} ${attach.symbol}` };
}

/** Signed text, bytes and sheet data for a built payload. */
export function reviewContractCall(
  payload: Record<string, unknown>,
  req: Omit<CallContractRequest, 'gasLimit'> & { gasLimit: number },
  balance: { large: boolean; attachBalanceDisplay: string | null },
  gasLimitEstimated: boolean,
  network: { name: string; missingChainId: boolean },
): PreparedContractCall {
  const bytes = serializePayload(payload);
  const signedText = new TextDecoder().decode(bytes);
  const fee = BigInt(req.gasLimit) * QUANTA_PER_GAS;
  const payX = req.attach && req.attach.symbol === 'XRGE' ? BigInt(req.attach.amount) : 0n;
  // Everything shown comes from the signed text, so args appear in signed key order.
  const canonical = JSON.parse(signedText) as Record<string, unknown>;
  const argsPretty = JSON.stringify(canonical.args, null, 2) ?? '{}';
  return {
    payload: canonical,
    signedText,
    bytes,
    review: {
      contractAddr: String(canonical.contractAddr),
      method: String(canonical.method),
      argsPretty,
      gasLimit: req.gasLimit,
      gasLimitEstimated,
      maxFeeXrge: quantaToXrge(fee),
      attach: req.attach
        ? {
            ...req.attach,
            display: req.attach.symbol === 'XRGE' ? quantaToXrge(BigInt(req.attach.amount)) : String(req.attach.amount),
          }
        : null,
      maxTotalXrge: quantaToXrge(fee + payX),
      attachBalanceDisplay: balance.attachBalanceDisplay,
      large: balance.large,
      network: {
        name: network.name,
        chainId: typeof canonical.chainId === 'string' ? canonical.chainId : null,
        missingChainId: network.missingChainId,
      },
    },
  };
}

export interface CallContractDeps {
  /** The host's connected-sites lookup. */
  isConnected: (origin: string) => Promise<boolean>;
  /** `GET /api/balance/:pubkey`. */
  getBalance: (publicKey: string) => Promise<BalanceLike>;
  /**
   * Dry run (`POST /api/contract/:addr/query` with caller + attach), used only when the dApp gives
   * no gasLimit. Resolves the gas used, or `{ error }` when the call would fail.
   */
  estimateGas: (req: CallContractRequest, caller: string) => Promise<{ gasUsed: number } | { error: string }>;
  /**
   * The selected network: its name and the chain id to sign for, cross-checked with its node once
   * per session (lib/chain-id `verifyChainId`). Rejects (`ChainIdMismatchError`) when the node
   * reports another chain id: nothing is signed. `chainId` null = a devnet not reached yet.
   */
  network: () => Promise<{ name: string; chainId: string | null }>;
  now?: () => number;
  nonce?: () => string;
}

/**
 * The network gate for a contract call (same rule as lib/chain-id `checkDappChainId` for
 * `signTransaction`): a dApp `chainId` must be the selected network's; none → allowed, flagged.
 */
export function checkCallChainId(
  requested: string | undefined,
  network: { name: string; chainId: string | null },
): { error: string } | { missingChainId: boolean } {
  if (requested === undefined) return { missingChainId: true };
  if (!network.chainId) {
    return { error: `Cannot confirm the chain id of ${network.name}: its node is not reachable.` };
  }
  if (requested !== network.chainId) {
    return {
      error: `This request is for ${networkNameForChainId(requested)}, but Qwalla is on ${network.name}. Switch networks in Qwalla and try again.`,
    };
  }
  return { missingChainId: false };
}

/**
 * The full gate for a dApp `callContract`: connected origin → params → network → gas limit →
 * payload → balance check → exactly what is signed. Returns `{ error }` for anything Qwalla will
 * not sign.
 */
export async function authorizeCallContract(
  params: unknown,
  origin: string,
  from: string,
  deps: CallContractDeps,
): Promise<{ error: string } | PreparedContractCall> {
  let connected = false;
  try {
    connected = (await deps.isConnected(origin)) === true;
  } catch {
    connected = false;
  }
  if (!connected) return { error: CALL_NOT_CONNECTED };

  const req = parseCallContractParams(params);
  if ('error' in req) return req;

  // Network: cross-checked with the node before anything else is asked of it (dry run, balance).
  let network: { name: string; chainId: string | null };
  try {
    network = await deps.network();
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const chain = checkCallChainId(req.chainId, network);
  if ('error' in chain) return chain;

  let gasLimit = req.gasLimit;
  const gasLimitEstimated = gasLimit === undefined;
  if (gasLimit === undefined) {
    let est: { gasUsed: number } | { error: string };
    try {
      est = await deps.estimateGas(req, from);
    } catch (e) {
      est = { error: e instanceof Error ? e.message : String(e) };
    }
    if ('error' in est) return { error: `call would fail: ${est.error}` };
    gasLimit = suggestGasLimit(est.gasUsed);
  }
  const full = { ...req, gasLimit };

  let bal: BalanceLike;
  try {
    bal = await deps.getBalance(from);
  } catch {
    return { error: CALL_BALANCE_UNAVAILABLE };
  }
  const checked = checkCallBalance(bal ?? {}, gasLimit, req.attach);
  if ('error' in checked) return checked;

  const payload = buildContractCallPayload(from, full, {
    chainId: network.chainId,
    timestamp: deps.now?.(),
    nonce: deps.nonce?.(),
  });
  return reviewContractCall(payload, full, checked, gasLimitEstimated, {
    name: network.name,
    missingChainId: chain.missingChainId,
  });
}

/** The body for `POST /api/v2/contract/execute` (same envelope as the SDK/site/extension). */
export function signedCallBody(prepared: PreparedContractCall, signatureHex: string, publicKey: string) {
  return {
    payload: prepared.payload,
    signature: signatureHex,
    public_key: publicKey,
    payload_bytes_hex: bytesToHex(prepared.bytes),
  };
}
