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

export function decryptAnyFb(
  cipher: string,
  encPriv: string,
  encPub: string,
  isSender: boolean,
): string {
  try {
    return decryptAny(cipher, encPriv, encPub, isSender);
  } catch (e) {
    const { priv, pub } = legacyKeys();
    if (priv && pub) return decryptAny(cipher, priv, pub, isSender);
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
