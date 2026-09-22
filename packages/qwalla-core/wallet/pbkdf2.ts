/**
 * PBKDF2-HMAC-SHA-256 for wallet-at-rest (secure-store, 200k rounds) and
 * .pqcbackup (encrypted-backup, 600k rounds) key derivation.
 *
 * Uses the host's native fast-path (`getHostCrypto().pbkdf2Sha256`) when the
 * host registered one — the host MUST only register a native implementation it
 * has verified byte-identical to @noble — and falls back to pure-JS @noble
 * otherwise (always correct, just slower). PBKDF2 is HMAC iterated, so a match
 * at any iteration count guarantees a match at all counts, and every existing
 * wallet/backup stays decryptable regardless of which path derives the key.
 *
 * Iteration counts live at the call sites and MUST stay constant — they are not
 * stored in the encrypted record, so changing one makes existing wallets
 * undecryptable.
 */
import { pbkdf2 as noblePbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { getHostCrypto } from '../host';

function jsPbkdf2(pw: Uint8Array, salt: Uint8Array, iterations: number, dkLen: number): Uint8Array {
  return noblePbkdf2(sha256, pw, salt, { c: iterations, dkLen });
}

/**
 * Derive `dkLen` bytes with PBKDF2-HMAC-SHA-256. Synchronous: native finishes in
 * a few hundred ms; the noble fallback briefly blocks the JS thread but always
 * completes.
 */
export function pbkdf2Sha256(
  password: string | Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen = 32,
): Uint8Array {
  const pw = typeof password === 'string' ? new TextEncoder().encode(password) : password;
  const native = getHostCrypto().pbkdf2Sha256;
  if (native) {
    try {
      const key = native(pw, salt, iterations, dkLen);
      if (key.length === dkLen) return key;
    } catch {
      // fall through to the JS implementation
    }
  }
  return jsPbkdf2(pw, salt, iterations, dkLen);
}
