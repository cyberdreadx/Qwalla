import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Cross-platform blocked-contacts list.
 *
 * Replaces the old web-only `localStorage` block, which was a silent no-op on
 * native (localStorage is undefined on iOS/Android). Keyed by the contact's
 * signing public key — the same value the chat passes as its `peer` param.
 */

const STORAGE_KEY = 'qwalla_blocked_wallets';

export async function getBlockedWallets(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export async function isBlocked(signingPublicKey: string): Promise<boolean> {
  if (!signingPublicKey) return false;
  const list = await getBlockedWallets();
  return list.includes(signingPublicKey);
}

export async function blockWallet(signingPublicKey: string): Promise<void> {
  if (!signingPublicKey) return;
  const list = await getBlockedWallets();
  if (list.includes(signingPublicKey)) return;
  list.push(signingPublicKey);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export async function unblockWallet(signingPublicKey: string): Promise<void> {
  const list = await getBlockedWallets();
  const next = list.filter((k) => k !== signingPublicKey);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
