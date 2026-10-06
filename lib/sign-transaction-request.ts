/**
 * dApp `signTransaction` requests: what Qwalla is willing to sign, and exactly which bytes.
 *
 * The signed bytes are always the canonical encoding of the payload the approval sheet shows:
 * `serializePayload` from @rougechain/sdk (keys sorted recursively, then JSON, then UTF-8) — the
 * same function Qwalla's own send path and rougechain.io use. A dApp may also pass
 * `serializedHex` (rougechain.io does, and submits it to the node as `payload_bytes_hex`); it is
 * accepted only when it is those same bytes. The browser extension applies the same rule.
 */
import { bytesToHex, serializePayload } from '@rougechain/sdk';

export interface PreparedSignTransaction {
  /** The payload in canonical (signed) key order — what the approval sheet shows. */
  payload: Record<string, unknown>;
  /** The exact JSON text that is signed. */
  signedText: string;
  /** UTF-8 of `signedText`: the bytes handed to ML-DSA-65. */
  bytes: Uint8Array;
}

export const SIGN_TX_NOT_CONNECTED = 'Site not connected. Call connect() first.';
export const SIGN_TX_INVALID_PAYLOAD = 'signTransaction requires a payload object';
export const SIGN_TX_BAD_HEX = 'serializedHex must be a hex string';
export const SIGN_TX_MISMATCH = 'serializedHex does not match the payload';
export const SIGN_TX_IS_MESSAGE = 'signTransaction cannot sign a message. Use signMessage.';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Validate `{ payload, serializedHex? }` and return the bytes to sign, or `{ error }`.
 * Pure: no wallet, no storage, no UI.
 */
export function prepareSignTransaction(params: unknown): { error: string } | PreparedSignTransaction {
  const p = isPlainObject(params) ? params : {};
  if (!isPlainObject(p.payload)) return { error: SIGN_TX_INVALID_PAYLOAD };

  let bytes: Uint8Array;
  try {
    bytes = serializePayload(p.payload as never);
  } catch {
    return { error: SIGN_TX_INVALID_PAYLOAD };
  }

  const hex = p.serializedHex;
  if (hex !== undefined && hex !== null) {
    if (typeof hex !== 'string' || hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
      return { error: SIGN_TX_BAD_HEX };
    }
    // Transaction bytes are JSON; a 0x19 first byte is the signMessage prefix.
    if (hex.slice(0, 2) === '19') return { error: SIGN_TX_IS_MESSAGE };
    if (hex.toLowerCase() !== bytesToHex(bytes)) return { error: SIGN_TX_MISMATCH };
  }

  const signedText = new TextDecoder().decode(bytes);
  return { payload: JSON.parse(signedText) as Record<string, unknown>, signedText, bytes };
}

/**
 * The full gate for a dApp `signTransaction`: the origin must be connected, then
 * {@link prepareSignTransaction}. `isConnected` is the host's connected-sites lookup.
 */
export async function authorizeSignTransaction(
  params: unknown,
  origin: string,
  isConnected: (origin: string) => Promise<boolean>,
): Promise<{ error: string } | PreparedSignTransaction> {
  let connected = false;
  try {
    connected = (await isConnected(origin)) === true;
  } catch {
    connected = false;
  }
  if (!connected) return { error: SIGN_TX_NOT_CONNECTED };
  return prepareSignTransaction(params);
}
