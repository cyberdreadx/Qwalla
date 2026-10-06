import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { bytesToHex, serializePayload } from '@rougechain/sdk';

import { messageSigningBytes } from '@/lib/sign-message';
import {
  SIGN_TX_BAD_HEX,
  SIGN_TX_INVALID_PAYLOAD,
  SIGN_TX_IS_MESSAGE,
  SIGN_TX_MISMATCH,
  SIGN_TX_NOT_CONNECTED,
  authorizeSignTransaction,
  prepareSignTransaction,
  type PreparedSignTransaction,
} from '@/lib/sign-transaction-request';

// dApp signTransaction: Qwalla signs only the canonical encoding of the payload it shows, for a
// connected site. The same rule as the browser extension.

const PK = 'ab'.repeat(1952);
const TO = 'cd'.repeat(1952);
const NOW = 1791200000000;
const NONCE = '00112233445566778899aabbccddeeff';
const base = { from: PK, timestamp: NOW, nonce: NONCE };

/** Independent reference for the canonical encoding (rougechain.io packages/core serializePayload). */
function referenceSort(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(referenceSort);
  if (obj !== null && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj as Record<string, unknown>).sort()) out[k] = referenceSort((obj as Record<string, unknown>)[k]);
    return out;
  }
  return obj;
}
const referenceText = (payload: unknown) => JSON.stringify(referenceSort(payload));
const hexOf = (text: string) => bytesToHex(new TextEncoder().encode(text));
/** What reaches the wallet: the page's params after the WebView bridge (JSON text). */
const overBridge = <T>(params: T): T => JSON.parse(JSON.stringify(params));
const connected = async () => true;
const notConnected = async () => false;

function accepted(r: { error: string } | PreparedSignTransaction): PreparedSignTransaction {
  if ('error' in r) throw new Error(r.error);
  return r;
}

describe('connected origin', () => {
  const params = { payload: { type: 'transfer', to: TO, amount: 1, ...base } };

  test('an unconnected origin is refused before anything else', async () => {
    expect(await authorizeSignTransaction(params, 'https://dapp.example', notConnected)).toEqual({ error: SIGN_TX_NOT_CONNECTED });
    // even with a perfectly matching serializedHex
    const withHex = { ...params, serializedHex: hexOf(referenceText(params.payload)) };
    expect(await authorizeSignTransaction(withHex, 'https://dapp.example', notConnected)).toEqual({ error: SIGN_TX_NOT_CONNECTED });
  });

  test('the lookup is asked about the requesting origin, and a failing lookup means not connected', async () => {
    const seen: string[] = [];
    const only = async (o: string) => { seen.push(o); return o === 'https://dapp.example'; };
    expect('error' in (await authorizeSignTransaction(params, 'https://dapp.example', only))).toBe(false);
    expect(await authorizeSignTransaction(params, 'https://other.example', only)).toEqual({ error: SIGN_TX_NOT_CONNECTED });
    expect(await authorizeSignTransaction(params, 'unknown', only)).toEqual({ error: SIGN_TX_NOT_CONNECTED });
    expect(seen).toEqual(['https://dapp.example', 'https://other.example', 'unknown']);
    const throws = async () => { throw new Error('storage'); };
    expect(await authorizeSignTransaction(params, 'https://dapp.example', throws)).toEqual({ error: SIGN_TX_NOT_CONNECTED });
    const truthy = (async () => 'yes') as unknown as (o: string) => Promise<boolean>;
    expect(await authorizeSignTransaction(params, 'https://dapp.example', truthy)).toEqual({ error: SIGN_TX_NOT_CONNECTED });
  });

  test('a connected origin gets the canonical bytes', async () => {
    const r = accepted(await authorizeSignTransaction(overBridge(params), 'https://dapp.example', connected));
    expect(r.signedText).toBe(referenceText(params.payload));
  });
});

describe('serializedHex must be the canonical bytes of the payload', () => {
  const payload = { type: 'transfer', to: TO, amount: 25, fee: 1, token: 'XRGE', ...base };
  const text = referenceText(payload);

  test('match accepted: signs exactly those bytes; hex case does not matter', () => {
    for (const serializedHex of [hexOf(text), hexOf(text).toUpperCase()]) {
      const r = accepted(prepareSignTransaction(overBridge({ payload, serializedHex })));
      expect(r.signedText).toBe(text);
      expect(bytesToHex(r.bytes)).toBe(hexOf(text));
      expect(r.bytes[0]).toBe(0x7b);
    }
  });

  test('mismatch refused: other payload, other field, other amount, other key order, extra bytes', () => {
    const others = [
      referenceText({ ...payload, to: PK }),
      referenceText({ ...payload, amount: 2500 }),
      referenceText({ ...payload, type: 'stake' }),
      referenceText({ ...payload, extra: 1 }),
      JSON.stringify(payload), // same content, insertion order instead of sorted keys
      JSON.stringify(referenceSort(payload), null, 1), // same content, other whitespace
      ' ' + text,
      text + ' ',
      text + text,
      '{}',
      'hello',
    ];
    for (const other of others) {
      expect(other).not.toBe(text);
      expect(prepareSignTransaction(overBridge({ payload, serializedHex: hexOf(other) }))).toEqual({ error: SIGN_TX_MISMATCH });
    }
  });

  test('0x19 refused: a signMessage payload is never signed as a transaction', () => {
    const forMessage = bytesToHex(messageSigningBytes('tickets.example.com wants you to sign in'));
    expect(forMessage.startsWith('19')).toBe(true);
    expect(prepareSignTransaction({ payload, serializedHex: forMessage })).toEqual({ error: SIGN_TX_IS_MESSAGE });
    expect(prepareSignTransaction({ payload, serializedHex: '19' })).toEqual({ error: SIGN_TX_IS_MESSAGE });
    expect(prepareSignTransaction({ payload, serializedHex: '19' + hexOf(text) })).toEqual({ error: SIGN_TX_IS_MESSAGE });
    // and nothing that is accepted can start with 0x19
    expect(accepted(prepareSignTransaction({ payload: { note: String.fromCharCode(0x19) + 'RougeChain Signed Message:\n' } })).bytes[0]).toBe(0x7b);
  });

  test('malformed serializedHex refused', () => {
    for (const serializedHex of ['', 'zz', 'abc', '0x' + hexOf(text), 5, {}, [hexOf(text)], true]) {
      expect(prepareSignTransaction({ payload, serializedHex })).toEqual({ error: SIGN_TX_BAD_HEX });
    }
  });

  test('serializedHex alone (no payload) is refused: there would be nothing to show', () => {
    expect(prepareSignTransaction({ serializedHex: hexOf(text) })).toEqual({ error: SIGN_TX_INVALID_PAYLOAD });
  });
});

describe('without serializedHex: the canonical bytes of the displayed payload', () => {
  test('signs sorted-key JSON of the payload, as before', () => {
    const payload = { type: 'transfer', to: TO, amount: 1, nested: { b: 1, a: [{ d: 1, c: 2 }] }, ...base };
    const r = accepted(prepareSignTransaction(overBridge({ payload })));
    expect(r.signedText).toBe(referenceText(payload));
    expect(bytesToHex(r.bytes)).toBe(bytesToHex(serializePayload(payload as never)));
    expect(prepareSignTransaction({ payload, serializedHex: null })).not.toHaveProperty('error');
  });

  test('a payload that is not an object is refused', () => {
    for (const payload of [undefined, null, 'text', 5, true, ['a'], []]) {
      expect(prepareSignTransaction({ payload })).toEqual({ error: SIGN_TX_INVALID_PAYLOAD });
    }
    for (const params of [undefined, null, 'x', 5, []]) {
      expect(prepareSignTransaction(params)).toEqual({ error: SIGN_TX_INVALID_PAYLOAD });
    }
  });

  test('what is shown is what is signed: the displayed payload re-encodes to the signed text', () => {
    const payload = { z: 1, type: 'swap', a: { y: [3, { q: 1, b: 2 }], x: 'x' }, ...base };
    const r = accepted(prepareSignTransaction(overBridge({ payload })));
    expect(JSON.stringify(r.payload)).toBe(r.signedText); // already in signed key order
    expect(new TextDecoder().decode(r.bytes)).toBe(r.signedText);
    expect(Object.keys(r.payload)).toEqual([...Object.keys(r.payload)].sort());
  });

  test('the signature verifies over the canonical bytes (what the node re-derives)', () => {
    const kp = ml_dsa65.keygen();
    const payload = { type: 'transfer', to: TO, amount: 1, ...base, from: bytesToHex(kp.publicKey) };
    const r = accepted(prepareSignTransaction(overBridge({ payload, serializedHex: hexOf(referenceText(payload)) })));
    const sig = ml_dsa65.sign(r.bytes, kp.secretKey);
    expect(ml_dsa65.verify(sig, new TextEncoder().encode(referenceText(payload)), kp.publicKey)).toBe(true);
  });
});

/**
 * Every first-party caller, with the payload shape it sends. rougechain.io (apps/web and the new
 * site) always goes through core's signViaExtension: { payload, serializedHex } where
 * serializedHex = hex(serializePayload(payload)). qRougee (rougee.app) passes the bare payload,
 * which the injected provider wraps as { payload }.
 */
describe('first-party payload shapes are accepted unchanged', () => {
  const site: Record<string, Record<string, unknown>> = {
    'send (secure-api transfer)': { type: 'transfer', to: TO, amount: 25, fee: 1, token: 'XRGE', ...base },
    'send a token with an account nonce': { type: 'transfer', to: 'rouge1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0jqxuzx8u', amount: 12.5, fee: 1, token: 'qUSDC', account_nonce: 7, ...base },
    'swap': { type: 'swap', token_in: 'XRGE', token_out: 'qETH', amount_in: 100, min_amount_out: 0.0421, ...base },
    'create pool': { type: 'create_pool', token_a: 'XRGE', token_b: 'TICKET', amount_a: 1000, amount_b: 50, ...base },
    'add liquidity': { type: 'add_liquidity', pool_id: 'TICKET-XRGE', amount_a: 10, amount_b: 0.5, ...base },
    'remove liquidity': { type: 'remove_liquidity', pool_id: 'TICKET-XRGE', lp_amount: 3, ...base },
    'stake': { type: 'stake', amount: 1000, fee: 1, ...base },
    'unstake': { type: 'unstake', amount: 250, fee: 1, ...base },
    'bridge withdraw (EVM)': { type: 'bridge_withdraw', amount: 500000, fee: 0.1, tokenSymbol: 'qETH', evmAddress: '0x52908400098527886E0F7030069857D2E4169EE7', ...base },
    'bridge withdraw (qBTC)': { type: 'bridge_withdraw', amount: 15000, fee: 0.1, tokenSymbol: 'qBTC', evmAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', ...base },
    'create token (mintable)': { type: 'create_token', token_name: 'Ticket', token_symbol: 'TICKET', initial_supply: 1000, fee: 100, mintable: true, max_supply: 5000, description: 'Entry — “VIP” ✓', ...base },
    'mint tokens': { type: 'mint_tokens', token_symbol: 'TICKET', amount: 10, fee: 1, ...base },
    'token approve': { type: 'approve', spender: TO, token_symbol: 'TICKET', amount: 100, ...base },
    'nft batch mint': { type: 'nft_batch_mint', collectionId: 'col:abc:SYM', names: ['A', 'B'], uris: ['ipfs://a', 'ipfs://b'], attributes: [{ rarity: 'rare' }, [{ trait_type: 'color', value: 'red' }]], ...base },
    'contract call (payable)': { type: 'contract_call', contractAddr: 'a3f1c2d4e5b697887766554433221100ffeeddcc', method: 'buy', args: { item: 3, tags: ['x', 'y'], nested: { z: null, a: 1.5 } }, gasLimit: 250000, attach: { symbol: 'XRGE', amount: 500000000 }, ...base },
    'contract deploy': { type: 'contract_deploy', wasm: 'AGFzbQEAAAA=', gasLimit: 1000000, ...base },
    'regenerate vote': { type: 'regen_vote', proposalId: 'prop-2026-10', choice: 'yes', ...base },
    'messenger signed request': { conversationId: 'c-1', encryptedContent: 'eyJ2IjoyfQ==', contentSignature: 'ab'.repeat(40), messageType: 'text', selfDestruct: false, destructAfterSeconds: 0, spoiler: false, ...base },
    'messenger register wallet': { id: PK, displayName: 'Zoë 日本', signingPublicKey: PK, encryptionPublicKey: 'ef'.repeat(1184), ...base },
    'mail send': { fromWalletId: PK, toWalletIds: [TO, PK], subjectEncrypted: 'c3ViamVjdA==', bodyEncrypted: 'Ym9keQ==', contentSignature: 'cd'.repeat(40), hasAttachment: false, ...base },
    'mail name registration': { name: 'alice', walletId: PK, ...base },
  };

  for (const [name, payload] of Object.entries(site)) {
    test(`rougechain.io: ${name}`, async () => {
      const text = referenceText(payload);
      // exactly what core's signViaExtension sends, after the WebView bridge
      const params = overBridge({ payload, serializedHex: hexOf(text) });
      const r = accepted(await authorizeSignTransaction(params, 'https://rougechain.io', connected));
      expect(r.signedText).toBe(text);
      expect(bytesToHex(r.bytes)).toBe(params.serializedHex); // the node gets these as payload_bytes_hex
      expect(r.bytes[0]).toBe(0x7b);
      // and one changed byte in the claimed bytes is refused
      const tampered = hexOf(text.replace(NONCE, NONCE.replace('0', '1')));
      expect(prepareSignTransaction(overBridge({ payload, serializedHex: tampered }))).toEqual({ error: SIGN_TX_MISMATCH });
    });
  }

  const qrougee: Record<string, Record<string, unknown>> = {
    'transfer': { type: 'transfer', to: TO, amount: 5, fee: 1, token: 'XRGE', ...base },
    'create token': { type: 'create_token', token_name: 'Track', token_symbol: 'TRK', initial_supply: 1000000, fee: 100, image: 'ipfs://bafy', ...base },
    'swap': { type: 'swap', token_in: 'XRGE', token_out: 'TRK', amount_in: 10, min_amount_out: 0, ...base },
    'create pool': { type: 'create_pool', token_a: 'XRGE', token_b: 'TRK', amount_a: 100, amount_b: 1000, ...base },
    'nft create collection': { type: 'nft_create_collection', symbol: 'SONG', name: 'My Song', maxSupply: 100, royaltyBps: 500, royaltyRecipient: undefined, description: 'A track', image: 'ipfs://bafy', publicMint: true, mintPrice: 5, fee: 50, ...base },
    'nft mint': { type: 'nft_mint', collectionId: 'col:abc:SONG', name: 'My Song #1', metadataUri: 'ipfs://bafy/1.json', attributes: { artist: 'x', bpm: 120 }, fee: 5, ...base },
    'nft transfer': { type: 'nft_transfer', collectionId: 'col:abc:SONG', tokenId: 1, to: TO, fee: 1, ...base },
    'nft burn': { type: 'nft_burn', collectionId: 'col:abc:SONG', tokenId: 1, fee: 1, ...base },
  };

  for (const [name, payload] of Object.entries(qrougee)) {
    test(`rougee.app (no serializedHex): ${name}`, async () => {
      const r = accepted(await authorizeSignTransaction(overBridge({ payload }), 'https://rougee.app', connected));
      // the node re-serialises the payload the dApp submits: sorted keys, undefined fields dropped
      expect(r.signedText).toBe(referenceText(payload));
      expect(r.signedText).toBe(JSON.stringify(referenceSort(JSON.parse(JSON.stringify(payload)))));
    });
  }
});

describe('provider wiring (source checks: the handler needs a WebView and the wallet store)', () => {
  const read = (p: string) => readFileSync(path.join(__dirname, '..', p), 'utf8');
  const provider = read('lib/dapp-provider.ts');
  const section = provider.slice(provider.indexOf("case 'signTransaction': {"), provider.indexOf("case 'signMessage': {"));

  test('the handler gates on authorizeSignTransaction with the connected-sites lookup, before the approval', () => {
    expect(section.length).toBeGreaterThan(200);
    const gate = section.indexOf('await authorizeSignTransaction(request.params, request.origin, isConnected)');
    const refuse = section.indexOf("if ('error' in prepared) {");
    const approval = section.indexOf('showApproval({');
    expect(gate).toBeGreaterThan(-1);
    expect(refuse).toBeGreaterThan(gate);
    expect(approval).toBeGreaterThan(refuse);
  });

  test('it signs the prepared bytes and nothing else; the sheet gets the same payload and text', () => {
    expect(section.match(/ml_dsa65\.sign\(/g)).toHaveLength(1);
    expect(section).toContain('ml_dsa65.sign(prepared.bytes, hexToBytes(wallet.privateKey))');
    expect(section).toContain('payload: prepared.payload,');
    expect(section).toContain('signedText: prepared.signedText,');
    expect(section).not.toContain('serializedHex');
    expect(section).not.toContain('hexToBytes(request');
  });

  test('the injected provider is unchanged: a bare payload is wrapped, an envelope is passed through', () => {
    expect(provider).toContain("signTransaction:function(params){return sendReq('signTransaction',params&&params.payload?params:{payload:params});}");
  });

  test('the sheet shows the whole signed payload and treats a RougeChain request as RougeChain', () => {
    const modal = read('components/dapp/ApprovalModal.tsx');
    expect(modal).toContain('const isEvm = !!p.evm && request.signedText === undefined;');
    const block = modal.slice(modal.indexOf("{!isEvm && request.type === 'sign' && ("), modal.indexOf("{request.type === 'message' && !review && ("));
    expect(block).toContain('JSON.stringify(request.payload, null, 2)');
    expect(block).toContain('styles.messageBox');
    expect(block).not.toContain('styles.codeBox');
    expect(block).not.toContain('numberOfLines');
  });
});
