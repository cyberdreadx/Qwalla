const mockRcGet = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/lib/rougechain', () => ({ rc: { get: (...a: unknown[]) => mockRcGet(...a) } }));
jest.mock('@/lib/evm-rpc', () => ({
  rpc: (...a: unknown[]) => mockRpc(...a),
  getChain: () => ({ rpcUrl: 'http://rpc' }),
  EVM_CHAINS: { 8453: { rpcUrl: 'http://rpc' } },
}));

import { reconcileSend, reconcileBaseSend } from '@/lib/tx-reconcile';

const entry = (payload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}, txId = 'new1') => ({
  tx_id: txId,
  tx: { payload: { to: 'rouge1abc', amount: 1000, token_symbol: 'XRGE', ...payload }, ...extra },
});

const base = { address: 'rouge1me', to: 'rouge1abc', amount: 1000, token: 'XRGE', timeoutMs: 40, intervalMs: 5 };

beforeEach(() => {
  mockRcGet.mockReset();
  mockRpc.mockReset();
});

describe('reconcileSend (RougeChain)', () => {
  it('confirms a matching new transfer', async () => {
    mockRcGet.mockResolvedValue([entry()]);
    expect(await reconcileSend({ ...base, knownIds: new Set() })).toBe(true);
  });

  it('does not confirm when the amount differs', async () => {
    mockRcGet.mockResolvedValue([entry()]);
    expect(await reconcileSend({ ...base, amount: 999, knownIds: new Set() })).toBe(false);
  });

  it('does not confirm when the recipient differs', async () => {
    mockRcGet.mockResolvedValue([entry()]);
    expect(await reconcileSend({ ...base, to: 'rouge1other', knownIds: new Set() })).toBe(false);
  });

  it('ignores a tx that was already in the baseline', async () => {
    mockRcGet.mockResolvedValue([entry()]);
    expect(await reconcileSend({ ...base, knownIds: new Set(['new1']) })).toBe(false);
  });

  it('keeps polling through a transient fetch error', async () => {
    mockRcGet.mockRejectedValueOnce(new Error('network')).mockResolvedValue([entry()]);
    expect(await reconcileSend({ ...base, knownIds: new Set() })).toBe(true);
  });

  it('confirms a shield by tx type + amount (no recipient)', async () => {
    mockRcGet.mockResolvedValue([entry({ to: undefined }, { tx_type: 'shield' })]);
    expect(
      await reconcileSend({
        address: 'rouge1me',
        amount: 1000,
        token: 'XRGE',
        txTypeIncludes: 'shield',
        knownIds: new Set(),
        timeoutMs: 40,
        intervalMs: 5,
      }),
    ).toBe(true);
  });

  it('does not treat a plain transfer as a shield', async () => {
    mockRcGet.mockResolvedValue([entry({ to: undefined }, { tx_type: 'transfer' })]);
    expect(
      await reconcileSend({
        address: 'rouge1me',
        amount: 1000,
        token: 'XRGE',
        txTypeIncludes: 'shield',
        knownIds: new Set(),
        timeoutMs: 30,
        intervalMs: 5,
      }),
    ).toBe(false);
  });
});

describe('reconcileBaseSend (EVM nonce)', () => {
  it('confirms when the nonce has advanced past the baseline', async () => {
    mockRpc.mockResolvedValue('0x5'); // 5 > 4
    expect(
      await reconcileBaseSend({ chainId: 8453, address: '0xabc', nonceBefore: 4, timeoutMs: 40, intervalMs: 5 }),
    ).toBe(true);
  });

  it('does not confirm when the nonce is unchanged', async () => {
    mockRpc.mockResolvedValue('0x4'); // 4, not > 4
    expect(
      await reconcileBaseSend({ chainId: 8453, address: '0xabc', nonceBefore: 4, timeoutMs: 30, intervalMs: 5 }),
    ).toBe(false);
  });

  it('returns false immediately without a baseline nonce', async () => {
    expect(await reconcileBaseSend({ chainId: 8453, address: '0xabc', nonceBefore: null })).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
