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
