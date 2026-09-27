import { nativePubkeyToAddress } from '@qwalla/core/wallet';

import { rc } from '@/lib/rougechain';

/**
 * Shared, cached view of the messenger wallet directory (getWallets), so any
 * screen can resolve a wallet's display name + custom avatar without each one
 * refetching. Keyed by every id-ish field a wallet might be referenced by
 * (id / signing key / encryption key), value is the same entry.
 *
 * The same fetch also builds a reverse `rouge1 address -> signing public key`
 * map so shielded sends can find a recipient's public key even when they have
 * never transacted on-chain (a shielded note is owned by a public key, and an
 * address is a one-way hash of it — see resolvePublicKeyByAddress).
 */

export type DirEntry = { name?: string; avatar?: string };

let cache: Map<string, DirEntry> | null = null;
let pkByAddr: Map<string, string> | null = null;
let inflight: Promise<Map<string, DirEntry>> | null = null;
let fetchedAt = 0;
const TTL_MS = 60_000;

type RawWallet = Record<string, unknown>;

function buildMaps(list: RawWallet[]): { entries: Map<string, DirEntry>; addrs: Map<string, string> } {
  const entries = new Map<string, DirEntry>();
  const addrs = new Map<string, string>();
  for (const w of list) {
    const signingPk = [w.publicKey, w.signingPublicKey, w.signing_public_key].find(
      (k): k is string => typeof k === 'string' && !!k,
    );
    // Reverse index: derive the on-chain address from the signing key.
    if (signingPk) {
      try {
        addrs.set(nativePubkeyToAddress(signingPk), signingPk);
      } catch {
        /* skip keys that don't hash to an address */
      }
    }

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
      if (typeof key === 'string' && key) entries.set(key, entry);
    }
  }
  return { entries, addrs };
}

/** Get the directory, refetching at most once per TTL (or when `force`). */
export async function getWalletDirectory(force = false): Promise<Map<string, DirEntry>> {
  if (!force && cache && Date.now() - fetchedAt < TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const raw = await rc.messenger.getWallets();
      const list = (Array.isArray(raw) ? raw : []) as RawWallet[];
      const { entries, addrs } = buildMaps(list);
      cache = entries;
      pkByAddr = addrs;
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

/**
 * Resolve a rouge1 address to its signing public key via the messenger
 * directory. Lets shielded sends reach any Qwalla contact whose key is
 * registered, even if that address has never appeared on-chain. Returns
 * undefined when the address isn't a known Qwalla wallet.
 */
export async function resolvePublicKeyByAddress(address: string): Promise<string | undefined> {
  if (!address) return undefined;
  await getWalletDirectory();
  return pkByAddr?.get(address);
}
