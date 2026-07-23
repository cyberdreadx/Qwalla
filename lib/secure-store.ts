import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

const WALLET_KEY = 'qwalla_wallet_bundle_v1';
const PASSWORD_HASH_KEY = 'qwalla_password_hash_v2';
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

export async function saveWalletBundle(bundle: StoredWalletBundle): Promise<void> {
  if (!WALLET_SUPPORTED) {
    throw new Error('The Qwalla wallet is available in the iOS and Android app.');
  }
  await secureSet(WALLET_KEY, JSON.stringify(bundle));
}

export async function loadWalletBundle(): Promise<StoredWalletBundle | null> {
  const raw = await secureGet(WALLET_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredWalletBundle;
  } catch {
    return null;
  }
}

export async function clearWalletBundle(): Promise<void> {
  await secureRemove(WALLET_KEY);
}

// --- Password verifier for wallet lock ---
//
// Stored as `saltHex:derivedHex`. The password is stretched with PBKDF2-HMAC-
// SHA-256 over a random per-user salt so that a leaked verifier cannot be
// reversed with rainbow tables or cheap brute force. (The keys themselves are
// protected at rest by the OS Keychain/Keystore.)

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

/** Constant-time comparison to avoid leaking the verifier via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function derivePasswordHash(password: string, salt: Uint8Array): string {
  const key = pbkdf2(sha256, new TextEncoder().encode(password), salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: 32,
  });
  return toHex(key);
}

export async function savePasswordHash(password: string): Promise<void> {
  if (!WALLET_SUPPORTED) return;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const verifier = derivePasswordHash(password, salt);
  await secureSet(PASSWORD_HASH_KEY, `${toHex(salt)}:${verifier}`);
}

export async function verifyPassword(password: string): Promise<boolean> {
  const stored = await secureGet(PASSWORD_HASH_KEY);
  if (!stored) return false;
  const [saltHex, expected] = stored.split(':');
  if (!saltHex || !expected) return false;
  const actual = derivePasswordHash(password, fromHex(saltHex));
  return timingSafeEqual(actual, expected);
}

export async function hasStoredPassword(): Promise<boolean> {
  const stored = await secureGet(PASSWORD_HASH_KEY);
  return !!stored;
}

export async function clearPasswordHash(): Promise<void> {
  await secureRemove(PASSWORD_HASH_KEY);
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
