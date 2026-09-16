import AsyncStorage from '@react-native-async-storage/async-storage';
import { gcm } from '@noble/ciphers/aes.js';

import { getActiveNetworkId } from '@/lib/rougechain';
import { getMessageCacheKey } from '@/lib/secure-store';

/**
 * Encrypted, best-effort on-device cache for the messenger, so conversations
 * open instantly (render cached history, then refresh in the background) and
 * already-seen messages aren't re-decrypted or re-verified.
 *
 * Everything is AES-256-GCM encrypted at rest under a key held in the OS
 * keychain (see getMessageCacheKey), so decrypted message text never sits in
 * plaintext AsyncStorage. Caching is a no-op where secure storage is absent
 * (i.e. anywhere the wallet doesn't run). All failures fall back silently to a
 * normal network load — the cache is never authoritative.
 */

const PREFIX = 'qwalla_msgcache_';

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

// Scoped by network + wallet so testnet/mainnet and different wallets on one
// device never share a cache. `walletId` is truncated — it only needs to
// disambiguate, not round-trip.
function storageKey(walletId: string, suffix: string): string {
  return `${PREFIX}${getActiveNetworkId()}_${walletId.slice(0, 16)}_${suffix}`;
}

export async function readCache<T>(walletId: string, suffix: string): Promise<T | null> {
  try {
    const keyHex = await getMessageCacheKey();
    if (!keyHex) return null;
    const raw = await AsyncStorage.getItem(storageKey(walletId, suffix));
    if (!raw) return null;
    const { iv, ct } = JSON.parse(raw) as { iv: string; ct: string };
    const pt = gcm(fromHex(keyHex), fromHex(iv)).decrypt(fromHex(ct));
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } catch {
    return null;
  }
}

export async function writeCache(walletId: string, suffix: string, data: unknown): Promise<void> {
  try {
    const keyHex = await getMessageCacheKey();
    if (!keyHex) return;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const pt = new TextEncoder().encode(JSON.stringify(data));
    const ct = gcm(fromHex(keyHex), iv).encrypt(pt);
    await AsyncStorage.setItem(
      storageKey(walletId, suffix),
      JSON.stringify({ iv: toHex(iv), ct: toHex(ct) }),
    );
  } catch {
    /* best-effort — a failed write just means a slower next open */
  }
}

/** Drop every cached blob (call on logout). */
export async function clearMessageCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(PREFIX));
    if (mine.length) await AsyncStorage.multiRemove(mine);
  } catch {
    /* ignore */
  }
}
