import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import {
  MAINNET_CHAIN_ID,
  TESTNET_CHAIN_ID,
  bindWalletToChain,
  bytesToHex,
  createSignedContractCall,
  serializePayload,
} from '@rougechain/sdk';

import {
  CALL_ATTACH_TOO_LARGE,
  CALL_BAD_ARGS,
  CALL_BAD_ATTACH,
  CALL_BAD_ATTACH_AMOUNT,
  CALL_BAD_ATTACH_SYMBOL,
  CALL_BAD_CHAIN_ID,
  CALL_BAD_CONTRACT,
  CALL_BAD_GAS,
  CALL_BAD_METHOD,
  CALL_BALANCE_UNAVAILABLE,
  CALL_NEEDS_CONTRACT_AND_METHOD,
  CALL_NOT_CONNECTED,
  CONTRACT_MAX_GAS,
  authorizeCallContract,
  buildContractCallPayload,
  checkCallBalance,
  checkCallChainId,
  parseCallContractParams,
  signedCallBody,
  suggestGasLimit,
  type BalanceLike,
  type CallContractDeps,
  type CallContractRequest,
  type PreparedContractCall,
} from '@/lib/contract-call-request';

// window.rougechain.callContract (payable calls): Qwalla must sign exactly the contract_call bytes
// rougechain.io, the extension and @rougechain/sdk sign for the same inputs, with the payment in
// the same `attach: { symbol, amount }` field (integer quanta for XRGE, raw units for tokens),
// and — signatures commit to the network — the selected network's `chainId` inside those bytes.

interface Vector {
  name: string;
  contractAddr: string;
  method: string;
  args: unknown;
  argsOmitted: boolean;
  gasLimit: number;
  attach: { symbol: string; amount: number } | null;
  timestamp: number;
  nonce: string;
  network: 'mainnet' | 'testnet';
  chainId: string;
  payloadBytesHex: string;
}
const fixture = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures', 'contract-call-vectors.json'), 'utf8'),
) as { from: string; vectors: Vector[] };

const ORIGIN = 'https://game.example';
const ADDR = '86fe93e2a1b2c3d4e5f60718293a4b5c6d7e8f90';
const PK = 'ab'.repeat(1952);
const XRGE = 1_000_000_000;
const MAINNET = { name: 'RougeChain Mainnet', chainId: MAINNET_CHAIN_ID };
const TESTNET = { name: 'RougeChain Testnet', chainId: TESTNET_CHAIN_ID };
/** What reaches the wallet: the page's params after the WebView bridge (JSON text). */
const overBridge = <T>(params: T): T => JSON.parse(JSON.stringify(params));

function ok<T extends object>(r: T | { error: string }): T {
  if ('error' in r) throw new Error((r as { error: string }).error);
  return r as T;
}
function built(from: string, params: unknown, ts: number, nonce: string, chainId: string | null = MAINNET_CHAIN_ID): string {
  const req = ok(parseCallContractParams(overBridge(params)) as CallContractRequest | { error: string });
  const payload = buildContractCallPayload(from, { ...req, gasLimit: req.gasLimit! }, { chainId, timestamp: ts, nonce });
  return bytesToHex(serializePayload(payload));
}

function deps(over: Partial<CallContractDeps> & { balance?: BalanceLike } = {}) {
  const calls = { isConnected: [] as string[], getBalance: 0, estimateGas: [] as CallContractRequest[] };
  const d: CallContractDeps = {
    isConnected: async (o) => {
      calls.isConnected.push(o);
      return true;
    },
    getBalance: async () => {
      calls.getBalance++;
      return over.balance ?? { balance: 100, balance_quanta: String(100 * XRGE), token_balances_raw: { GOLD: '1000' } };
    },
    estimateGas: async (req) => {
      calls.estimateGas.push(req);
      return { gasUsed: 2000 };
    },
    network: async () => MAINNET,
    now: () => 1791200000000,
    nonce: () => '00112233445566778899aabbccddeeff',
    ...over,
  };
  return { d, calls };
}

// Vectors: the site's builder + signTransaction (which adds the selected network's chainId).
describe('same bytes as the site builder (fixed vectors from packages/core contracts.ts)', () => {
  test('the vectors cover both networks and every one names its chainId', () => {
    expect(new Set(fixture.vectors.map((v) => v.chainId))).toEqual(new Set([MAINNET_CHAIN_ID, TESTNET_CHAIN_ID]));
    for (const v of fixture.vectors) {
      expect(v.chainId).toBe(v.network === 'mainnet' ? MAINNET_CHAIN_ID : TESTNET_CHAIN_ID);
      expect(Buffer.from(v.payloadBytesHex, 'hex').toString('utf8')).toContain(`"chainId":"${v.chainId}"`);
    }
  });

  test.each(fixture.vectors.map((v) => [v.name, v] as const))('%s', (_name, v) => {
    const params: Record<string, unknown> = { contractAddr: v.contractAddr, method: v.method, gasLimit: v.gasLimit };
    if (!v.argsOmitted) params.args = v.args;
    if (v.attach) params.attach = v.attach;
    expect(built(fixture.from, params, v.timestamp, v.nonce, v.chainId)).toBe(v.payloadBytesHex);
  });

  test('authorizeCallContract on the selected network signs exactly the vector bytes', async () => {
    for (const v of fixture.vectors) {
      const { d } = deps({ network: async () => (v.network === 'mainnet' ? MAINNET : TESTNET), now: () => v.timestamp, nonce: () => v.nonce });
      const params: Record<string, unknown> = { contractAddr: v.contractAddr, method: v.method, gasLimit: v.gasLimit, chainId: v.chainId };
      if (!v.argsOmitted) params.args = v.args;
      if (v.attach) params.attach = v.attach;
      const balance = { balance_quanta: '100000000000000000000', token_balances_raw: { GOLD: '1000' } };
      const p = ok(await authorizeCallContract(overBridge(params), ORIGIN, fixture.from, { ...d, getBalance: async () => balance }));
      expect(bytesToHex(p.bytes)).toBe(v.payloadBytesHex);
    }
  });

  test('the dApp may send the symbol in lower case and the amount as a digit string (SDK normalization)', () => {
    const v = fixture.vectors.find((x) => x.attach?.symbol === 'GOLD')!;
    const params = {
      contractAddr: v.contractAddr,
      method: v.method,
      args: v.args,
      gasLimit: v.gasLimit,
      attach: { symbol: ' gold ', amount: String(v.attach!.amount) },
    };
    expect(built(fixture.from, params, v.timestamp, v.nonce, v.chainId)).toBe(v.payloadBytesHex);
  });

  test('the legacy `address` / `contract` names reach the same payload as `contractAddr`', () => {
    const v = fixture.vectors[0];
    for (const key of ['address', 'contract']) {
      const params = { [key]: v.contractAddr, method: v.method, args: v.args, gasLimit: v.gasLimit };
      expect(built(fixture.from, params, v.timestamp, v.nonce, v.chainId)).toBe(v.payloadBytesHex);
    }
  });
});

// @rougechain/sdk >= 1.15.0: a wallet bound with bindWalletToChain signs `chainId` into the call.
describe('same bytes as the published @rougechain/sdk createSignedContractCall', () => {
  const kp = ml_dsa65.keygen(new Uint8Array(32).fill(7));
  const wallet = { publicKey: bytesToHex(kp.publicKey), privateKey: bytesToHex(kp.secretKey) };

  test.each([
    ['non-payable', undefined, MAINNET_CHAIN_ID],
    ['0.5 XRGE', { symbol: 'XRGE', amount: 500_000_000 }, MAINNET_CHAIN_ID],
    ['token', { symbol: 'GOLD', amount: 25 }, TESTNET_CHAIN_ID],
    ['0.5 XRGE, unbound wallet ↔ no chain id (unreached devnet)', { symbol: 'XRGE', amount: 500_000_000 }, null],
  ] as const)('%s', (_n, attach, chainId) => {
    const signer = chainId ? bindWalletToChain(wallet, chainId) : wallet;
    const sdk = createSignedContractCall(signer, ADDR.toUpperCase(), 'pay', { n: 1 }, 123_456, undefined, attach as never) as {
      payload: Record<string, unknown>;
      payload_bytes_hex: string;
    };
    expect(sdk.payload.chainId).toBe(chainId ?? undefined);
    const params: Record<string, unknown> = { contractAddr: ADDR.toUpperCase(), method: 'pay', args: { n: 1 }, gasLimit: 123_456 };
    if (attach) params.attach = attach;
    const mine = built(wallet.publicKey, params, sdk.payload.timestamp as number, sdk.payload.nonce as string, chainId);
    expect(mine).toBe(sdk.payload_bytes_hex);
  });
});

describe('a non-payable call is unchanged', () => {
  const base = { contractAddr: ADDR, method: 'roll', args: { bet: 3 }, gasLimit: 300_000 };

  test('no attach, attach: null and attach: undefined give identical bytes with no `attach` field', () => {
    // (the only field a non-payable call gained is the network's chainId)
    const a = built(PK, base, 1, 'n0000000');
    expect(built(PK, { ...base, attach: null }, 1, 'n0000000')).toBe(a);
    expect(built(PK, { ...base, attach: undefined }, 1, 'n0000000')).toBe(a);
    const text = Buffer.from(a, 'hex').toString('utf8');
    expect(text).not.toContain('attach');
    expect(JSON.parse(text)).toEqual({
      args: { bet: 3 },
      chainId: MAINNET_CHAIN_ID,
      contractAddr: ADDR,
      from: PK,
      gasLimit: 300_000,
      method: 'roll',
      nonce: 'n0000000',
      timestamp: 1,
      type: 'contract_call',
    });
  });

  test('args default to {} like the site and the SDK', () => {
    const r = ok(parseCallContractParams({ contractAddr: ADDR, method: 'ping' }) as CallContractRequest | { error: string });
    expect(r.args).toEqual({});
    expect(r.attach).toBeNull();
    expect(r.gasLimit).toBeUndefined();
  });

  test('the review says no payment, and the max total is just the fee', async () => {
    const { d } = deps();
    const p = ok(await authorizeCallContract(base, ORIGIN, PK, d));
    expect(p.review.attach).toBeNull();
    expect(p.review.maxFeeXrge).toBe('0.3');
    expect(p.review.maxTotalXrge).toBe('0.3');
    expect(p.review.large).toBe(false);
  });
});

describe('validation refusals', () => {
  const base = { contractAddr: ADDR, method: 'pay', gasLimit: 100_000 };
  const refuse = (params: unknown, error: string) => expect(parseCallContractParams(params)).toEqual({ error });

  test('attach.amount must be a positive safe integer (quanta / raw units)', () => {
    for (const amount of [0, -1, 1.5, 0.5, '0.5', '1e3', '-5', '', ' ', null, true, {}, [], NaN, Infinity]) {
      refuse({ ...base, attach: { symbol: 'XRGE', amount } }, CALL_BAD_ATTACH_AMOUNT);
    }
    refuse({ ...base, attach: { symbol: 'XRGE' } }, CALL_BAD_ATTACH_AMOUNT);
    refuse({ ...base, attach: { symbol: 'XRGE', amount: '0' } }, CALL_BAD_ATTACH_AMOUNT);
    refuse({ ...base, attach: { symbol: 'XRGE', amount: Number.MAX_SAFE_INTEGER + 1 } }, CALL_ATTACH_TOO_LARGE);
    refuse({ ...base, attach: { symbol: 'XRGE', amount: '9007199254740992' } }, CALL_ATTACH_TOO_LARGE);
    expect(parseCallContractParams({ ...base, attach: { symbol: 'XRGE', amount: Number.MAX_SAFE_INTEGER } })).toMatchObject({
      attach: { symbol: 'XRGE', amount: Number.MAX_SAFE_INTEGER },
    });
  });

  test('attach.symbol must be XRGE or a token symbol (node parse_attach rules)', () => {
    for (const symbol of ['', ' ', 'XR GE', 'X.RGE', 'A'.repeat(33), 'Ξ', 5, null, undefined]) {
      refuse({ ...base, attach: { symbol, amount: 1 } }, CALL_BAD_ATTACH_SYMBOL);
    }
    expect(parseCallContractParams({ ...base, attach: { symbol: 'a'.repeat(32), amount: 1 } })).toMatchObject({
      attach: { symbol: 'A'.repeat(32) },
    });
    expect(parseCallContractParams({ ...base, attach: { symbol: 'q-usd_2', amount: 1 } })).toMatchObject({
      attach: { symbol: 'Q-USD_2' },
    });
  });

  test('attach must be an object', () => {
    for (const attach of [1, 'XRGE', [1], true]) refuse({ ...base, attach }, CALL_BAD_ATTACH);
  });

  test('gasLimit is bounded to 1..10,000,000 integers', () => {
    for (const gasLimit of [0, -1, 1.5, CONTRACT_MAX_GAS + 1, '100', NaN]) refuse({ ...base, gasLimit }, CALL_BAD_GAS);
    expect(parseCallContractParams({ ...base, gasLimit: CONTRACT_MAX_GAS })).toMatchObject({ gasLimit: CONTRACT_MAX_GAS });
    expect(() => buildContractCallPayload(PK, { contractAddr: ADDR, method: 'm', args: {}, attach: null, gasLimit: 0 }, { chainId: MAINNET_CHAIN_ID })).toThrow(
      CALL_BAD_GAS,
    );
  });

  test('contract and method are required and sane', () => {
    refuse({ method: 'pay' }, CALL_NEEDS_CONTRACT_AND_METHOD);
    refuse({ contractAddr: ADDR }, CALL_NEEDS_CONTRACT_AND_METHOD);
    refuse({ contractAddr: ADDR, method: '' }, CALL_NEEDS_CONTRACT_AND_METHOD);
    refuse(undefined, CALL_NEEDS_CONTRACT_AND_METHOD);
    refuse({ contractAddr: 'rouge1qqqqqqqqqqqqqqqqqqqqqq', method: 'pay' }, CALL_BAD_CONTRACT);
    refuse({ contractAddr: 'abc', method: 'pay' }, CALL_BAD_CONTRACT);
    refuse({ contractAddr: ADDR, method: 'pay\nall' }, CALL_BAD_METHOD);
    refuse({ contractAddr: ADDR, method: 'pay‮evil' }, CALL_BAD_METHOD);
    refuse({ contractAddr: ADDR, method: 'pay', args: () => 1 }, CALL_BAD_ARGS);
  });
});

describe('balance check before approval', () => {
  const gas = 1_000_000; // max fee 1 XRGE
  const xrgePay = (n: number) => ({ symbol: 'XRGE', amount: n });

  test('XRGE: payment + max fee must fit the spendable XRGE (exact quanta)', () => {
    const bal = { balance_quanta: String(3 * XRGE) };
    expect(checkCallBalance(bal, gas, xrgePay(2 * XRGE))).not.toHaveProperty('error'); // exactly enough
    const r = checkCallBalance(bal, gas, xrgePay(2 * XRGE + 1));
    expect(r).toEqual({
      error: 'Insufficient XRGE for the gas fee and the attached payment: have 3 XRGE, need 3.000000001 XRGE',
    });
  });

  test('the fee alone must fit, for any call', () => {
    expect(checkCallBalance({ balance_quanta: '999999999' }, gas, null)).toEqual({
      error: 'Insufficient XRGE for the gas fee: have 0.999999999 XRGE, need 1 XRGE',
    });
    // a token payment still needs XRGE for the fee
    expect(checkCallBalance({ balance_quanta: '0', token_balances_raw: { GOLD: '50' } }, gas, { symbol: 'GOLD', amount: 1 })).toHaveProperty(
      'error',
    );
  });

  test('token: the amount must fit that token balance (raw units)', () => {
    const bal = { balance_quanta: String(5 * XRGE), token_balances_raw: { GOLD: '100' } };
    expect(checkCallBalance(bal, gas, { symbol: 'GOLD', amount: 100 })).not.toHaveProperty('error');
    expect(checkCallBalance(bal, gas, { symbol: 'GOLD', amount: 101 })).toEqual({
      error: 'Insufficient GOLD for the attached payment: have 100, need 101',
    });
    expect(checkCallBalance(bal, gas, { symbol: 'SILVER', amount: 1 })).toEqual({
      error: 'Insufficient SILVER for the attached payment: have 0, need 1',
    });
  });

  test('older nodes without the exact fields: float balances, floored', () => {
    expect(checkCallBalance({ balance: 2.5 }, gas, xrgePay(1.5 * XRGE))).not.toHaveProperty('error');
    expect(checkCallBalance({ balance: 2.5 }, gas, xrgePay(1.5 * XRGE + 1))).toHaveProperty('error');
    expect(checkCallBalance({ balance: 5, token_balances: { GOLD: 10 } }, gas, { symbol: 'GOLD', amount: 11 })).toHaveProperty('error');
    expect(checkCallBalance({}, gas, null)).toEqual({ error: CALL_BALANCE_UNAVAILABLE });
  });

  test(`"large" (red sheet) from 50% of the asset's spendable balance`, () => {
    const bal = { balance_quanta: String(10 * XRGE), token_balances_raw: { GOLD: '1000' } };
    expect(checkCallBalance(bal, 1, xrgePay(5 * XRGE))).toMatchObject({ large: true, attachBalanceDisplay: '10 XRGE' });
    expect(checkCallBalance(bal, 1, xrgePay(5 * XRGE - 1))).toMatchObject({ large: false });
    expect(checkCallBalance(bal, 1, { symbol: 'GOLD', amount: 500 })).toMatchObject({ large: true, attachBalanceDisplay: '1000 GOLD' });
    expect(checkCallBalance(bal, 1, { symbol: 'GOLD', amount: 499 })).toMatchObject({ large: false });
  });

  test('authorizeCallContract refuses an unaffordable call before any sheet', async () => {
    const { d } = deps({ balance: { balance_quanta: String(XRGE) } });
    const r = await authorizeCallContract(
      { contractAddr: ADDR, method: 'pay', gasLimit: 100_000, attach: { symbol: 'XRGE', amount: XRGE } },
      ORIGIN,
      PK,
      d,
    );
    expect(r).toEqual({ error: 'Insufficient XRGE for the gas fee and the attached payment: have 1 XRGE, need 1.1 XRGE' });
  });

  test('a failing balance lookup is a refusal, not an approval', async () => {
    const { d } = deps({ getBalance: async () => { throw new Error('offline'); } });
    expect(await authorizeCallContract({ contractAddr: ADDR, method: 'pay', gasLimit: 1 }, ORIGIN, PK, d)).toEqual({
      error: CALL_BALANCE_UNAVAILABLE,
    });
  });
});

describe('connected origin', () => {
  const params = { contractAddr: ADDR, method: 'pay', gasLimit: 1000, attach: { symbol: 'XRGE', amount: 1 } };

  test('an unconnected origin is refused before anything else (no balance read, no dry run)', async () => {
    const { d, calls } = deps({ isConnected: async () => false });
    expect(await authorizeCallContract(params, ORIGIN, PK, d)).toEqual({ error: CALL_NOT_CONNECTED });
    expect(calls.getBalance).toBe(0);
    expect(calls.estimateGas).toHaveLength(0);
    // even with bad params, the origin check comes first
    expect(await authorizeCallContract({}, ORIGIN, PK, d)).toEqual({ error: CALL_NOT_CONNECTED });
  });

  test('the lookup is asked about the requesting origin, and a failing lookup means not connected', async () => {
    const { d, calls } = deps();
    ok(await authorizeCallContract(params, ORIGIN, PK, d));
    expect(calls.isConnected).toEqual([ORIGIN]);
    const { d: d2 } = deps({ isConnected: async () => { throw new Error('storage'); } });
    expect(await authorizeCallContract(params, ORIGIN, PK, d2)).toEqual({ error: CALL_NOT_CONNECTED });
  });
});

describe('what is signed and shown', () => {
  test('signed bytes = canonical encoding of the displayed payload; the submit body carries the same bytes', async () => {
    const kp = ml_dsa65.keygen(new Uint8Array(32).fill(9));
    const pk = bytesToHex(kp.publicKey);
    const { d } = deps();
    const p: PreparedContractCall = ok(
      await authorizeCallContract(
        { contractAddr: ADDR.toUpperCase(), method: 'pay_min', args: { b: 1, a: [2] }, gasLimit: 100_000, attach: { symbol: 'xrge', amount: 500_000_000 } },
        ORIGIN,
        pk,
        d,
      ),
    );
    expect(bytesToHex(serializePayload(p.payload))).toBe(bytesToHex(p.bytes));
    expect(new TextDecoder().decode(p.bytes)).toBe(p.signedText);
    expect(Object.keys(p.payload)).toEqual([...Object.keys(p.payload)].sort());
    expect(p.payload.attach).toEqual({ amount: 500_000_000, symbol: 'XRGE' });

    const sig = ml_dsa65.sign(p.bytes, kp.secretKey);
    const body = signedCallBody(p, bytesToHex(sig), pk);
    expect(body.payload_bytes_hex).toBe(bytesToHex(p.bytes));
    expect(body.payload).toBe(p.payload);
    expect(ml_dsa65.verify(sig, new TextEncoder().encode(JSON.stringify(body.payload)), kp.publicKey)).toBe(true);

    expect(p.review).toMatchObject({
      contractAddr: ADDR,
      method: 'pay_min',
      gasLimit: 100_000,
      gasLimitEstimated: false,
      maxFeeXrge: '0.1',
      attach: { symbol: 'XRGE', amount: 500_000_000, display: '0.5' },
      maxTotalXrge: '0.6',
      attachBalanceDisplay: '100 XRGE',
      large: false,
      network: { name: 'RougeChain Mainnet', chainId: MAINNET_CHAIN_ID, missingChainId: true },
    });
    expect(p.payload.chainId).toBe(MAINNET_CHAIN_ID);
    expect(p.review.argsPretty).toBe(JSON.stringify({ a: [2], b: 1 }, null, 2));
  });

  test('without gasLimit the call is dry-run (with caller and payment) and the SDK rule is signed', async () => {
    const { d, calls } = deps({ estimateGas: async (req) => { calls.estimateGas.push(req); return { gasUsed: 40_000 }; } });
    const p = ok(
      await authorizeCallContract({ contractAddr: ADDR, method: 'roll', attach: { symbol: 'GOLD', amount: 7 } }, ORIGIN, PK, d),
    );
    expect(calls.estimateGas).toHaveLength(1);
    expect(calls.estimateGas[0].attach).toEqual({ symbol: 'GOLD', amount: 7 });
    expect(p.review.gasLimit).toBe(suggestGasLimit(40_000));
    expect(p.review.gasLimit).toBe(61_000);
    expect(p.review.gasLimitEstimated).toBe(true);
    expect(p.review.attach).toMatchObject({ display: '7', symbol: 'GOLD' });
    expect(suggestGasLimit(9_000_000)).toBe(CONTRACT_MAX_GAS);
  });

  test('a dry run that fails is refused (nothing to sign)', async () => {
    const { d } = deps({ estimateGas: async () => ({ error: 'trap: below minimum' }) });
    expect(await authorizeCallContract({ contractAddr: ADDR, method: 'pay_min' }, ORIGIN, PK, d)).toEqual({
      error: 'call would fail: trap: below minimum',
    });
  });
});

describe('network binding: the call is signed for the selected network only', () => {
  const params = { contractAddr: ADDR, method: 'pay', gasLimit: 100_000, attach: { symbol: 'XRGE', amount: XRGE } };

  test("the payload carries the selected network's chainId, inside the signed bytes", async () => {
    const kp = ml_dsa65.keygen(new Uint8Array(32).fill(5));
    const pk = bytesToHex(kp.publicKey);
    for (const net of [MAINNET, TESTNET]) {
      const { d } = deps({ network: async () => net });
      const p = ok(await authorizeCallContract(params, ORIGIN, pk, d));
      expect(p.payload.chainId).toBe(net.chainId);
      expect(p.signedText).toContain(`"chainId":"${net.chainId}"`);
      expect(p.review.network).toEqual({ name: net.name, chainId: net.chainId, missingChainId: true });
      // the signature does not verify for the same call re-targeted to the other network
      const sig = ml_dsa65.sign(p.bytes, kp.secretKey);
      const other = net === MAINNET ? TESTNET_CHAIN_ID : MAINNET_CHAIN_ID;
      expect(ml_dsa65.verify(sig, serializePayload({ ...p.payload, chainId: other }), kp.publicKey)).toBe(false);
      expect(ml_dsa65.verify(sig, serializePayload(p.payload), kp.publicKey)).toBe(true);
    }
  });

  test("a dApp chainId equal to the selected network's is accepted without a warning", async () => {
    const { d } = deps();
    const p = ok(await authorizeCallContract({ ...params, chainId: MAINNET_CHAIN_ID }, ORIGIN, PK, d));
    expect(p.review.network).toEqual({ name: 'RougeChain Mainnet', chainId: MAINNET_CHAIN_ID, missingChainId: false });
  });

  test('a dApp chainId for another network is refused before the dry run and the balance read', async () => {
    const { d, calls } = deps();
    const r = await authorizeCallContract({ contractAddr: ADDR, method: 'pay', chainId: TESTNET_CHAIN_ID }, ORIGIN, PK, d);
    expect(r).toEqual({
      error: 'This request is for RougeChain Testnet, but Qwalla is on RougeChain Mainnet. Switch networks in Qwalla and try again.',
    });
    expect(calls.estimateGas).toHaveLength(0);
    expect(calls.getBalance).toBe(0);
    expect(await authorizeCallContract({ ...params, chainId: 'rougechain-other-7' }, ORIGIN, PK, d)).toEqual({
      error: 'This request is for Unknown network (rougechain-other-7), but Qwalla is on RougeChain Mainnet. Switch networks in Qwalla and try again.',
    });
  });

  test('a chainId that is not a non-empty string is refused', () => {
    for (const chainId of [1, 8453, '', true, {}, ['rougechain-mainnet-1']]) {
      expect(parseCallContractParams({ ...params, chainId })).toEqual({ error: CALL_BAD_CHAIN_ID });
    }
    expect(parseCallContractParams({ ...params, chainId: null })).not.toHaveProperty('chainId');
  });

  test('the extension-style payload (sendTransaction contract_call) is gated the same way', async () => {
    const { d } = deps();
    const extPayload = { type: 'contract_call', ...params, chainId: TESTNET_CHAIN_ID };
    expect(await authorizeCallContract(overBridge(extPayload), ORIGIN, PK, d)).toHaveProperty('error');
    ok(await authorizeCallContract(overBridge({ ...extPayload, chainId: MAINNET_CHAIN_ID }), ORIGIN, PK, d));
  });

  test("a node reporting another chain id (session check failed) refuses everything; nothing is asked of it", async () => {
    const { d, calls } = deps({
      network: async () => {
        throw new Error('Refusing to sign: Mainnet expects chain id "rougechain-mainnet-1" but the node reports "rougechain-devnet-1".');
      },
    });
    expect(await authorizeCallContract({ contractAddr: ADDR, method: 'pay' }, ORIGIN, PK, d)).toEqual({
      error: 'Refusing to sign: Mainnet expects chain id "rougechain-mainnet-1" but the node reports "rougechain-devnet-1".',
    });
    expect(calls.estimateGas).toHaveLength(0);
    expect(calls.getBalance).toBe(0);
  });

  test('an unreached local devnet: no chainId key (nothing to bind), and a dApp naming one is refused', async () => {
    const devnet = { name: 'RougeChain Devnet', chainId: null };
    const { d } = deps({ network: async () => devnet });
    const p = ok(await authorizeCallContract(params, ORIGIN, PK, d));
    expect(p.payload).not.toHaveProperty('chainId');
    expect(p.review.network).toEqual({ name: 'RougeChain Devnet', chainId: null, missingChainId: true });
    expect(await authorizeCallContract({ ...params, chainId: 'rougechain-local-9' }, ORIGIN, PK, d)).toEqual({
      error: 'Cannot confirm the chain id of RougeChain Devnet: its node is not reachable.',
    });
  });

  test('checkCallChainId: match / missing / other', () => {
    expect(checkCallChainId(MAINNET_CHAIN_ID, MAINNET)).toEqual({ missingChainId: false });
    expect(checkCallChainId(undefined, MAINNET)).toEqual({ missingChainId: true });
    expect(checkCallChainId(MAINNET_CHAIN_ID, TESTNET)).toHaveProperty('error');
  });
});

describe('approval sheet and provider (source checks: React Native does not render under this runner)', () => {
  const root = path.join(__dirname, '..');
  const modal = readFileSync(path.join(root, 'components/dapp/ApprovalModal.tsx'), 'utf8');
  const i18n = readFileSync(path.join(root, 'lib/i18n.tsx'), 'utf8');
  const provider = readFileSync(path.join(root, 'lib/dapp-provider.ts'), 'utf8');

  test('the sending line names amount, symbol and the FULL contract address, above method and arguments', () => {
    expect(i18n).toContain('appr_ctr_sending: "You are sending {amount} {symbol} to contract {contract}"');
    const section = modal.slice(modal.indexOf("request.type === 'contract' && call && ("));
    const sending = section.indexOf("t('appr_ctr_sending')");
    expect(sending).toBeGreaterThan(0);
    expect(section).toContain(".replace('{amount}', call.attach.display)");
    expect(section).toContain(".replace('{symbol}', call.attach.symbol)");
    expect(section).toContain(".replace('{contract}', call.contractAddr)");
    expect(sending).toBeLessThan(section.indexOf("t('appr_ctr_method')"));
    expect(sending).toBeLessThan(section.indexOf("t('appr_ctr_args')"));
    // the address is never shortened in this section
    const end = section.indexOf("request.type === 'send'");
    expect(section.slice(0, end)).not.toMatch(/contractAddr[^}]*\.slice\(/);
  });

  test('the sheet shows the max fee, the max total and the exact signed text, and turns red for a large payment', () => {
    expect(modal).toContain('{call.maxFeeXrge} XRGE');
    expect(modal).toContain('{call.maxTotalXrge} XRGE');
    expect(modal).toContain('{request.signedText}');
    expect(modal).toContain("t('appr_ctr_large_title')");
    expect(modal).toContain("messageDanger || callDanger ? '#EF4444'");
    expect(modal).toMatch(/request\.type === 'contract' && \(!call \|\| request\.signedText === undefined\)/);
  });

  test('every new string exists in English and Spanish', () => {
    const keys = [...new Set(modal.match(/appr_ctr_[a-z_]+/g))];
    expect(keys.length).toBeGreaterThan(10);
    for (const k of keys) expect(i18n.split(`${k}:`).length - 1).toBe(2);
  });

  test('the provider routes callContract through the gate and advertises the capability', () => {
    const c = provider.slice(provider.indexOf('async function handleCallContract('), provider.indexOf('export async function handleDappRequest('));
    expect(c.indexOf('authorizeCallContract(')).toBeGreaterThan(0);
    expect(c.indexOf('authorizeCallContract(')).toBeLessThan(c.indexOf('showApproval('));
    expect(c).toContain('ml_dsa65.sign(prepared.bytes');
    expect(c).toContain("'/v2/contract/execute'");
    expect(c).not.toContain('rc.shielded.callContract');
    expect(provider).toContain('capabilities:Object.freeze({signMessage:true,payableCalls:true})');
    const cc = provider.slice(provider.indexOf("case 'callContract': {"), provider.indexOf("case 'signTransaction': {"));
    expect(cc).toContain('handleCallContract(request, request.params,');
    expect(cc).not.toContain('rc.shielded.callContract');
  });

  test('the provider cross-checks the network with its node and refuses to sign after a network switch', () => {
    const c = provider.slice(provider.indexOf('async function handleCallContract('), provider.indexOf('export async function handleDappRequest('));
    const net = c.indexOf('const network = getActiveNetworkId();');
    expect(net).toBeGreaterThan(0);
    expect(net).toBeLessThan(c.indexOf('authorizeCallContract('));
    expect(c).toContain('chainId: await verifyChainId(network)');
    const resolve = c.slice(c.indexOf('resolve: async () => {'));
    expect(resolve.indexOf('getActiveNetworkId() !== network')).toBeGreaterThan(0);
    expect(resolve.indexOf('getActiveNetworkId() !== network')).toBeLessThan(resolve.indexOf('ml_dsa65.sign('));
    expect(c).toContain('chainId: prepared.review.network.chainId');
  });

  test('the sheet shows the network the call is signed for, and warns when the dApp named none', () => {
    const section = modal.slice(modal.indexOf("request.type === 'contract' && call && ("));
    const end = section.indexOf("request.type === 'send'");
    const contract = section.slice(0, end);
    expect(contract).toContain("t('appr_network')");
    expect(contract).toContain('{call.network.name}');
    expect(contract).toContain('call.network.missingChainId && (');
    expect(contract).toContain("t('appr_ctr_no_chain_id').replace('{network}', call.network.name)");
    expect(i18n).toContain('appr_ctr_no_chain_id: "This site did not say which network this call is for.');
  });

  test("an extension-style sendTransaction({ payload: { type: 'contract_call', … } }) takes the same gate", () => {
    const st = provider.slice(provider.indexOf("case 'sendTransaction': {"));
    const route = st.indexOf("txPayload.type === 'contract_call'");
    expect(route).toBeGreaterThan(0);
    expect(route).toBeLessThan(st.indexOf('rc.transfer('));
    expect(st).toContain('handleCallContract(request, txPayload,');
    expect(st).toContain("txPayload.from !== wallet.publicKey");
  });
});
