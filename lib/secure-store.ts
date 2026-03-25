import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const WALLET_KEY = 'qwalla_wallet_bundle_v1';

/** Web: SecureStore has no Keychain; use localStorage for dev only (not as secure as native). */
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
  const payload = JSON.stringify(bundle);
  if (Platform.OS === 'web') {
    webSet(WALLET_KEY, payload);
    return;
  }
  await SecureStore.setItemAsync(WALLET_KEY, payload, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
}

export async function loadWalletBundle(): Promise<StoredWalletBundle | null> {
  let raw: string | null;
  if (Platform.OS === 'web') {
    raw = webGet(WALLET_KEY);
  } else {
    raw = await SecureStore.getItemAsync(WALLET_KEY);
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredWalletBundle;
  } catch {
    return null;
  }
}

export async function clearWalletBundle(): Promise<void> {
  if (Platform.OS === 'web') {
    webRemove(WALLET_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(WALLET_KEY);
}
