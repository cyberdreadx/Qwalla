import { ROUGECHAIN_API } from '@/constants/config';
import { rc } from '@/lib/rougechain';

type WalletEntry = Record<string, unknown>;

export async function registerName(body: {
  name: string;
  publicKey: string;
  encPublicKey: string;
}): Promise<{ success: boolean; address?: string; error?: string }> {
  try {
    const res = await fetch(`${ROUGECHAIN_API}/names/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: body.name,
        publicKey: body.publicKey,
        encPublicKey: body.encPublicKey,
      }),
    });
    const data = await res.json().catch(() => ({}));
    return { success: data.success !== false, address: data.address, error: data.error };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Registration failed' };
  }
}

export async function lookupName(name: string): Promise<{
  name: string;
  publicKey: string;
  encPublicKey: string;
} | null> {
  const cleanName = name.replace(/@.*/, '').toLowerCase().trim();
  if (!cleanName) return null;

  try {
    const res = await fetch(
      `${ROUGECHAIN_API}/names/lookup?name=${encodeURIComponent(cleanName)}`
    );
    if (res.ok) {
      const data = await res.json();
      if (data.publicKey && data.encPublicKey) {
        return {
          name: data.name ?? cleanName,
          publicKey: data.publicKey,
          encPublicKey: data.encPublicKey,
        };
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
    const res = await fetch(
      `${ROUGECHAIN_API}/names/reverse?publicKey=${encodeURIComponent(publicKey)}`
    );
    if (res.ok) {
      const data = await res.json();
      if (data.name) return data.name;
    }
  } catch { /* fall through */ }
  return null;
}
