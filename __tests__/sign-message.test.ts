import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { bytesToHex, hexToBytes } from '@rougechain/sdk';

import { nativePubkeyToAddress } from '@qwalla/core/wallet/address';
import {
  MAX_SIGN_MESSAGE_BYTES,
  SIGNED_MESSAGE_PREFIX,
  createSignInMessage,
  messageSigningBytes,
  reviewSignMessageRequest,
  signMessage,
  verifyMessage,
  verifySignIn,
} from '@/lib/sign-message';

// window.rougechain.signMessage: Qwalla must sign exactly the bytes the extension and the SDK
// sign. The vector is the same file as packages/core/test/fixtures/sign-message-vector.json in
// the RougeChain monorepo. ML-DSA-65 signing is randomized, so the vector is a fixed key and
// message, the exact signed bytes, and one recorded signature that must verify.
const vector = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures', 'sign-message-vector.json'), 'utf8'),
);
const kp = ml_dsa65.keygen(hexToBytes(vector.seedHex));
const pub = bytesToHex(kp.publicKey);
const priv = bytesToHex(kp.secretKey);
const read = (p: string) => readFileSync(path.join(__dirname, '..', p), 'utf8');

test('signed bytes: 0x19 prefix, decimal byte length, LF, message', () => {
  expect(SIGNED_MESSAGE_PREFIX.charCodeAt(0)).toBe(0x19);
  expect(new TextDecoder().decode(messageSigningBytes('hello'))).toBe(
    String.fromCharCode(0x19) + 'RougeChain Signed Message:\n5\nhello',
  );
});

test('shared vector: same key, same signed bytes, recorded signature verifies', () => {
  expect(pub).toBe(vector.publicKey);
  expect(nativePubkeyToAddress(pub)).toBe(vector.address);
  expect(bytesToHex(messageSigningBytes(vector.message))).toBe(vector.signedBytesHex);
  expect(verifyMessage(vector.publicKey, vector.message, vector.signature)).toBe(true);
  expect(verifyMessage(vector.publicKey, vector.message + ' ', vector.signature)).toBe(false);
});

test('a signature made here verifies for the vector key, and is not a bare-bytes signature', () => {
  const sig = signMessage(priv, vector.message);
  expect(verifyMessage(vector.publicKey, vector.message, sig)).toBe(true);
  const bare = new TextEncoder().encode(vector.message);
  expect(ml_dsa65.verify(hexToBytes(sig), bare, kp.publicKey)).toBe(false);
  // and the other way round: what signTransaction produces is not a message signature
  const txStyle = bytesToHex(ml_dsa65.sign(bare, kp.secretKey));
  expect(verifyMessage(vector.publicKey, vector.message, txStyle)).toBe(false);
});

test('verifyMessage never throws on malformed input', () => {
  for (const bad of [undefined, null, 1, {}, '', 'zz', '00']) {
    expect(verifyMessage(bad as string, 'hello', vector.signature)).toBe(false);
    expect(verifyMessage(vector.publicKey, 'hello', bad as string)).toBe(false);
  }
});

test('verifySignIn accepts the vector and derives the address natively', async () => {
  const res = await verifySignIn({
    message: vector.message,
    signature: vector.signature,
    publicKey: vector.publicKey,
    expectedDomain: 'tickets.example.com',
    expectedNonce: '4f9c2d1e8a7b6c5d0011',
    expectedChainId: 'rougechain-mainnet-1',
    now: Date.parse('2026-10-06T12:01:00.000Z'),
  });
  expect(res).toMatchObject({ valid: true, address: vector.address });
  const wrong = await verifySignIn({
    message: vector.message,
    signature: vector.signature,
    publicKey: vector.publicKey,
    expectedDomain: 'evil.example',
    expectedNonce: '4f9c2d1e8a7b6c5d0011',
    expectedChainId: 'rougechain-mainnet-1',
    now: Date.parse('2026-10-06T12:01:00.000Z'),
  });
  expect(wrong).toEqual({ valid: false, error: 'domain_mismatch' });
});

describe('what the approval sheet is given', () => {
  const ORIGIN = 'https://tickets.example.com';

  test('refuses non-strings, empty, oversized and transaction-looking messages', () => {
    expect(reviewSignMessageRequest(undefined, ORIGIN)).toHaveProperty('error');
    expect(reviewSignMessageRequest({ a: 1 }, ORIGIN)).toHaveProperty('error');
    expect(reviewSignMessageRequest('', ORIGIN)).toHaveProperty('error');
    expect(reviewSignMessageRequest('a'.repeat(MAX_SIGN_MESSAGE_BYTES + 1), ORIGIN)).toHaveProperty('error');
    expect('error' in reviewSignMessageRequest('a'.repeat(MAX_SIGN_MESSAGE_BYTES), ORIGIN)).toBe(false);
    for (const tx of ['{"type":"transfer","to":"x","amount":1}', ' {"tx_type":"stake","payload":{}}']) {
      const r = reviewSignMessageRequest(tx, ORIGIN) as { error: string };
      expect(r.error).toMatch(/Use signTransaction/);
    }
  });

  test('whole message, control characters visible, sign-in fields and the domain warning', () => {
    const plain = reviewSignMessageRequest('one\ntwo' + String.fromCharCode(0x0d, 0x202e), ORIGIN) as any;
    expect(plain.message).toBe('one\ntwo' + String.fromCharCode(0x0d, 0x202e));
    expect(plain.display).toBe('one\ntwo' + String.fromCharCode(0x240d, 0x27e8) + 'U+202E' + String.fromCharCode(0x27e9));
    expect(plain).toMatchObject({ lineCount: 2, signIn: null, domainMismatch: false });

    const mine = reviewSignMessageRequest(vector.message, ORIGIN, vector.address, 0) as any;
    expect(mine.signIn).toMatchObject({ domain: 'tickets.example.com', address: vector.address, nonce: '4f9c2d1e8a7b6c5d0011' });
    expect(mine).toMatchObject({ domainMismatch: false, addressMismatch: false });

    const otherSite = reviewSignMessageRequest(vector.message, 'https://evil.example', vector.address, 0) as any;
    expect(otherSite).toMatchObject({ domainMismatch: true, claimedDomain: 'tickets.example.com', originHost: 'evil.example' });

    const other = createSignInMessage({ ...mine.signIn, address: nativePubkeyToAddress(bytesToHex(ml_dsa65.keygen().publicKey)) });
    expect((reviewSignMessageRequest(other, ORIGIN, vector.address, 0) as any).addressMismatch).toBe(true);
  });
});

describe('provider wiring (source checks: the handler needs a WebView and the wallet store)', () => {
  const provider = read('lib/dapp-provider.ts');
  const section = provider.slice(provider.indexOf("case 'signMessage': {"), provider.indexOf("case 'sendTransaction': {"));

  test('window.rougechain.signMessage is injected and relays only { message }', () => {
    expect(provider).toContain("signMessage:function(params){return sendReq('signMessage',{message:params&&params.message});}");
  });

  test('the handler requires a connected origin, reviews the request and ALWAYS shows an approval', () => {
    expect(section.length).toBeGreaterThan(200);
    const connected = section.indexOf('if (!(await isConnected(request.origin)))');
    const review = section.indexOf('reviewSignMessageRequest(request.params?.message, request.origin, address)');
    const approval = section.indexOf('showApproval({');
    const sign = section.indexOf('signMessage(wallet.privateKey, review.message)');
    expect(connected).toBeGreaterThan(-1);
    expect(review).toBeGreaterThan(connected);
    expect(approval).toBeGreaterThan(review);
    // the only signature in the handler is inside the approval's resolve()
    expect(sign).toBeGreaterThan(section.indexOf('resolve: async () => {'));
    expect(section.match(/signMessage\(wallet\.privateKey/g)).toHaveLength(1);
    expect(section).not.toContain('ml_dsa65.sign(');
  });

  test('signTransaction refuses bytes that are a signMessage payload', () => {
    const gate = read('lib/sign-transaction-request.ts');
    expect(gate).toContain("if (hex.slice(0, 2) === '19') return { error: SIGN_TX_IS_MESSAGE };");
    expect(provider).toContain('await authorizeSignTransaction(request.params, request.origin, isConnected)');
    expect(messageSigningBytes('anything')[0]).toBe(0x19);
  });

  test('the approval sheet shows the review without truncation and has both languages', () => {
    const modal = read('components/dapp/ApprovalModal.tsx');
    const block = modal.slice(modal.indexOf("request.type === 'message' && review && ("), modal.indexOf("{!isEvm && request.type === 'send' && request.payload && ("));
    expect(block).toContain('{review.display}');
    expect(block).toContain('review.domainMismatch &&');
    expect(block).not.toContain('numberOfLines');
    expect(block).not.toContain('styles.codeBox'); // codeBox has a maxHeight that would clip
    const i18n = read('lib/i18n.tsx');
    for (const key of ['appr_message_label', 'appr_msg_domain_mismatch_title', 'appr_msg_domain_mismatch_body', 'appr_msg_full', 'appr_msg_sign_anyway']) {
      expect(i18n.match(new RegExp(`\\b${key}:`, 'g'))).toHaveLength(2);
    }
  });
});
