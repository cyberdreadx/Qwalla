/**
 * EVM (Base) account derived from the same BIP-39 mnemonic as the RougeChain
 * wallet. Standard Ethereum path m/44'/60'/0'/0/0 → secp256k1 keypair.
 *
 * Signing goes through micro-eth-signer (audited, noble/scure-based, RN-safe)
 * so we never hand-roll RLP / EIP-1559 / EIP-191 encoding.
 */
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { bytesToHex } from '@noble/hashes/utils.js';
import { addr, Transaction, eip191Signer } from 'micro-eth-signer';

const EVM_PATH = "m/44'/60'/0'/0/0";

export interface EvmAccount {
  address: string; // EIP-55 checksummed 0x…
  privateKeyHex: string; // 0x-prefixed
}

/** Derive the Base/EVM account from a BIP-39 mnemonic. Throws if none. */
export function deriveEvmAccount(mnemonic: string): EvmAccount {
  const phrase = mnemonic.trim().toLowerCase();
  const seed = mnemonicToSeedSync(phrase);
  const node = HDKey.fromMasterSeed(seed).derive(EVM_PATH);
  if (!node.privateKey) throw new Error('Failed to derive EVM private key');
  const privateKeyHex = '0x' + bytesToHex(node.privateKey);
  return { address: addr.fromPrivateKey(privateKeyHex), privateKeyHex };
}

/**
 * EIP-191 personal_sign. `message` should be the raw bytes the dApp asked to
 * sign (decode 0x-hex params before calling), so the \x19 prefix is applied to
 * the actual payload — matching MetaMask.
 */
export function personalSign(privateKeyHex: string, message: Uint8Array | string): string {
  return eip191Signer.sign(message, privateKeyHex);
}

export interface Eip1559Fields {
  chainId: bigint;
  nonce: bigint;
  to: string;
  value: bigint;
  data: string; // 0x-hex
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/** Sign an EIP-1559 (type-2) transaction; returns the 0x-prefixed raw tx. */
export function signEip1559(privateKeyHex: string, f: Eip1559Fields): string {
  const tx = Transaction.prepare(
    {
      type: 'eip1559',
      chainId: f.chainId,
      nonce: f.nonce,
      to: f.to,
      value: f.value,
      data: f.data && f.data !== '0x' ? f.data : '0x',
      gasLimit: f.gasLimit,
      maxFeePerGas: f.maxFeePerGas,
      maxPriorityFeePerGas: f.maxPriorityFeePerGas,
    },
    // Bridge amounts/gas can exceed the library's conservative safety caps.
    { strict: false } as unknown as undefined,
  );
  const raw = tx.signBy(privateKeyHex).toHex();
  return raw.startsWith('0x') ? raw : '0x' + raw;
}
