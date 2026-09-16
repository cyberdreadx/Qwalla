import { rc } from '@/lib/rougechain';

/**
 * Shared, cached view of the messenger wallet directory (getWallets), so any
 * screen can resolve a wallet's display name + custom avatar without each one
 * refetching. Keyed by every id-ish field a wallet might be referenced by
 * (id / signing key / encryption key), value is the same entry.
 */

export type DirEntry = { name?: string; avatar?: string };

let cache: Map<string, DirEntry> | null = null;
let inflight: Promise<Map<string, DirEntry>> | null = null;
let fetchedAt = 0;
const TTL_MS = 60_000;

type RawWallet = Record<string, unknown>;

function buildMap(list: RawWallet[]): Map<string, DirEntry> {
  const map = new Map<string, DirEntry>();
  for (const w of list) {
    const name = String(w.displayName ?? w.display_name ?? '') || undefined;
    const avatar = String(w.avatarUrl ?? w.avatar_url ?? w.avatar ?? '') || undefined;
    if (!name && !avatar) continue;
    const entry: DirEntry = { name, avatar };
    for (const key of [
      w.id,
      w.publicKey,
      w.signingPublicKey,
      w.signing_public_key,
      w.encryptionPublicKey,
      w.encryption_public_key,
    ]) {
      if (typeof key === 'string' && key) map.set(key, entry);
    }
  }
  return map;
}

/** Get the directory, refetching at most once per TTL (or when `force`). */
export async function getWalletDirectory(force = false): Promise<Map<string, DirEntry>> {
  if (!force && cache && Date.now() - fetchedAt < TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const raw = await rc.messenger.getWallets();
      const list = (Array.isArray(raw) ? raw : []) as RawWallet[];
      cache = buildMap(list);
      fetchedAt = Date.now();
      return cache;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Look up a single wallet's directory entry (uses the cached map if fresh). */
export async function resolveWalletEntry(id: string): Promise<DirEntry | undefined> {
  if (!id) return undefined;
  const dir = await getWalletDirectory();
  return dir.get(id);
}
