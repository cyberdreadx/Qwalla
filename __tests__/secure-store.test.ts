// In-memory mock of the OS secure store so the wallet-at-rest crypto can be
// exercised in Node.
jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      delete store[k];
    }),
    WHEN_UNLOCKED: 'whenUnlocked',
  };
});

import {
  clearWalletBundle,
  encryptAndSaveWallet,
  getStoredFormat,
  loadWalletMeta,
  unlockWallet,
  type StoredWalletBundle,
} from '@/lib/secure-store';

const bundle: StoredWalletBundle = {
  publicKey: 'aabbcc',
  privateKey: '112233',
  encPublicKey: 'ddeeff',
  encPrivateKey: '445566',
  displayName: 'Test Wallet',
  mnemonic: 'legal winner thank year wave sausage worth useful legal winner thank yellow',
};

describe('secure-store: wallet encryption at rest', () => {
  beforeEach(() => clearWalletBundle());

  it('round-trips the bundle with the correct password', async () => {
    const { key, salt } = await encryptAndSaveWallet(bundle, 'a-strong-password');
    expect(key.length).toBe(32);
    expect(salt.length).toBe(16);

    const res = await unlockWallet('a-strong-password');
    expect(res).not.toBeNull();
    expect(res!.bundle).toEqual(bundle);
  });

  it('returns null for a wrong password (GCM tag mismatch)', async () => {
    await encryptAndSaveWallet(bundle, 'correct-password');
    expect(await unlockWallet('wrong-password')).toBeNull();
  });

  it('stores an encrypted record, not plaintext keys', async () => {
    await encryptAndSaveWallet(bundle, 'another-password');
    expect(await getStoredFormat()).toBe('encrypted');

    // Lock-screen metadata is readable without the password…
    const meta = await loadWalletMeta();
    expect(meta?.publicKey).toBe(bundle.publicKey);
    expect(meta?.displayName).toBe(bundle.displayName);

    // …but the private key is never in the stored record in the clear.
    const SecureStore = require('expo-secure-store');
    const raw = await SecureStore.getItemAsync('qwalla_wallet_bundle_v1');
    expect(raw).not.toContain(bundle.privateKey);
    expect(raw).not.toContain(bundle.mnemonic);
  });
});
