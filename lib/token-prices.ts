import { XRGE_USDC_PAIR_BASE, fetchPairPriceUsd } from '@/lib/base-assets';

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
 */
export type UsdPrices = Record<string, number>;

const COINGECKO_SIMPLE =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd';

export async function fetchWalletUsdPrices(): Promise<UsdPrices> {
  const out: UsdPrices = { qUSDC: 1, XUSD: 1, USDC: 1 };

  const [xrge, majors] = await Promise.allSettled([
    fetchPairPriceUsd('base', XRGE_USDC_PAIR_BASE),
    fetchMajors(),
  ]);

  if (xrge.status === 'fulfilled' && xrge.value != null && xrge.value > 0) {
    out.XRGE = xrge.value;
  }
  if (majors.status === 'fulfilled') {
    Object.assign(out, majors.value);
  }
  return out;
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
