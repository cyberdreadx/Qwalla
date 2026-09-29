// Verifies pool-derived USD pricing works with the LIVE API field names
// (token_a/token_b), not just the SDK's *_symbol type. A QTEK/XRGE pool should
// price QTEK off XRGE's known USD price.

// derivePoolUsdPrices only needs l1ToHuman; stub the heavy import chain
// (base-assets -> evm-rpc -> micro-eth-signer) and the rougechain client so the
// module loads under Jest.
jest.mock('@/lib/base-assets', () => ({
  XRGE_USDC_PAIR_BASE: '0x0',
  fetchPairPriceUsd: jest.fn(),
}));
jest.mock('@/lib/rougechain', () => ({ rc: { dex: { getPools: jest.fn() } } }));

import { derivePoolUsdPrices } from '@/lib/token-prices';

describe('derivePoolUsdPrices', () => {
  it('prices a token from a pool using token_a/token_b (live API shape)', () => {
    const pools = [
      {
        pool_id: 'QTEK-XRGE',
        token_a: 'QTEK',
        token_b: 'XRGE',
        reserve_a: 88376,
        reserve_b: 568,
      },
    ];
    const out = derivePoolUsdPrices(pools, { XRGE: 1.82, qUSDC: 1 });
    // price(QTEK in XRGE) = reserveXRGE / reserveQTEK = 568 / 88376
    const expected = (568 / 88376) * 1.82;
    expect(out.QTEK).toBeCloseTo(expected, 6);
    expect(out.XRGE).toBe(1.82); // seed preserved, not overwritten
  });

  it('also honours the SDK *_symbol field names and token decimals', () => {
    // qUSDC has 6 decimals; reserves are RAW L1 units. 250 qUSDC = 250_000000 raw.
    const pools = [
      { token_a_symbol: 'FOO', token_b_symbol: 'qUSDC', reserve_a: 100, reserve_b: 250_000000 },
    ];
    const out = derivePoolUsdPrices(pools, { qUSDC: 1 });
    expect(out.FOO).toBeCloseTo(2.5, 6); // 250 qUSDC (human) / 100 FOO * $1
  });

  it('leaves tokens with no path to a priced asset unpriced', () => {
    const pools = [{ token_a: 'AAA', token_b: 'BBB', reserve_a: 10, reserve_b: 10 }];
    const out = derivePoolUsdPrices(pools, { XRGE: 1.82 });
    expect(out.AAA).toBeUndefined();
    expect(out.BBB).toBeUndefined();
  });
});
