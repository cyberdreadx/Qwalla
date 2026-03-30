import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { sha256 } from '@noble/hashes/sha2';

const WALLET_KEY = 'qwalla_wallet_bundle_v1';
const PASSWORD_HASH_KEY = 'qwalla_password_hash_v1';
const LOCK_STATE_KEY = 'qwalla_lock_state_v1';

function webGet(key: string): string | null {
  if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return null;
  try {
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function webSet(key: string, value: string): void {
  if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return;
  try {
    globalThis.localStorage.setItem(key, value);
  } catch {
    /* quota / private mode */
  }
}

function webRemove(key: string): void {
  if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return;
  try {
    globalThis.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return webGet(key);
  return SecureStore.getItemAsync(key);
}

async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    webSet(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
}

async function secureRemove(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    webRemove(key);
    return;
  }
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

// --- Password hash for wallet lock ---

function hashPassword(password: string): string {
  const encoder = new TextEncoder();
  const hash = sha256(encoder.encode(password));
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function savePasswordHash(password: string): Promise<void> {
  const hash = hashPassword(password);
  await secureSet(PASSWORD_HASH_KEY, hash);
}

export async function verifyPassword(password: string): Promise<boolean> {
  const stored = await secureGet(PASSWORD_HASH_KEY);
  if (!stored) return false;
  const hash = hashPassword(password);
  return hash === stored;
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
