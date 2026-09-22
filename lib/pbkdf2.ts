import { Platform } from 'react-native';
import { pbkdf2 as noblePbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * App-side native PBKDF2 loader.
 *
 * Loads react-native-quick-crypto's C++/JSI pbkdf2Sync and trusts it only after
 * a one-time self-check confirms it is byte-identical to the @noble reference
 * for a known vector. The verified function is registered as @qwalla/core's
 * `crypto.pbkdf2Sha256` adapter (see lib/host-adapters.ts); the shared
 * pbkdf2Sha256 in @qwalla/core/wallet uses it when present and falls back to
 * pure-JS @noble otherwise. Keeping the native load here (not in core) is
 * deliberate — react-native-quick-crypto is a native RN module.
 *
 * The high iteration counts (200k wallet / 600k backup) finish in a few hundred
 * ms natively instead of blocking Hermes' JS thread for tens of seconds (a
 * pure-JS 600k derivation on device froze wallet import long enough that App
 * Review saw a permanent "loading" hang).
 */

type NativePbkdf2 = (
  pw: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen: number,
) => Uint8Array;

function loadNativePbkdf2(): NativePbkdf2 | null {
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

/**
 * The self-checked native PBKDF2, or null if unavailable/unverified. Registered
 * as the @qwalla/core `crypto` adapter in lib/host-adapters.ts.
 */
export const nativePbkdf2 = loadNativePbkdf2();

/** True when the self-checked native (C++/JSI) PBKDF2 is in use on this device. */
export const NATIVE_PBKDF2_AVAILABLE = nativePbkdf2 !== null;

// Make a silent fallback loud in logs: on a native build without working
// quick-crypto, every 200k/600k derivation runs on the JS thread and freezes the
// UI. Surfaces in `adb logcat` / Xcode so an "it's slow" report is diagnosable.
if (Platform.OS !== 'web' && !NATIVE_PBKDF2_AVAILABLE) {
  console.warn(
    '[pbkdf2] Native PBKDF2 (react-native-quick-crypto) unavailable — falling back ' +
      'to pure-JS. Wallet unlock/backup will be SLOW on this device. Likely causes: ' +
      'native module missing from this build/ABI, or an OTA JS update over an older ' +
      'native binary.',
  );
}
