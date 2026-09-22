/**
 * RouGee (rougee-gram) DM key bridge.
 *
 * RouGee derives its ML-KEM-768 messaging keypair *deterministically from the
 * wallet seed* and uses its own envelope format (raw KEM shared secret → AES-GCM,
 * per-recipient CEK keyed by participant id). This is DIFFERENT from Qwalla's own
 * messenger scheme (random registered key + HKDF), so we reproduce RouGee's exact
 * derivation + decryption here to power the `getEncryptionPublicKey` / `decrypt`
 * provider bridge — letting RouGee do DMs inside the Qwalla dApp browser without
 * the seed ever leaving the wallet.
 *
 * Must stay byte-for-byte compatible with rougee-gram `src/lib/pqc.ts`.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { bytesToHex } from '@rougechain/sdk';

function b64ToBytes(b64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Int16Array(256).fill(-1);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const outLen = Math.floor((len * 3) / 4);
  const out = new Uint8Array(outLen);
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (let i = 0; i < len; i++) {
    const v = lookup[clean.charCodeAt(i)];
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

interface KemKeypair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  publicKeyHex: string;
}

const cache = new Map<string, KemKeypair>();

/**
 * Reproduce RouGee's deterministic KEM keypair. RouGee derives from
 * `wallet.mnemonic || wallet.privateKey` — mirror that preference so the key
 * matches what RouGee-web derives for the same wallet.
 */
export function deriveRougeeKem(mnemonic: string | null, privateKeyHex: string): KemKeypair {
  const material = mnemonic || privateKeyHex;
  const hit = cache.get(material);
  if (hit) return hit;
  const src = new TextEncoder().encode(`${material}|rougee-gram|kem-v1`);
  const seed = sha512(src); // 64 bytes, matches WebCrypto SHA-512
  const kp = ml_kem768.keygen(seed);
  const result: KemKeypair = {
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    publicKeyHex: bytesToHex(kp.publicKey),
  };
  cache.set(material, result);
  return result;
}

interface KeyEntry {
  kem: string;
  wIv: string;
  wCek: string;
}
interface Envelope {
  v: 1;
  iv: string;
  data: string;
  keys: Record<string, KeyEntry>;
}

/** Decrypt a RouGee envelope addressed to `myId` with the seed-derived secret. */
export function decryptRougeeEnvelope(
  envStr: string,
  myId: string,
  mySecret: Uint8Array,
): string {
  const env = JSON.parse(envStr) as Envelope;
  if (env.v !== 1 || !env.keys) throw new Error('bad envelope');
  const entry = env.keys[myId];
  if (!entry) throw new Error('not a recipient');

  const sharedSecret = ml_kem768.decapsulate(b64ToBytes(entry.kem), mySecret);
  // RouGee wraps the CEK with the RAW shared secret (no HKDF) — AES-256-GCM.
  const cek = gcm(sharedSecret, b64ToBytes(entry.wIv)).decrypt(b64ToBytes(entry.wCek));
  const plaintext = gcm(cek, b64ToBytes(env.iv)).decrypt(b64ToBytes(env.data));
  return new TextDecoder().decode(plaintext);
}

// hexToBytes kept exported in case future methods (e.g. encrypt-for) need it.
export { hexToBytes as _hexToBytes };
