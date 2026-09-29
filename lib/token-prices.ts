import { XRGE_USDC_PAIR_BASE, fetchPairPriceUsd } from '@/lib/base-assets';
import { l1ToHuman } from '@/lib/format';
import { rc } from '@/lib/rougechain';

/**
 * USD prices for the assets shown on the wallet home, keyed by RougeChain token
 * symbol. Used to render a "≈ $X" figure next to native XRGE and the bridged
 * majors. Symbols with no known price (custom user tokens) are simply absent, so
 * callers should treat a missing key as "no USD value available".
 *
 * Sources, no API keys required:
 *  - XRGE      → exact Aerodrome XRGE/USDC pair on Base (DexScreener)
 *  - qBTC/qETH → CoinGecko spot for bitcoin/ethereum (the bridged tokens track
 *                the underlying asset 1:1)
 *  - qUSDC     → pegged to $1
 *  - any other token with a RougeChain DEX pool → derived from the pool's spot
 *    price against an already-priced token (see derivePoolUsdPrices)
 */
export type UsdPrices = Record<string, number>;

type Pool = {
  // The live API returns token_a/token_b; the SDK type calls them *_symbol.
  token_a?: string;
  token_b?: string;
  token_a_symbol?: string;
  token_b_symbol?: string;
  reserve_a?: number;
  reserve_b?: number;
};

const COINGECKO_SIMPLE =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd';

export async function fetchWalletUsdPrices(): Promise<UsdPrices> {
  const out: UsdPrices = { qUSDC: 1, XUSD: 1, USDC: 1 };

  const [xrge, majors, pools] = await Promise.allSettled([
    fetchPairPriceUsd('base', XRGE_USDC_PAIR_BASE),
    fetchMajors(),
    rc.dex.getPools(),
  ]);

  if (xrge.status === 'fulfilled' && xrge.value != null && xrge.value > 0) {
    out.XRGE = xrge.value;
  }
  if (majors.status === 'fulfilled') {
    Object.assign(out, majors.value);
  }
  // Price every other pooled token off the reserves of a pool that pairs it with
  // a token we can already value (qUSDC / XRGE / a major).
  if (pools.status === 'fulfilled' && Array.isArray(pools.value)) {
    return derivePoolUsdPrices(pools.value as Pool[], out);
  }
  return out;
}

/**
 * Fill in USD prices for tokens that have a RougeChain pool against an
 * already-priced token. Constant-product spot price: the price of A denominated
 * in B is reserveB / reserveA (in human units). USD(A) = price(A in B) × USD(B).
 * A few passes let prices chain — e.g. a TOKEN/XRGE pool resolves once XRGE is
 * known, and a THIRD token paired only with TOKEN resolves on the next pass.
 * Only missing symbols are filled, so seeded prices (XRGE from Base, majors) win.
 */
export function derivePoolUsdPrices(pools: Pool[], seed: UsdPrices): UsdPrices {
  const prices: UsdPrices = { ...seed };
  const symA = (p: Pool) => p.token_a_symbol ?? p.token_a;
  const symB = (p: Pool) => p.token_b_symbol ?? p.token_b;
  const valid = pools.filter(
    (p) => symA(p) && symB(p) && Number(p.reserve_a) > 0 && Number(p.reserve_b) > 0,
  );

  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const p of valid) {
      const a = symA(p) as string;
      const b = symB(p) as string;
      const ra = l1ToHuman(a, Number(p.reserve_a));
      const rb = l1ToHuman(b, Number(p.reserve_b));
      if (!(ra > 0) || !(rb > 0)) continue;

      if (prices[a] == null && prices[b] != null) {
        const usd = (rb / ra) * prices[b]; // price of A in B × USD(B)
        if (Number.isFinite(usd) && usd > 0) {
          prices[a] = usd;
          changed = true;
        }
      }
      if (prices[b] == null && prices[a] != null) {
        const usd = (ra / rb) * prices[a];
        if (Number.isFinite(usd) && usd > 0) {
          prices[b] = usd;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return prices;
}

async function fetchMajors(): Promise<UsdPrices> {
  const out: UsdPrices = {};
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(COINGECKO_SIMPLE, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    const j = (await res.json()) as {
      bitcoin?: { usd?: number };
      ethereum?: { usd?: number };
    };
    const btc = Number(j?.bitcoin?.usd);
    const eth = Number(j?.ethereum?.usd);
    if (Number.isFinite(btc) && btc > 0) out.qBTC = btc;
    if (Number.isFinite(eth) && eth > 0) out.qETH = eth;
  } catch {
    /* prices are best-effort; missing keys just render no USD value */
  }
  return out;
}

/** USD value of `amount` units of `symbol`, or null when no price is known. */
export function usdValue(
  symbol: string,
  amount: number,
  prices: UsdPrices,
): number | null {
  const price = prices[symbol];
  if (price == null || !Number.isFinite(amount)) return null;
  return amount * price;
}
