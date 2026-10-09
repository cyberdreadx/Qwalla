import { readFileSync } from 'node:fs';
import path from 'node:path';

import { setHostAdapters } from '@qwalla/core/host';
import {
  addConnectedSite,
  allowDecrypt,
  canDecrypt,
  getConnectedSites,
  removeConnectedSite,
  revokeDecrypt,
} from '@qwalla/core/provider-bridge';
import { ensureDecryptPermission } from '@/lib/decrypt-permission';

// window.rougechain.decrypt opens envelopes with the wallet's messaging keys, so a site needs an
// explicit, remembered "read encrypted messages" grant on top of being connected.

const mem = new Map<string, string>();
setHostAdapters({
  storage: {
    get: async (k) => mem.get(k) ?? null,
    set: async (k, v) => { mem.set(k, v); },
    remove: async (k) => { mem.delete(k); },
  },
});

const SITE = 'https://gltch.app';
const OTHER = 'https://evil.example';

beforeEach(() => mem.clear());

describe('decrypt grant in connected sites', () => {
  it('is separate from connecting, and only for connected sites', async () => {
    await addConnectedSite(SITE);
    expect(await canDecrypt(SITE)).toBe(false); // connecting alone is not enough
    await allowDecrypt(OTHER); // not connected → no-op
    expect(await canDecrypt(OTHER)).toBe(false);
    await allowDecrypt(SITE);
    expect(await canDecrypt(SITE)).toBe(true);
  });

  it('is withdrawn by Revoke (site stays connected) and by disconnecting', async () => {
    await addConnectedSite(SITE);
    await allowDecrypt(SITE);
    await revokeDecrypt(SITE);
    expect(await canDecrypt(SITE)).toBe(false);
    expect((await getConnectedSites()).map((s) => s.origin)).toEqual([SITE]);

    await allowDecrypt(SITE);
    await removeConnectedSite(SITE);
    await addConnectedSite(SITE); // reconnecting does not bring the grant back
    expect(await canDecrypt(SITE)).toBe(false);
  });

  it('sites connected before the grant existed are not grandfathered in', async () => {
    mem.set('qwalla_connected_sites', JSON.stringify([{ origin: SITE, connectedAt: 1 }]));
    expect(await canDecrypt(SITE)).toBe(false);
  });
});

describe('ensureDecryptPermission', () => {
  it('asks once; "allow" is remembered for that site only', async () => {
    await addConnectedSite(SITE);
    await addConnectedSite(OTHER);
    const ask = jest.fn(async () => true);
    expect(await ensureDecryptPermission(SITE, ask)).toBe(true);
    expect(await ensureDecryptPermission(SITE, ask)).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(await canDecrypt(OTHER)).toBe(false);
  });

  it('"deny" is not remembered — the next call asks again', async () => {
    await addConnectedSite(SITE);
    const ask = jest.fn(async () => false);
    expect(await ensureDecryptPermission(SITE, ask)).toBe(false);
    expect(await ensureDecryptPermission(SITE, ask)).toBe(false);
    expect(ask).toHaveBeenCalledTimes(2);
    expect(await canDecrypt(SITE)).toBe(false);
  });

  it('an inbox decrypting many envelopes at once gets one prompt', async () => {
    await addConnectedSite(SITE);
    let answer!: (yes: boolean) => void;
    const ask = jest.fn(() => new Promise<boolean>((r) => { answer = r; }));
    const calls = Array.from({ length: 20 }, () => ensureDecryptPermission(SITE, ask));
    await new Promise((r) => setTimeout(r, 0));
    answer(true);
    expect(await Promise.all(calls)).toEqual(Array(20).fill(true));
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('a prompt that errors counts as a denial', async () => {
    await addConnectedSite(SITE);
    expect(await ensureDecryptPermission(SITE, async () => { throw new Error('sheet crashed'); })).toBe(false);
    expect(await canDecrypt(SITE)).toBe(false);
  });
});

describe('dApp handler wiring', () => {
  const src = readFileSync(path.join(__dirname, '..', 'lib', 'dapp-provider.ts'), 'utf8');
  const decryptCase = src.slice(src.indexOf("case 'decrypt'"), src.indexOf('default:', src.indexOf("case 'decrypt'")));

  it('decrypt checks the connection, validates params, then asks — before touching any key', () => {
    const order = ['isConnected(request.origin)', 'decrypt requires envelope and myId', 'ensureDecryptPermission(', 'deriveRougeeKem('];
    const at = order.map((s) => decryptCase.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
});
