import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { bytesToHex, hexToBytes, serializePayload, verifyTransaction } from '@rougechain/sdk';

import { checkDappChainId, resetChainIdChecks } from '@/lib/chain-id';
import {
  SIGN_TX_IS_MESSAGE,
  SIGN_TX_MISMATCH,
  SIGN_TX_NOT_CONNECTED,
  authorizeSignTransaction,
} from '@/lib/sign-transaction-request';
import { messageSigningBytes } from '@/lib/sign-message';

// The remote-pairing signer (lib/dapp-session.ts rougechain_signTransaction) now routes through
// the SAME gate as the in-app browser and signs exactly prepared.bytes. These assert that path:
// a connected session signs the canonical encoding (what the node re-derives), regardless of key
// order, and the gate refuses the unsafe cases.

const ORIGIN = 'ws-session:deadbeef';
const connected = async () => true;
const notConnected = async () => false;

const kp = ml_dsa65.keygen(new Uint8Array(32).fill(5));
const PUB = bytesToHex(kp.publicKey);
const NOW = 1791200000000;
const base = { from: PUB, timestamp: NOW, nonce: '00112233445566778899aabbccddeeff' };

function accepted(r: { error: string } | { bytes: Uint8Array; payload: Record<string, unknown>; signedText: string }) {
  if ('error' in r) throw new Error(r.error);
  return r;
}

test('unconnected pairing session cannot sign', async () => {
  const params = { payload: { type: 'transfer', to: 'rouge1x', amount: 1, ...base } };
  expect(await authorizeSignTransaction(params, ORIGIN, notConnected)).toEqual({ error: SIGN_TX_NOT_CONNECTED });
});

test('signs the canonical bytes — key order does not change the signature, and verifyTransaction accepts it', async () => {
  const payload = { type: 'transfer', to: 'rouge1x', amount: 25, fee: 1, token: 'XRGE', ...base };
  // Same content, deliberately different key insertion order.
  const reordered = { token: 'XRGE', amount: 25, nonce: base.nonce, type: 'transfer', fee: 1, timestamp: NOW, from: PUB, to: 'rouge1x' };

  const a = accepted(await authorizeSignTransaction({ payload }, ORIGIN, connected));
  const b = accepted(await authorizeSignTransaction({ payload: reordered }, ORIGIN, connected));
  expect(bytesToHex(a.bytes)).toBe(bytesToHex(b.bytes)); // canonical: identical bytes
  expect(bytesToHex(a.bytes)).toBe(bytesToHex(serializePayload(payload as never)));

  // What the pairing handler does: sign prepared.bytes, respond with the signature.
  const sig = bytesToHex(ml_dsa65.sign(a.bytes, kp.secretKey));
  // The signature verifies as a transaction (SDK re-serialises the payload and checks it).
  expect(verifyTransaction({ payload: a.payload, signature: sig, public_key: PUB } as never)).toBe(true);
  // A raw JSON.stringify (the OLD bug) would NOT match the canonical bytes for the reordered payload.
  expect(new TextEncoder().encode(JSON.stringify(reordered))).not.toEqual(a.bytes);
});

test('a serializedHex that is not the canonical bytes is refused', async () => {
  const payload = { type: 'transfer', to: 'rouge1x', amount: 1, ...base };
  const wrong = bytesToHex(new TextEncoder().encode(JSON.stringify({ ...payload, amount: 999 })));
  expect(await authorizeSignTransaction({ payload, serializedHex: wrong }, ORIGIN, connected)).toEqual({
    error: SIGN_TX_MISMATCH,
  });
});

test('a 0x19 message payload is never signed as a transaction', async () => {
  const payload = { type: 'transfer', to: 'rouge1x', amount: 1, ...base };
  const msgBytes = bytesToHex(messageSigningBytes('ws.example wants you to sign in'));
  expect(msgBytes.startsWith('19')).toBe(true);
  expect(await authorizeSignTransaction({ payload, serializedHex: msgBytes }, ORIGIN, connected)).toEqual({
    error: SIGN_TX_IS_MESSAGE,
  });
});

describe('chain-id gate (same rule as the browser path)', () => {
  beforeEach(() => resetChainIdChecks());

  test('a payload naming another network is refused on mainnet', () => {
    const r = checkDappChainId({ chainId: 'rougechain-testnet-1' }, 'mainnet');
    expect(r.ok).toBe(false);
  });

  test('a matching chainId is allowed, a missing one is allowed-with-warning', () => {
    expect(checkDappChainId({ chainId: 'rougechain-mainnet-1' }, 'mainnet')).toMatchObject({ ok: true, status: 'match' });
    expect(checkDappChainId({ type: 'transfer' }, 'mainnet')).toMatchObject({ ok: true, status: 'missing' });
  });
});
