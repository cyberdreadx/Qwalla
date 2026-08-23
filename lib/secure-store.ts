import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
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

/**
 * PBKDF2-HMAC-SHA-256 → 32-byte AES key. Async so the 200k-iteration derivation
 * yields to the event loop instead of freezing the UI thread (see pbkdf2Async).
 */
export function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return pbkdf2Async(sha256, new TextEncoder().encode(password), salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: 32,
  });
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
