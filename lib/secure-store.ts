import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

const WALLET_KEY = 'qwalla_wallet_bundle_v1';
const LOCK_STATE_KEY = 'qwalla_lock_state_v1';

/**
 * The wallet is native-only. On web we deliberately never persist private
 * keys, the mnemonic, or the password: browser storage (localStorage) is
 * readable by any script on the origin and by extensions, so keeping keys
 * there would be a full key-exfiltration risk via XSS. Web builds route users
 * to the iOS/Android app instead (see stores/wallet.ts guards).
 */
export const WALLET_SUPPORTED = Platform.OS !== 'web';

async function secureGet(key: string): Promise<string | null> {
  if (!WALLET_SUPPORTED) return null;
  return SecureStore.getItemAsync(key);
}

async function secureSet(key: string, value: string): Promise<void> {
  if (!WALLET_SUPPORTED) {
    throw new Error('Secure storage is unavailable on web.');
  }
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
}

async function secureRemove(key: string): Promise<void> {
  if (!WALLET_SUPPORTED) return;
  await SecureStore.deleteItemAsync(key);
}

export type StoredWalletBundle = {
  publicKey: string;
  privateKey: string;
  encPublicKey: string;
  encPrivateKey: string;
  displayName: string;
  mnemonic?: string;
  avatarUrl?: string;
};

/** Non-secret fields shown on the lock screen without decrypting. */
export type WalletMeta = {
  publicKey: string;
  displayName: string;
  avatarUrl?: string;
};

/** On-disk record when the wallet is protected by a password. */
type EncryptedRecord = {
  v: 2;
  salt: string; // hex — PBKDF2 salt
  iv: string; // hex — AES-GCM nonce
  ct: string; // hex — AES-256-GCM(JSON(bundle))
  meta: WalletMeta;
};

export type StoredFormat = 'none' | 'encrypted' | 'legacy';

const PBKDF2_ITERATIONS = 200_000;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function jsPbkdf2(pw: Uint8Array, salt: Uint8Array): Uint8Array {
  return pbkdf2(sha256, pw, salt, { c: PBKDF2_ITERATIONS, dkLen: 32 });
}

/**
 * Load react-native-quick-crypto's native (C++/JSI) pbkdf2Sync — but only trust
 * it after verifying it produces byte-identical output to the JS reference for a
 * known vector. This guards against any difference in how native handles the
 * input: a mismatch would derive a key that can't decrypt an existing wallet
 * (silent lockout), so on any doubt we return null and fall back to noble.
 * Native-only; importing quick-crypto on web would pull in native-only code.
 */
function loadNativePbkdf2(): ((pw: Uint8Array, salt: Uint8Array) => Uint8Array) | null {
  if (Platform.OS === 'web') return null;
  let fn: ((...a: unknown[]) => ArrayLike<number>) | undefined;
  try {
    const mod = require('react-native-quick-crypto');
    fn = (mod?.default ?? mod)?.pbkdf2Sync;
  } catch {
    return null;
  }
  if (typeof fn !== 'function') return null;
  const native = (pw: Uint8Array, salt: Uint8Array): Uint8Array =>
    Uint8Array.from(fn!(pw, salt, PBKDF2_ITERATIONS, 32, 'sha256'));
  try {
    const pw = new TextEncoder().encode('qwalla-pbkdf2-selftest');
    const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const got = Uint8Array.from(fn(pw, salt, 2048, 32, 'sha256'));
    const want = pbkdf2(sha256, pw, salt, { c: 2048, dkLen: 32 });
    if (got.length !== want.length) return null;
    for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) return null;
  } catch {
    return null;
  }
  return native;
}

const nativePbkdf2 = loadNativePbkdf2();

/**
 * PBKDF2-HMAC-SHA-256 → 32-byte AES key.
 *
 * Runs natively via react-native-quick-crypto (C++/JSI) when available: the 200k
 * iterations finish in ~100ms instead of blocking Hermes' JS thread for tens of
 * seconds on Android — a pure-JS derivation there stayed stuck forever on
 * "Unlocking…" (and made iOS unlock sluggish too). The native path is used only
 * after a startup self-check confirms it is byte-identical to the JS reference
 * (see loadNativePbkdf2), so existing wallets always stay decryptable; otherwise
 * we transparently fall back to the pure-JS noble implementation.
 *
 * Iterations MUST stay at PBKDF2_ITERATIONS — the count is not stored in the
 * encrypted record, so changing it would make every existing wallet undecryptable.
 * Returns a Promise so callers (which `await`) don't change.
 */
export function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const pw = new TextEncoder().encode(password);
  if (nativePbkdf2) {
    try {
      const key = nativePbkdf2(pw, salt);
      if (key.length === 32) return Promise.resolve(key);
    } catch {
      // fall through to the JS implementation below
    }
  }
  return Promise.resolve(jsPbkdf2(pw, salt));
}

function metaOf(bundle: StoredWalletBundle): WalletMeta {
  return {
    publicKey: bundle.publicKey,
    displayName: bundle.displayName,
    avatarUrl: bundle.avatarUrl,
  };
}

function writeEncrypted(bundle: StoredWalletBundle, key: Uint8Array, salt: Uint8Array): string {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(bundle));
  const ct = gcm(key, iv).encrypt(pt);
  const record: EncryptedRecord = {
    v: 2,
    salt: toHex(salt),
    iv: toHex(iv),
    ct: toHex(ct),
    meta: metaOf(bundle),
  };
  return JSON.stringify(record);
}

/**
 * Encrypt the bundle under a fresh salt derived from `password` and persist it.
 * Returns the derived key + salt so the caller can hold them in memory for the
 * session (to re-save on profile edits without re-prompting for the password).
 */
export async function encryptAndSaveWallet(
  bundle: StoredWalletBundle,
  password: string,
): Promise<{ key: Uint8Array; salt: Uint8Array }> {
  if (!WALLET_SUPPORTED) {
    throw new Error('The Qwalla wallet is available in the iOS and Android app.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  await secureSet(WALLET_KEY, writeEncrypted(bundle, key, salt));
  return { key, salt };
}

/** Re-encrypt with the session key/salt already in memory (profile edits). */
export async function resaveWallet(
  bundle: StoredWalletBundle,
  key: Uint8Array,
  salt: Uint8Array,
): Promise<void> {
  if (!WALLET_SUPPORTED) return;
  await secureSet(WALLET_KEY, writeEncrypted(bundle, key, salt));
}

/**
 * Attempt to decrypt the stored wallet with `password`. Returns null when
 * there is no encrypted wallet or the password is wrong (GCM tag mismatch).
 */
export async function unlockWallet(
  password: string,
): Promise<{ bundle: StoredWalletBundle; key: Uint8Array; salt: Uint8Array } | null> {
  const raw = await secureGet(WALLET_KEY);
  if (!raw) return null;
  let record: EncryptedRecord;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v !== 2 || !parsed.ct) return null;
    record = parsed as EncryptedRecord;
  } catch {
    return null;
  }
  const salt = fromHex(record.salt);
  const key = await deriveKey(password, salt);
  try {
    const pt = gcm(key, fromHex(record.iv)).decrypt(fromHex(record.ct));
    const bundle = JSON.parse(new TextDecoder().decode(pt)) as StoredWalletBundle;
    return { bundle, key, salt };
  } catch {
    return null; // wrong password or corrupt record
  }
}

/**
 * Decrypt the stored wallet with an already-derived AES key (hex), skipping the
 * expensive PBKDF2 step. Used by biometric unlock, which stashes the derived key
 * behind the OS secure enclave so Face ID/Touch ID can decrypt near-instantly.
 * Returns null on any mismatch (stale key, corrupt record, or no wallet).
 */
export async function unlockWalletWithKey(
  keyHex: string,
): Promise<{ bundle: StoredWalletBundle; key: Uint8Array; salt: Uint8Array } | null> {
  const raw = await secureGet(WALLET_KEY);
  if (!raw) return null;
  let record: EncryptedRecord;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v !== 2 || !parsed.ct) return null;
    record = parsed as EncryptedRecord;
  } catch {
    return null;
  }
  try {
    const key = fromHex(keyHex);
    const pt = gcm(key, fromHex(record.iv)).decrypt(fromHex(record.ct));
    const bundle = JSON.parse(new TextDecoder().decode(pt)) as StoredWalletBundle;
    return { bundle, key, salt: fromHex(record.salt) };
  } catch {
    return null; // stale key or corrupt record — caller falls back to password
  }
}

/** What kind of wallet (if any) is currently stored. */
export async function getStoredFormat(): Promise<StoredFormat> {
  const raw = await secureGet(WALLET_KEY);
  if (!raw) return 'none';
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v === 2 && parsed.ct) return 'encrypted';
    if (parsed?.privateKey) return 'legacy';
  } catch {
    /* fall through */
  }
  return 'none';
}

/** Lock-screen metadata (name/avatar) available without the password. */
export async function loadWalletMeta(): Promise<WalletMeta | null> {
  const raw = await secureGet(WALLET_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v === 2 && parsed.meta) return parsed.meta as WalletMeta;
    if (parsed?.privateKey) {
      const b = parsed as StoredWalletBundle;
      return { publicKey: b.publicKey, displayName: b.displayName, avatarUrl: b.avatarUrl };
    }
  } catch {
    /* fall through */
  }
  return null;
}

// --- Legacy (pre-password) plaintext bundle ---
//
// Freshly created/imported wallets are stored in plaintext (still protected at
// rest by the OS Keychain/Keystore) until the user sets a password, at which
// point encryptAndSaveWallet overwrites this with an encrypted record. This
// also keeps wallets from installs made before password-encryption readable.

export async function saveLegacyBundle(bundle: StoredWalletBundle): Promise<void> {
  if (!WALLET_SUPPORTED) {
    throw new Error('The Qwalla wallet is available in the iOS and Android app.');
  }
  await secureSet(WALLET_KEY, JSON.stringify(bundle));
}

export async function loadLegacyBundle(): Promise<StoredWalletBundle | null> {
  const raw = await secureGet(WALLET_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.privateKey) return parsed as StoredWalletBundle;
  } catch {
    /* not a legacy bundle */
  }
  return null;
}

export async function clearWalletBundle(): Promise<void> {
  await secureRemove(WALLET_KEY);
}

// --- Lock state persistence ---

export async function setLockState(locked: boolean): Promise<void> {
  if (!WALLET_SUPPORTED) return;
  if (locked) {
    await secureSet(LOCK_STATE_KEY, 'locked');
  } else {
    await secureRemove(LOCK_STATE_KEY);
  }
}

export async function getLockState(): Promise<boolean> {
  const val = await secureGet(LOCK_STATE_KEY);
  return val === 'locked';
}
