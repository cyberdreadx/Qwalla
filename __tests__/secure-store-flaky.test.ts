// Reproduces the on-device failure: secure storage returns empty on the first
// read(s) after a cold start, then succeeds. Asserts the wallet is still found
// (not misreported as "no wallet" → onboarding) and that the multi-account v3
// blob round-trips through the AsyncStorage mirror.

// `mock`-prefixed so jest's hoisted mock factories may reference them.
const mockKeychain: Record<string, string> = {};
const mockAsync: Record<string, string> = {};
const mockCtl = { flakyReads: 0 }; // next N reads (any store) return null

async function mockRead(store: Record<string, string>, k: string): Promise<string | null> {
  if (mockCtl.flakyReads > 0) {
    mockCtl.flakyReads -= 1;
    return null;
  }
  return store[k] ?? null;
}

jest.mock('expo-secure-store', () => ({
  getItemAsync: (k: string) => mockRead(mockKeychain, k),
  setItemAsync: async (k: string, v: string) => {
    mockKeychain[k] = v;
  },
  deleteItemAsync: async (k: string) => {
    delete mockKeychain[k];
  },
  WHEN_UNLOCKED: 'whenUnlocked',
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (k: string) => mockRead(mockAsync, k),
    setItem: async (k: string, v: string) => {
      mockAsync[k] = v;
    },
    removeItem: async (k: string) => {
      delete mockAsync[k];
    },
  },
}));

import {
  clearWalletBundle,
  encryptAndSaveAccounts,
  getStoredFormat,
  unlockAccounts,
  type StoredWalletBundle,
} from '@/lib/secure-store';

function acct(n: number): StoredWalletBundle {
  return {
    publicKey: `pub${n}`.padEnd(8, '0'),
    privateKey: `priv${n}`.padEnd(8, '0'),
    encPublicKey: `enc${n}`.padEnd(8, '0'),
    encPrivateKey: `encpriv${n}`.padEnd(8, '0'),
    displayName: `Account ${n}`,
  };
}

const TWO_ACCOUNTS = { accounts: [acct(1), acct(2)], activeId: 'pub10000' };
const PASSWORD = 'correct-horse-battery-staple';

describe('secure-store: flaky cold-start reads', () => {
  beforeEach(async () => {
    mockCtl.flakyReads = 0;
    await clearWalletBundle();
  });

  it('round-trips a 2-account v3 blob', async () => {
    await encryptAndSaveAccounts(TWO_ACCOUNTS, PASSWORD);
    expect(await getStoredFormat()).toBe('encrypted');
    const res = await unlockAccounts(PASSWORD);
    expect(res).not.toBeNull();
    expect(res!.payload.accounts.map((a) => a.publicKey)).toEqual(['pub10000', 'pub20000']);
  });

  it('still finds the wallet when the first reads return empty (retry bridges it)', async () => {
    await encryptAndSaveAccounts(TWO_ACCOUNTS, PASSWORD);
    // Two empty reads before storage "wakes up" — within readWalletRecord's retry.
    mockCtl.flakyReads = 2;
    expect(await getStoredFormat()).toBe('encrypted');
  });

  it('recovery poll: repeated getStoredFormat eventually succeeds after a long empty window', async () => {
    await encryptAndSaveAccounts(TWO_ACCOUNTS, PASSWORD);
    // A long unready window that outlasts a single call's retry — the welcome
    // recovery re-polls, so simulate that: keep calling until it's non-'none'.
    mockCtl.flakyReads = 12;
    let fmt = 'none';
    for (let i = 0; i < 10 && fmt === 'none'; i++) {
      fmt = await getStoredFormat();
    }
    expect(fmt).toBe('encrypted');
  });

  it('does NOT prefer a stale keychain legacy over the real v3 blob', async () => {
    // Save the real 2-account v3 (writes keychain + async mirror).
    await encryptAndSaveAccounts(TWO_ACCOUNTS, PASSWORD);
    // Simulate a leftover single-account legacy record sitting in the keychain
    // (as happens after a re-import). The v3 mirror must still win.
    mockKeychain['qwalla_wallet_bundle_v1'] = JSON.stringify(acct(9));
    const res = await unlockAccounts(PASSWORD);
    expect(res).not.toBeNull();
    expect(res!.payload.accounts.length).toBe(2);
  });
});
