import { Platform } from 'react-native';
import { pbkdf2 as noblePbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * PBKDF2-HMAC-SHA-256, shared by the wallet-at-rest encryption (secure-store,
 * 200k rounds) and the encrypted .pqcbackup format (encrypted-backup, 600k).
 *
 * Runs natively via react-native-quick-crypto's C++/JSI pbkdf2Sync when
 * available: the high iteration counts finish in a few hundred ms instead of
 * blocking Hermes' JS thread for tens of seconds. A pure-JS 600k derivation on
 * device (no Hermes JIT) froze the UI so long during wallet import that App
 * Review saw it as a permanent "loading" hang.
 *
 * The native path is trusted only after a one-time startup self-check confirms
 * it is byte-identical to the noble JS reference for a known vector. PBKDF2 is
 * just HMAC iterated, so a match at the self-check's iteration count guarantees a
 * match at 200k/600k too — keys and backups derived by either path are identical,
 * and every existing wallet/backup stays decryptable. Falls back to noble on web
 * or whenever native is unavailable or fails the self-check.
 */

function jsPbkdf2(
  pw: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen: number,
): Uint8Array {
  return noblePbkdf2(sha256, pw, salt, { c: iterations, dkLen });
}

function loadNativePbkdf2():
  | ((pw: Uint8Array, salt: Uint8Array, iterations: number, dkLen: number) => Uint8Array)
  | null {
  if (Platform.OS === 'web') return null;
  let fn: ((...a: unknown[]) => ArrayLike<number>) | undefined;
  try {
    const mod = require('react-native-quick-crypto');
    fn = (mod?.default ?? mod)?.pbkdf2Sync;
  } catch {
    return null;
  }
  if (typeof fn !== 'function') return null;
  try {
    const pw = new TextEncoder().encode('qwalla-pbkdf2-selftest');
    const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const got = Uint8Array.from(fn(pw, salt, 2048, 32, 'sha256'));
    const want = noblePbkdf2(sha256, pw, salt, { c: 2048, dkLen: 32 });
    if (got.length !== want.length) return null;
    for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) return null;
  } catch {
    return null;
  }
  return (pw, salt, iterations, dkLen) =>
    Uint8Array.from(fn!(pw, salt, iterations, dkLen, 'sha256'));
}

const nativePbkdf2 = loadNativePbkdf2();

/** True when the self-checked native (C++/JSI) PBKDF2 is in use on this device. */
export const NATIVE_PBKDF2_AVAILABLE = nativePbkdf2 !== null;

/**
 * Derive `dkLen` bytes with PBKDF2-HMAC-SHA-256. Synchronous: native finishes in
 * a few hundred ms; the noble fallback briefly blocks the JS thread but completes
 * reliably (the async pbkdf2 variants have stalled indefinitely on Android Hermes).
 */
export function pbkdf2Sha256(
  password: string | Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen = 32,
): Uint8Array {
  const pw = typeof password === 'string' ? new TextEncoder().encode(password) : password;
  if (nativePbkdf2) {
    try {
      const key = nativePbkdf2(pw, salt, iterations, dkLen);
      if (key.length === dkLen) return key;
    } catch {
      // fall through to the JS implementation below
    }
  }
  return jsPbkdf2(pw, salt, iterations, dkLen);
}
