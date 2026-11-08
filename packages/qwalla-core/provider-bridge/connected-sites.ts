/**
 * Connected dApp sites — the origins the user has approved for wallet access.
 * Backed by the host storage adapter (see @qwalla/core/host) so it runs on
 * React Native and in the Electron browser without importing AsyncStorage here.
 */
import { getHostStorage } from '../host';

const STORAGE_KEY = 'qwalla_connected_sites';

export interface ConnectedSite {
  origin: string;
  connectedAt: number;
  favicon?: string;
  /**
   * Accounts (wallet public keys) whose encrypted messages this site may read via
   * `window.rougechain.decrypt` — granted per account, since each Qwalla account has its
   * own messaging keys and inbox (see lib/decrypt-permission). An older, account-less
   * `decryptAllowedAt` grant is ignored: those sites are asked again, per account.
   */
  decryptAllowedFor?: string[];
}

export async function getConnectedSites(): Promise<ConnectedSite[]> {
  try {
    const raw = await getHostStorage().get(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function isConnected(origin: string): Promise<boolean> {
  const sites = await getConnectedSites();
  return sites.some((s) => s.origin === origin);
}

export async function addConnectedSite(origin: string, favicon?: string): Promise<void> {
  const sites = await getConnectedSites();
  if (sites.some((s) => s.origin === origin)) return;
  sites.push({ origin, connectedAt: Date.now(), favicon });
  await getHostStorage().set(STORAGE_KEY, JSON.stringify(sites));
}

export async function removeConnectedSite(origin: string): Promise<void> {
  const sites = await getConnectedSites();
  const filtered = sites.filter((s) => s.origin !== origin);
  await getHostStorage().set(STORAGE_KEY, JSON.stringify(filtered));
}

export async function clearConnectedSites(): Promise<void> {
  await getHostStorage().remove(STORAGE_KEY);
}

const sameKey = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Whether a connected site may call `decrypt` for `account` (granted separately from connecting). */
export async function canDecrypt(origin: string, account: string): Promise<boolean> {
  if (!account) return false;
  const sites = await getConnectedSites();
  return sites.some((s) => s.origin === origin && (s.decryptAllowedFor ?? []).some((k) => sameKey(k, account)));
}

/** Grant `decrypt` for `account` to an already-connected site. No-op for a site that isn't connected. */
export async function allowDecrypt(origin: string, account: string): Promise<void> {
  if (!account) return;
  const sites = await getConnectedSites();
  const site = sites.find((s) => s.origin === origin);
  if (!site) return;
  const accounts = site.decryptAllowedFor ?? [];
  if (accounts.some((k) => sameKey(k, account))) return;
  site.decryptAllowedFor = [...accounts, account];
  await getHostStorage().set(STORAGE_KEY, JSON.stringify(sites));
}

/**
 * Withdraw `decrypt` from a site while keeping it connected — for one account, or for
 * every account when `account` is omitted.
 */
export async function revokeDecrypt(origin: string, account?: string): Promise<void> {
  const sites = await getConnectedSites();
  const site = sites.find((s) => s.origin === origin);
  if (!site?.decryptAllowedFor) return;
  const rest = account ? site.decryptAllowedFor.filter((k) => !sameKey(k, account)) : [];
  if (rest.length) site.decryptAllowedFor = rest;
  else delete site.decryptAllowedFor;
  await getHostStorage().set(STORAGE_KEY, JSON.stringify(sites));
}
