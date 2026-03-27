import type { Wallet } from '@rougechain/sdk';

import { rc } from '@/lib/rougechain';

type WalletEntry = Record<string, unknown>;

export async function registerName(wallet: Wallet, body: {
  name: string;
  publicKey: string;
  encPublicKey: string;
}): Promise<{ success: boolean; address?: string; error?: string }> {
  return rc.mail.registerName(wallet, body.name, body.publicKey);
}

export async function lookupName(name: string): Promise<{
  name: string;
  publicKey: string;
  encPublicKey: string;
} | null> {
  const cleanName = name.replace(/@.*/, '').toLowerCase().trim();
  if (!cleanName) return null;

  try {
    const resolved = await rc.mail.resolveName(cleanName);
    if (resolved?.wallet) {
      const w = resolved.wallet;
      const publicKey = w.signing_public_key ?? w.id ?? '';
      const encPublicKey = w.encryption_public_key ?? '';
      if (publicKey && encPublicKey) {
        return { name: cleanName, publicKey, encPublicKey };
      }
    }
  } catch { /* fall through to wallet dir */ }

  return lookupFromWalletDir(cleanName);
}

async function lookupFromWalletDir(query: string): Promise<{
  name: string;
  publicKey: string;
  encPublicKey: string;
} | null> {
  try {
    const wallets = await rc.messenger.getWallets();
    const list = (Array.isArray(wallets) ? wallets : []) as WalletEntry[];
    const q = query.toLowerCase();

    const match = list.find((w) => {
      const dn = String(w.displayName ?? w.display_name ?? '').toLowerCase();
      if (dn === q) return true;
      const keys = [w.id, w.publicKey, w.signingPublicKey, w.signing_public_key];
      return keys.some((k) => typeof k === 'string' && k.toLowerCase() === q);
    });

    if (!match) return null;

    const publicKey = String(match.signingPublicKey ?? match.signing_public_key ?? match.publicKey ?? match.id ?? '');
    const encPublicKey = String(match.encryptionPublicKey ?? match.encryption_public_key ?? match.encPublicKey ?? '');
    if (!publicKey || !encPublicKey) return null;

    const name = String(match.displayName ?? match.display_name ?? query);
    return { name, publicKey, encPublicKey };
  } catch {
    return null;
  }
}

export async function reverseLookupName(publicKey: string): Promise<string | null> {
  try {
    return await rc.mail.reverseLookup(publicKey);
  } catch {
    return null;
  }
}
