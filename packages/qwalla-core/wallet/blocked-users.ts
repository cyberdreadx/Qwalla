/**
 * Cross-platform blocked-contacts list, keyed by the contact's signing public
 * key (the same value the chat passes as its `peer` param). Backed by the host
 * storage adapter (see @qwalla/core/host) so it runs on RN and in the browser.
 */
import { getHostStorage } from '../host';

const STORAGE_KEY = 'qwalla_blocked_wallets';

export async function getBlockedWallets(): Promise<string[]> {
  try {
    const raw = await getHostStorage().get(STORAGE_KEY);
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
  await getHostStorage().set(STORAGE_KEY, JSON.stringify(list));
}

export async function unblockWallet(signingPublicKey: string): Promise<void> {
  const list = await getBlockedWallets();
  const next = list.filter((k) => k !== signingPublicKey);
  await getHostStorage().set(STORAGE_KEY, JSON.stringify(next));
}
