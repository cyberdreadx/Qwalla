import { decryptAny, decryptMailV2, decryptMessage } from '@qwalla/core/pq';

import { useWalletStore } from '@/stores/wallet';

/**
 * Decrypt helpers that transparently fall back to the wallet's pre-migration
 * messaging key.
 *
 * Wallets created before the seed-derived scheme used a random ML-KEM keypair.
 * We now promote the seed-derived (recovery-phrase) key to primary so Qwalla
 * interoperates with the site, but messages/mail encrypted to the old random
 * key before migration must still open. Each helper tries the primary key the
 * caller passes, and on failure retries with the legacy key held in the wallet
 * store (null for wallets that were already seed-derived or have no mnemonic).
 */

function legacyKeys(): { priv: string | null; pub: string | null } {
  const s = useWalletStore.getState();
  return { priv: s.legacyEncPrivateKey, pub: s.legacyEncPublicKey };
}

// Ordering hint: after a migration, a conversation's messages tend to be mostly
// one era (all legacy-key, or all seed-key). Remembering which key last worked
// lets us try it first, so a migrated wallet doesn't fail the seed key on every
// old message before falling back — avoids doubling the decrypt work on cold
// load. Correctness is unaffected (both keys are always tried); it's just order.
let preferLegacy = false;

export function decryptAnyFb(
  cipher: string,
  encPriv: string,
  encPub: string,
  isSender: boolean,
): string {
  const { priv, pub } = legacyKeys();
  const hasLegacy = !!(priv && pub);
  if (preferLegacy && hasLegacy) {
    try {
      return decryptAny(cipher, priv as string, pub as string, isSender);
    } catch {
      const r = decryptAny(cipher, encPriv, encPub, isSender);
      preferLegacy = false; // a seed-key message — flip back
      return r;
    }
  }
  try {
    return decryptAny(cipher, encPriv, encPub, isSender);
  } catch (e) {
    if (hasLegacy) {
      const r = decryptAny(cipher, priv as string, pub as string, isSender);
      preferLegacy = true; // legacy-era message — prefer legacy next
      return r;
    }
    throw e;
  }
}

export function decryptMailV2Fb(cipher: string, encPriv: string, encPub: string): string {
  try {
    return decryptMailV2(cipher, encPriv, encPub);
  } catch (e) {
    const { priv, pub } = legacyKeys();
    if (priv && pub) return decryptMailV2(cipher, priv, pub);
    throw e;
  }
}

export function decryptMessageFb(cipher: string, encPriv: string, isSender: boolean): string {
  try {
    return decryptMessage(cipher, encPriv, isSender);
  } catch (e) {
    const { priv } = legacyKeys();
    if (priv) return decryptMessage(cipher, priv, isSender);
    throw e;
  }
}
