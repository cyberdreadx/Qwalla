const mockRcGet = jest.fn();
jest.mock('@/lib/rougechain', () => ({ rc: { get: (...a: unknown[]) => mockRcGet(...a) } }));

import { reconcileSend } from '@/lib/tx-reconcile';

const entry = (payload: Record<string, unknown> = {}, txId = 'new1') => ({
  tx_id: txId,
  tx: { payload: { to: 'rouge1abc', amount: 1000, token_symbol: 'XRGE', ...payload } },
});

const base = { address: 'rouge1me', to: 'rouge1abc', amount: 1000, token: 'XRGE', timeoutMs: 40, intervalMs: 5 };

beforeEach(() => mockRcGet.mockReset());

test('confirms a matching new transfer', async () => {
  mockRcGet.mockResolvedValue([entry()]);
  expect(await reconcileSend({ ...base, knownIds: new Set() })).toBe(true);
});

test('does not confirm when the amount differs', async () => {
  mockRcGet.mockResolvedValue([entry()]);
  expect(await reconcileSend({ ...base, amount: 999, knownIds: new Set() })).toBe(false);
});

test('does not confirm when the recipient differs', async () => {
  mockRcGet.mockResolvedValue([entry()]);
  expect(await reconcileSend({ ...base, to: 'rouge1other', knownIds: new Set() })).toBe(false);
});

test('ignores a tx that was already in the baseline', async () => {
  mockRcGet.mockResolvedValue([entry()]);
  expect(await reconcileSend({ ...base, knownIds: new Set(['new1']) })).toBe(false);
});

test('keeps polling through a transient fetch error', async () => {
  mockRcGet.mockRejectedValueOnce(new Error('network')).mockResolvedValue([entry()]);
  expect(await reconcileSend({ ...base, knownIds: new Set() })).toBe(true);
});
