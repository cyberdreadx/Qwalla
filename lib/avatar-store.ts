import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Per-account avatar storage, kept OUT of the encrypted wallet record.
 *
 * Avatars are base64 data URIs (tens of KB). `expo-secure-store` has a ~2KB
 * value limit — storing an avatar inside the wallet bundle overflowed it, so the
 * whole record could fail to write and read back empty, which surfaced as "the
 * wallet logged me out / disappeared". Avatars aren't secret (they're published
 * to the messenger directory), so they live here in AsyncStorage keyed by public
 * key, while the secure-store record stays small and always readable.
 */

const PREFIX = 'qwalla_avatar_v1_';
const keyFor = (publicKey: string) => PREFIX + publicKey;

export async function getStoredAvatar(publicKey: string): Promise<string | undefined> {
  if (!publicKey) return undefined;
  try {
    return (await AsyncStorage.getItem(keyFor(publicKey))) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function setStoredAvatar(
  publicKey: string,
  avatar: string | null | undefined,
): Promise<void> {
  if (!publicKey) return;
  try {
    if (avatar) await AsyncStorage.setItem(keyFor(publicKey), avatar);
    else await AsyncStorage.removeItem(keyFor(publicKey));
  } catch {
    /* best-effort: a failed avatar write must never block a wallet save */
  }
}

type WithAvatar = { publicKey: string; avatarUrl?: string };

/**
 * Move each item's avatar into AsyncStorage and return copies WITHOUT it, so the
 * caller can persist a small record. The in-memory item is the source of truth,
 * so a cleared avatar (undefined) removes the stored one.
 */
export async function extractAvatars<T extends WithAvatar>(items: T[]): Promise<Omit<T, 'avatarUrl'>[]> {
  const out: Omit<T, 'avatarUrl'>[] = [];
  for (const it of items) {
    await setStoredAvatar(it.publicKey, it.avatarUrl ?? null);
    const { avatarUrl: _drop, ...rest } = it;
    out.push(rest);
  }
  return out;
}

/**
 * Re-attach avatars from AsyncStorage. An avatar already embedded on the item
 * (a legacy record written before this split) is kept as-is; it migrates out to
 * AsyncStorage on the next save via extractAvatars.
 */
export async function attachAvatars<T extends WithAvatar>(items: T[]): Promise<T[]> {
  const out: T[] = [];
  for (const it of items) {
    if (it.avatarUrl) {
      out.push(it);
      continue;
    }
    const stored = await getStoredAvatar(it.publicKey);
    out.push(stored ? { ...it, avatarUrl: stored } : it);
  }
  return out;
}
