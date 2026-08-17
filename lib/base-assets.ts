/**
 * Read-only Base (L2) balances + USD prices for the wallet home.
 *
 * The EVM address is derived from the same seed as the RougeChain wallet. Prices
 * come from the free DexScreener API (no key). Everything here is display-only —
 * no signing, no private-key exposure beyond the transient derivation.
 */
import { rpc, EVM_CHAINS } from '@/lib/evm-rpc';
import { deriveEvmAccount } from '@/lib/evm-wallet';
import { useWalletStore } from '@/stores/wallet';

/** Canonical WETH on Base — used to price native ETH via DexScreener. */
export const WETH_BASE = '0x4200000000000000000000000000000000000006';

/**
 * XRGE token on Base. Fallback used when the node's XRGE bridge config doesn't
 * return a tokenAddress, so balances/prices still resolve.
 */
export const XRGE_BASE = '0x147120faEC9277ec02d957584CFCD92B56A24317';

/** XRGE/USDC pair on Aerodrome (Base) — queried directly for an exact price. */
export const XRGE_USDC_PAIR_BASE = '0x059e10D26c64A63D04e1814f46305210eddC447D';

export interface BaseAsset {
  symbol: string;
  balance: number;
  priceUsd: number | null;
  usd: number | null;
  tokenAddress?: string; // undefined for native ETH
}

/** Derive the Base/EVM address from the wallet's seed (null if no mnemonic). */
export function getEvmAddress(): string | null {
  const mnemonic = useWalletStore.getState().mnemonic;
  if (!mnemonic) return null;
  try {
    return deriveEvmAccount(mnemonic).address;
  } catch {
    return null;
  }
}

function balanceOfCalldata(address: string): string {
  return '0x70a08231' + address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

function fromWei(hex: string, decimals: number): number {
  try {
    const wei = BigInt(hex);
    // Scale down with a little fractional precision without losing the integer part.
    const denom = 10n ** BigInt(decimals);
    const whole = Number(wei / denom);
    const frac = Number(wei % denom) / Number(denom);
    return whole + frac;
  } catch {
    return 0;
  }
}

async function ethBalance(url: string, address: string): Promise<number> {
  const hex = await rpc<string>(url, 'eth_getBalance', [address, 'latest']).catch(() => '0x0');
  return fromWei(hex, 18);
}

async function erc20Balance(url: string, token: string, address: string, decimals: number): Promise<number> {
  const hex = await rpc<string>(url, 'eth_call', [
    { to: token, data: balanceOfCalldata(address) },
    'latest',
  ]);
  return fromWei(hex, decimals);
}

/**
 * DexScreener USD prices for a set of Base token addresses. Returns a map keyed
 * by lowercased address → priceUsd. Missing/unlisted tokens are simply absent.
 */
export async function fetchUsdPrices(tokenAddresses: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const list = tokenAddresses.filter(Boolean);
  if (list.length === 0) return out;
  try {
    const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + list.join(','));
    const json = (await res.json()) as { pairs?: any[] };
    const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
    for (const addr of list) {
      const key = addr.toLowerCase();
      const matches = pairs.filter(
        (p) => p?.chainId === 'base' && p?.baseToken?.address?.toLowerCase() === key,
      );
      if (!matches.length) continue;
      // Prefer the deepest-liquidity pair for a stable price.
      matches.sort((a, b) => (b?.liquidity?.usd ?? 0) - (a?.liquidity?.usd ?? 0));
      const price = Number(matches[0]?.priceUsd);
      if (isFinite(price) && price > 0) out[key] = price;
    }
  } catch {
    /* offline / rate-limited — prices just show as unavailable */
  }
  return out;
}

/** Exact USD price for a specific DexScreener pair (chain + pair address). */
export async function fetchPairPriceUsd(chain: string, pairAddress: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${chain}/${pairAddress}`);
    const json = (await res.json()) as { pair?: any; pairs?: any[] };
    const pair = json?.pair ?? (Array.isArray(json?.pairs) ? json.pairs[0] : undefined);
    const price = Number(pair?.priceUsd);
    return isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/**
 * Fetch ETH + XRGE balances on Base and their USD values. `xrgeToken` defaults
 * to the known XRGE Base address when the node config doesn't provide one.
 */
export async function fetchBaseAssets(opts: {
  address: string;
  xrgeToken?: string;
  chainId?: number;
}): Promise<BaseAsset[]> {
  const chain = EVM_CHAINS[opts.chainId ?? 8453] ?? EVM_CHAINS[8453];
  const url = chain.rpcUrl;
  const xrgeToken = opts.xrgeToken || XRGE_BASE;

  const [eth, xrge] = await Promise.all([
    ethBalance(url, opts.address),
    erc20Balance(url, xrgeToken, opts.address, 18).catch(() => null),
  ]);

  // ETH from the WETH token feed; XRGE from its exact Aerodrome pair (falling
  // back to the token feed if the pair lookup is unavailable).
  const ethPrices = await fetchUsdPrices([WETH_BASE]);
  const ethPrice = ethPrices[WETH_BASE.toLowerCase()] ?? null;

  let xrgePrice = await fetchPairPriceUsd('base', XRGE_USDC_PAIR_BASE);
  if (xrgePrice == null) {
    const p = await fetchUsdPrices([xrgeToken]);
    xrgePrice = p[xrgeToken.toLowerCase()] ?? null;
  }

  const assets: BaseAsset[] = [
    {
      symbol: 'ETH',
      balance: eth,
      priceUsd: ethPrice,
      usd: ethPrice != null ? eth * ethPrice : null,
    },
  ];
  if (xrge != null) {
    assets.push({
      symbol: 'XRGE',
      balance: xrge,
      priceUsd: xrgePrice,
      usd: xrgePrice != null ? xrge * xrgePrice : null,
      tokenAddress: xrgeToken,
    });
  }
  return assets;
}
