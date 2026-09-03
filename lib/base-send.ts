/**
 * Native "send" for Base (L2): transfer native ETH or an ERC-20 (XRGE) from the
 * wallet's seed-derived EVM account. Wraps the existing fillSignAndSend plumbing
 * (nonce/gas/fee fill → sign → eth_sendRawTransaction) so the wallet UI can
 * broadcast without going through the in-app dApp browser.
 */
import { EVM_CHAINS, fillSignAndSend, getChain, rpc, type EvmChain } from '@/lib/evm-rpc';
import { deriveEvmAccount } from '@/lib/evm-wallet';

/** True for a well-formed 0x-prefixed 20-byte EVM address. */
export function isEvmAddress(input: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(input.trim());
}

/** Canonical USDC token on each supported Base chain (6 decimals). */
export const USDC_BY_CHAIN: Record<number, string> = {
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base mainnet
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia
};

function fromBaseUnits(hex: string, decimals: number): number {
  try {
    const units = BigInt(hex);
    const denom = 10n ** BigInt(decimals);
    return Number(units / denom) + Number(units % denom) / Number(denom);
  } catch {
    return 0;
  }
}

/**
 * Read a single Base balance — native ETH when tokenAddress is omitted, else the
 * ERC-20 balanceOf. Returns 0 on any RPC error so callers can render a guard.
 */
export async function getBaseBalance(params: {
  address: string;
  chainId: number;
  tokenAddress?: string | null;
  decimals?: number;
}): Promise<number> {
  const { address, chainId, tokenAddress, decimals = 18 } = params;
  const chain = getChain(chainId) ?? EVM_CHAINS[8453];
  if (!chain) return 0;
  const url = chain.rpcUrl;
  try {
    if (tokenAddress) {
      const data = '0x70a08231' + address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
      const hex = await rpc<string>(url, 'eth_call', [{ to: tokenAddress, data }, 'latest']);
      return fromBaseUnits(hex, decimals);
    }
    const hex = await rpc<string>(url, 'eth_getBalance', [address, 'latest']);
    return fromBaseUnits(hex, decimals);
  } catch {
    return 0;
  }
}

/**
 * Convert a human decimal string (e.g. "1.5") to base units as a bigint.
 * Done on the string to avoid float precision loss on large 18-decimal values.
 */
export function toBaseUnits(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '' || trimmed === '.') {
    throw new Error('Invalid amount');
  }
  const [whole, frac = ''] = trimmed.split('.');
  if (frac.length > decimals) {
    throw new Error(`Too many decimals — max ${decimals}`);
  }
  const padded = frac.padEnd(decimals, '0');
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

/** ABI-encode ERC-20 transfer(address,uint256). */
function erc20TransferCalldata(to: string, amount: bigint): string {
  const addr = to.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const amt = amount.toString(16).padStart(64, '0');
  return '0xa9059cbb' + addr + amt;
}

function toBig(v: unknown, fallback = 0n): bigint {
  if (v === undefined || v === null || v === '') return fallback;
  try {
    return BigInt(v as string | number);
  } catch {
    return fallback;
  }
}

/** Build the on-chain call fields (to/value/data) for a send. */
function buildCall(
  recipient: string,
  units: bigint,
  tokenAddress?: string | null,
): { to: string; value: bigint; data: string } {
  if (tokenAddress) {
    return { to: tokenAddress, value: 0n, data: erc20TransferCalldata(recipient, units) };
  }
  return { to: recipient, value: units, data: '0x' };
}

export interface BaseFeeEstimate {
  /** Estimated max network fee (gasLimit × maxFeePerGas), in wei. */
  feeWei: bigint;
  /** Same fee expressed in ETH for display. */
  feeEth: number;
}

/**
 * Estimate the max network (gas) fee for a Base send, using the same
 * gasLimit/EIP-1559 fill that fillSignAndSend applies. Read-only — no signing.
 */
export async function estimateBaseSendFee(params: {
  from: string;
  chainId: number;
  to: string;
  amount: string;
  tokenAddress?: string | null;
  decimals?: number;
}): Promise<BaseFeeEstimate> {
  const { from, chainId, to, amount, tokenAddress, decimals = 18 } = params;
  const chain = getChain(chainId) ?? EVM_CHAINS[8453];
  if (!chain) throw new Error('Unsupported network');
  const recipient = to.trim();
  if (!isEvmAddress(recipient)) throw new Error('Enter a valid 0x… Base address');

  const units = toBaseUnits(amount, decimals);
  const call = buildCall(recipient, units, tokenAddress);
  const url = chain.rpcUrl;

  const est = await rpc<string>(url, 'eth_estimateGas', [
    { from, to: call.to, value: '0x' + call.value.toString(16), data: call.data },
  ]);
  const gasLimit = (toBig(est) * 12n) / 10n; // +20% headroom, mirrors fillSignAndSend

  const block = await rpc<{ baseFeePerGas?: string }>(url, 'eth_getBlockByNumber', ['latest', false]);
  const baseFee = toBig(block?.baseFeePerGas);
  let priority: bigint;
  try {
    priority = toBig(await rpc<string>(url, 'eth_maxPriorityFeePerGas', []));
  } catch {
    priority = 1_000_000_000n;
  }
  if (priority === 0n) priority = 1_000_000_000n;
  const maxFeePerGas = baseFee * 2n + priority;

  const feeWei = gasLimit * maxFeePerGas;
  return { feeWei, feeEth: Number(feeWei) / 1e18 };
}

export interface BaseSendParams {
  mnemonic: string;
  chainId: number;
  to: string;
  /** Human amount, e.g. "0.25". */
  amount: string;
  /** ERC-20 token address, or undefined/null for native ETH. */
  tokenAddress?: string | null;
  /** Token decimals (18 for ETH and XRGE). */
  decimals?: number;
}

/**
 * Send native ETH or an ERC-20 on Base. Returns the transaction hash.
 * Throws on bad address/amount or if broadcasting fails.
 */
export async function sendBaseAsset(params: BaseSendParams): Promise<string> {
  const { mnemonic, chainId, to, amount, tokenAddress, decimals = 18 } = params;

  const recipient = to.trim();
  if (!isEvmAddress(recipient)) {
    throw new Error('Enter a valid 0x… Base address');
  }

  const chain: EvmChain | undefined = getChain(chainId) ?? EVM_CHAINS[8453];
  if (!chain) throw new Error('Unsupported network');

  const account = deriveEvmAccount(mnemonic);
  const units = toBaseUnits(amount, decimals);
  if (units <= 0n) throw new Error('Amount must be greater than zero');

  const call = buildCall(recipient, units, tokenAddress);
  return fillSignAndSend(chain, account, {
    to: call.to,
    value: '0x' + call.value.toString(16),
    data: call.data,
  });
}
