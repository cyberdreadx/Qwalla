/**
 * Minimal JSON-RPC client for Base (and Base Sepolia) plus the gas/nonce/fee
 * fill for eth_sendTransaction. Read-only RPC methods are proxied straight
 * through from the injected provider; only sending needs the signer.
 */
import { signEip1559, type EvmAccount } from '@/lib/evm-wallet';

export interface EvmChain {
  chainId: number;
  name: string;
  rpcUrl: string;
}

export const EVM_CHAINS: Record<number, EvmChain> = {
  8453: { chainId: 8453, name: 'Base', rpcUrl: 'https://mainnet.base.org' },
  84532: { chainId: 84532, name: 'Base Sepolia', rpcUrl: 'https://sepolia.base.org' },
};

export function getChain(chainId: number): EvmChain | undefined {
  return EVM_CHAINS[chainId];
}

let rpcId = 0;

export async function rpc<T = unknown>(rpcUrl: string, method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string; code?: number } };
  if (json.error) {
    const err = new Error(json.error.message || 'RPC error') as Error & { code?: number };
    err.code = json.error.code;
    throw err;
  }
  return json.result as T;
}

function toHex(v: bigint): string {
  return '0x' + v.toString(16);
}

function toBig(v: unknown, fallback = 0n): bigint {
  if (v === undefined || v === null || v === '') return fallback;
  try {
    return BigInt(v as string | number);
  } catch {
    return fallback;
  }
}

/** dApp-supplied transaction request (eth_sendTransaction params[0]). */
export interface EvmTxRequest {
  from?: string;
  to: string;
  value?: string;
  data?: string;
  gas?: string;
  nonce?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

/**
 * Fill missing nonce / gas / EIP-1559 fees from the chain, sign, and broadcast.
 * Returns the transaction hash.
 */
export async function fillSignAndSend(
  chain: EvmChain,
  account: EvmAccount,
  tx: EvmTxRequest,
): Promise<string> {
  const url = chain.rpcUrl;
  const value = toBig(tx.value);
  const data = tx.data && tx.data !== '0x' ? tx.data : '0x';

  const nonce =
    tx.nonce != null
      ? toBig(tx.nonce)
      : toBig(await rpc<string>(url, 'eth_getTransactionCount', [account.address, 'pending']));

  let gasLimit = toBig(tx.gas);
  if (gasLimit === 0n) {
    const est = await rpc<string>(url, 'eth_estimateGas', [
      { from: account.address, to: tx.to, value: toHex(value), data },
    ]);
    gasLimit = (toBig(est) * 12n) / 10n; // +20% headroom
  }

  let maxPriorityFeePerGas = toBig(tx.maxPriorityFeePerGas);
  let maxFeePerGas = toBig(tx.maxFeePerGas);
  if (maxFeePerGas === 0n) {
    const block = await rpc<{ baseFeePerGas?: string }>(url, 'eth_getBlockByNumber', ['latest', false]);
    const baseFee = toBig(block?.baseFeePerGas);
    if (maxPriorityFeePerGas === 0n) {
      try {
        maxPriorityFeePerGas = toBig(await rpc<string>(url, 'eth_maxPriorityFeePerGas', []));
      } catch {
        maxPriorityFeePerGas = 1_000_000_000n; // 1 gwei fallback
      }
    }
    // base fee can rise between blocks — double it for headroom
    maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;
  }
  if (maxPriorityFeePerGas === 0n) maxPriorityFeePerGas = maxFeePerGas;

  const raw = signEip1559(account.privateKeyHex, {
    chainId: BigInt(chain.chainId),
    nonce,
    to: tx.to,
    value,
    data,
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });

  return rpc<string>(url, 'eth_sendRawTransaction', [raw]);
}
