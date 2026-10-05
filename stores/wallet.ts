import { create } from 'zustand';

import { Wallet, bytesToHex, validateMnemonic } from '@rougechain/sdk';
import { deriveRougeeKem } from '@qwalla/core/pq';

import {
  disableBiometricUnlock,
  enableBiometricUnlock,
  getBiometricKey,
  isBiometricEnabled,
} from '@/lib/biometric';
import { emitDappEvent } from '@/lib/dapp-events';
import { clearMessageCache } from '@/lib/message-cache';
import { registerPushNotifications, unregisterPushNotifications } from '@/lib/push';
import { rc } from '@/lib/rougechain';
import { useSettingsStore } from '@/stores/settings';
import {
  clearWalletBundle,
  encryptAndSaveAccounts,
  getStoredFormat,
  loadAccountsMeta,
  loadLegacyBundle,
  resaveAccounts,
  saveLegacyBundle,
  setLockState,
  unlockAccounts,
  unlockAccountsWithKey,
  WALLET_SUPPORTED,
  type StoredWalletBundle,
  type WalletMeta,
} from '@/lib/secure-store';

/**
 * Message-encryption keypair, DETERMINISTICALLY derived from the wallet's seed
 * (mnemonic when available, else the private key) so the recovery phrase alone
 * restores chat history for wallets created/imported from here on.
 */
function deriveEncKeys(mnemonic: string | null, privateKeyHex: string) {
  const kp = deriveRougeeKem(mnemonic, privateKeyHex);
  return { encPublicKey: kp.publicKeyHex, encPrivateKey: bytesToHex(kp.secretKey) };
}

/**
 * Resolve the messaging keypair to use for a stored bundle, migrating older
 * wallets onto the shared seed-derived (recovery-phrase) key while preserving
 * the pre-migration random key as a decrypt-only fallback.
 *
 * - No mnemonic (raw-key import): can't derive the shared key — use the stored
 *   key as-is, no legacy fallback.
 * - Stored key already equals the seed-derived key: nothing to migrate.
 * - Stored key differs (old random key): primary = seed key (so the site/peers
 *   interoperate and outgoing uses the shared identity); legacy = the stored
 *   random key so messages encrypted to it before migration still open.
 */
function resolveEncKeys(b: StoredWalletBundle): {
  encPublicKey: string;
  encPrivateKey: string;
  legacyEncPublicKey: string | null;
  legacyEncPrivateKey: string | null;
} {
  if (!b.mnemonic) {
    return {
      encPublicKey: b.encPublicKey,
      encPrivateKey: b.encPrivateKey,
      legacyEncPublicKey: null,
      legacyEncPrivateKey: null,
    };
  }
  const seed = deriveEncKeys(b.mnemonic, b.privateKey);
  const alreadySeed = (b.encPublicKey ?? '').toLowerCase() === seed.encPublicKey.toLowerCase();
  return {
    encPublicKey: seed.encPublicKey,
    encPrivateKey: seed.encPrivateKey,
    legacyEncPublicKey: alreadySeed ? null : b.encPublicKey,
    legacyEncPrivateKey: alreadySeed ? null : b.encPrivateKey,
  };
}

/**
 * The wallet persists private keys, so it only runs where there's OS-backed
 * secure storage: the iOS/Android app and the Electron desktop app.
 */
const WEB_UNSUPPORTED = 'The Qwalla wallet is available in the iOS, Android, and desktop apps.';
function assertNativeWallet() {
  if (!WALLET_SUPPORTED) throw new Error(WEB_UNSUPPORTED);
}

type BackupPayload = {
  publicKey: string;
  privateKey: string;
  encPublicKey?: string;
  encPrivateKey?: string;
  mnemonic?: string;
  displayName?: string;
};

/** Ways to bring a new account into being (used by onboarding + addAccount). */
export type AddAccountSpec =
  | { kind: 'create'; displayName: string }
  | { kind: 'import'; publicKey: string; privateKey: string; displayName: string }
  | { kind: 'mnemonic'; mnemonic: string; displayName: string }
  | { kind: 'backup'; payload: BackupPayload };

type WalletState = {
  hydrated: boolean;
  // ── Active account (mirrors the active entry in `allBundles`) ──
  wallet: Wallet | null;
  mnemonic: string | null;
  encPublicKey: string | null;
  encPrivateKey: string | null;
  /**
   * Pre-migration messaging key. Wallets created before the seed-derived scheme
   * used a RANDOM ML-KEM keypair; their old messages are encrypted to it. When a
   * seed-backed wallet's stored key is that old random one, we promote the
   * seed-derived key to primary (encPublicKey/encPrivateKey) for interop with
   * the site and keep the random one here so existing threads still decrypt.
   * Null when there's nothing to fall back to (already seed-derived, or no seed).
   */
  legacyEncPublicKey: string | null;
  legacyEncPrivateKey: string | null;
  displayName: string;
  avatarUrl: string | null;
  // ── Multi-account ──
  /** Non-secret metadata for every account (for the switcher / lock screen). */
  accounts: WalletMeta[];
  /** publicKey of the active account (null when none). */
  activeId: string | null;
  /** Decrypted bundles for all accounts; in-memory only, [] while locked. */
  allBundles: StoredWalletBundle[];
  // ── Lock / auth ──
  isLocked: boolean;
  hasPassword: boolean;
  biometricEnabled: boolean;
  /** In-memory only (never persisted): password-derived key + salt for re-saving. */
  sessionKey: Uint8Array | null;
  sessionSalt: Uint8Array | null;
  hydrate: (knownFormat?: 'none' | 'encrypted' | 'legacy') => Promise<void>;
  createWallet: (displayName: string) => Promise<void>;
  importWallet: (publicKey: string, privateKey: string, displayName: string) => Promise<void>;
  importFromBackup: (payload: BackupPayload) => Promise<void>;
  importFromMnemonic: (mnemonic: string, displayName: string) => Promise<void>;
  /** Add a 2nd/3rd account (requires an unlocked, password-protected wallet). */
  addAccount: (spec: AddAccountSpec) => Promise<void>;
  /** Make `id` the active account (instant — no re-decrypt). */
  switchAccount: (id: string) => Promise<void>;
  /** Remove one account. Removing the last one logs out (wipes the device). */
  removeAccount: (id: string) => Promise<void>;
  logout: () => Promise<void>;
  setDisplayName: (name: string) => Promise<void>;
  /** Re-register the active wallet on the node (e.g. after toggling discoverable). */
  reRegister: () => void;
  setAvatar: (url: string | null) => Promise<void>;
  setPassword: (password: string) => Promise<void>;
  lock: () => Promise<void>;
  unlock: (password: string) => Promise<boolean>;
  enableBiometrics: (password: string) => Promise<boolean>;
  disableBiometrics: () => Promise<void>;
  unlockWithBiometrics: () => Promise<boolean>;
};

// ── Pure helpers ──────────────────────────────────────────────────────────

function metaOfBundle(b: StoredWalletBundle): WalletMeta {
  return { publicKey: b.publicKey, displayName: b.displayName, avatarUrl: b.avatarUrl };
}

/** The active-account state slice derived from a decrypted bundle. */
function activeFieldsFromBundle(b: StoredWalletBundle) {
  const enc = resolveEncKeys(b);
  return {
    wallet: Wallet.fromKeys(b.publicKey, b.privateKey),
    mnemonic: b.mnemonic ?? null,
    encPublicKey: enc.encPublicKey,
    encPrivateKey: enc.encPrivateKey,
    legacyEncPublicKey: enc.legacyEncPublicKey,
    legacyEncPrivateKey: enc.legacyEncPrivateKey,
    displayName: b.displayName,
    avatarUrl: b.avatarUrl ?? null,
  };
}

/** Full state slice for a set of bundles with `activeId` selected. */
function stateForBundles(bundles: StoredWalletBundle[], activeId: string) {
  const active = bundles.find((b) => b.publicKey === activeId) ?? bundles[0] ?? null;
  return {
    allBundles: bundles,
    accounts: bundles.map(metaOfBundle),
    activeId: active?.publicKey ?? null,
    ...(active
      ? activeFieldsFromBundle(active)
      : {
          wallet: null as Wallet | null,
          mnemonic: null as string | null,
          encPublicKey: null as string | null,
          encPrivateKey: null as string | null,
          legacyEncPublicKey: null as string | null,
          legacyEncPrivateKey: null as string | null,
          displayName: '',
          avatarUrl: null as string | null,
        }),
  };
}

/** Persist all accounts: encrypted blob when a password is set, else legacy single. */
async function persistAccounts(s: {
  allBundles: StoredWalletBundle[];
  activeId: string | null;
  hasPassword: boolean;
  sessionKey: Uint8Array | null;
  sessionSalt: Uint8Array | null;
}) {
  const activeId = s.activeId ?? s.allBundles[0]?.publicKey ?? '';
  if (s.hasPassword && s.sessionKey && s.sessionSalt) {
    await resaveAccounts({ accounts: s.allBundles, activeId }, s.sessionKey, s.sessionSalt);
  } else if (s.allBundles.length === 1) {
    // No password yet → single legacy plaintext bundle (Keychain-protected).
    await saveLegacyBundle(s.allBundles[0]);
  }
  // (no-password + >1 account can't happen: addAccount requires a password.)
}

/** Build a wallet + storable bundle from a spec (throws on invalid input). */
function makeBundle(spec: AddAccountSpec): { wallet: Wallet; bundle: StoredWalletBundle } {
  switch (spec.kind) {
    case 'create': {
      const wallet = Wallet.generate();
      const { encPublicKey, encPrivateKey } = deriveEncKeys(wallet.mnemonic ?? null, wallet.privateKey);
      return {
        wallet,
        bundle: {
          publicKey: wallet.publicKey,
          privateKey: wallet.privateKey,
          encPublicKey,
          encPrivateKey,
          displayName: spec.displayName,
          mnemonic: wallet.mnemonic,
        },
      };
    }
    case 'import': {
      const wallet = Wallet.fromKeys(spec.publicKey.trim(), spec.privateKey.trim());
      if (!wallet.verify()) throw new Error('Invalid key pair');
      const { encPublicKey, encPrivateKey } = deriveEncKeys(null, wallet.privateKey);
      return {
        wallet,
        bundle: {
          publicKey: wallet.publicKey,
          privateKey: wallet.privateKey,
          encPublicKey,
          encPrivateKey,
          displayName: spec.displayName,
        },
      };
    }
    case 'mnemonic': {
      const phrase = spec.mnemonic.trim().toLowerCase();
      if (!validateMnemonic(phrase)) throw new Error('Invalid recovery phrase');
      const wallet = Wallet.fromMnemonic(phrase);
      const { encPublicKey, encPrivateKey } = deriveEncKeys(phrase, wallet.privateKey);
      return {
        wallet,
        bundle: {
          publicKey: wallet.publicKey,
          privateKey: wallet.privateKey,
          encPublicKey,
          encPrivateKey,
          displayName: spec.displayName,
          mnemonic: phrase,
        },
      };
    }
    case 'backup': {
      const p = spec.payload;
      const wallet = Wallet.fromKeys(p.publicKey.trim(), p.privateKey.trim());
      let encPublicKey: string;
      let encPrivateKey: string;
      if (p.encPublicKey && p.encPrivateKey) {
        // A proper backup carries the exact keys — always use them so messages decrypt.
        encPublicKey = p.encPublicKey;
        encPrivateKey = p.encPrivateKey;
      } else {
        const d = deriveEncKeys(p.mnemonic ?? null, wallet.privateKey);
        encPublicKey = d.encPublicKey;
        encPrivateKey = d.encPrivateKey;
      }
      return {
        wallet,
        bundle: {
          publicKey: wallet.publicKey,
          privateKey: wallet.privateKey,
          encPublicKey,
          encPrivateKey,
          displayName: p.displayName || 'Restored',
          mnemonic: p.mnemonic,
        },
      };
    }
  }
}

async function registerOnNode(
  wallet: Wallet,
  displayName: string,
  encPublicKey: string,
  tag: string,
  avatarUrl?: string | null,
) {
  try {
    await rc.messenger.registerWallet(wallet, {
      id: wallet.publicKey,
      displayName,
      signingPublicKey: wallet.publicKey,
      encryptionPublicKey: encPublicKey,
      discoverable: useSettingsStore.getState().discoverable,
      ...(avatarUrl ? { avatarUrl } : {}),
    });
    console.log(`[Qwalla] Wallet registered on node (${tag})`);
  } catch (e) {
    console.warn(`[Qwalla] Wallet registration failed (${tag}):`, e);
  }
}

const emptyState = {
  wallet: null as Wallet | null,
  mnemonic: null as string | null,
  encPublicKey: null as string | null,
  encPrivateKey: null as string | null,
  legacyEncPublicKey: null as string | null,
  legacyEncPrivateKey: null as string | null,
  displayName: '',
  avatarUrl: null as string | null,
  accounts: [] as WalletMeta[],
  activeId: null as string | null,
  allBundles: [] as StoredWalletBundle[],
};

export const useWalletStore = create<WalletState>((set, get) => ({
  hydrated: false,
  ...emptyState,
  isLocked: false,
  hasPassword: false,
  biometricEnabled: false,
  sessionKey: null,
  sessionSalt: null,

  hydrate: async (knownFormat) => {
    // When the caller already read the format (welcome-screen recovery), trust it
    // and DON'T re-read — a re-read can race back to 'none' on a device whose
    // storage is briefly flaky, causing a ping-pong that strands the user.
    const format = knownFormat ?? (await getStoredFormat());
    set({ biometricEnabled: await isBiometricEnabled() });

    if (format === 'none') {
      set({ hydrated: true, ...emptyState, hasPassword: false, isLocked: false, sessionKey: null, sessionSalt: null });
      // The welcome-screen recovery (useWalletRecovery) keeps polling and calls
      // hydrate('encrypted'|'legacy') once storage responds — no self-heal loop
      // here, to avoid a storm of concurrent reads that can worsen the flakiness.
      return;
    }

    if (format === 'encrypted') {
      // Keys are encrypted at rest; show the (readable) account metas, stay locked.
      const meta = await loadAccountsMeta();
      const active = meta?.metas.find((m) => m.publicKey === meta.activeId);
      await setLockState(true);
      set({
        hydrated: true,
        ...emptyState,
        accounts: meta?.metas ?? [],
        activeId: meta?.activeId ?? null,
        displayName: active?.displayName ?? '',
        avatarUrl: active?.avatarUrl ?? null,
        hasPassword: true,
        isLocked: true,
        sessionKey: null,
        sessionSalt: null,
      });
      return;
    }

    // Legacy plaintext wallet (no password yet) — load it unlocked as account #1.
    const bundle = await loadLegacyBundle();
    if (!bundle) {
      set({ hydrated: true, ...emptyState, hasPassword: false, isLocked: false });
      return;
    }
    const patch = stateForBundles([bundle], bundle.publicKey);
    set({ hydrated: true, ...patch, hasPassword: false, isLocked: false, sessionKey: null, sessionSalt: null });
    await setLockState(false);
    void registerPushNotifications(patch.wallet!);
    // Advertise the resolved (seed-derived) key so the directory holds the
    // shared messaging identity for migrated wallets, not the old random one.
    void registerOnNode(patch.wallet!, bundle.displayName, patch.encPublicKey ?? bundle.encPublicKey, 're-register', bundle.avatarUrl);
  },

  // ── Onboarding (first account) ──────────────────────────────────────────

  createWallet: async (displayName: string) => {
    assertNativeWallet();
    const { wallet, bundle } = makeBundle({ kind: 'create', displayName });
    await saveLegacyBundle(bundle);
    set({ ...stateForBundles([bundle], bundle.publicKey), hasPassword: false, isLocked: false, sessionKey: null, sessionSalt: null });
    void registerPushNotifications(wallet);
    void registerOnNode(wallet, displayName, bundle.encPublicKey, 'create');
  },

  importWallet: async (publicKey: string, privateKey: string, displayName: string) => {
    assertNativeWallet();
    const { wallet, bundle } = makeBundle({ kind: 'import', publicKey, privateKey, displayName });
    await saveLegacyBundle(bundle);
    set({ ...stateForBundles([bundle], bundle.publicKey), hasPassword: false, isLocked: false, sessionKey: null, sessionSalt: null });
    void registerPushNotifications(wallet);
    void registerOnNode(wallet, displayName, bundle.encPublicKey, 'import');
  },

  importFromBackup: async (payload) => {
    assertNativeWallet();
    const { wallet, bundle } = makeBundle({ kind: 'backup', payload });
    await saveLegacyBundle(bundle);
    set({ ...stateForBundles([bundle], bundle.publicKey), hasPassword: false, isLocked: false, sessionKey: null, sessionSalt: null });
    void registerPushNotifications(wallet);
    void registerOnNode(wallet, bundle.displayName, bundle.encPublicKey, 'backup');
  },

  importFromMnemonic: async (mnemonic: string, displayName: string) => {
    assertNativeWallet();
    const { wallet, bundle } = makeBundle({ kind: 'mnemonic', mnemonic, displayName });
    await saveLegacyBundle(bundle);
    set({ ...stateForBundles([bundle], bundle.publicKey), hasPassword: false, isLocked: false, sessionKey: null, sessionSalt: null });
    void registerPushNotifications(wallet);
    void registerOnNode(wallet, displayName, bundle.encPublicKey, 'mnemonic');
  },

  // ── Multi-account ───────────────────────────────────────────────────────

  addAccount: async (spec) => {
    assertNativeWallet();
    const s = get();
    if (!s.hasPassword || !s.sessionKey || !s.sessionSalt) {
      throw new Error('Set a wallet password before adding another account.');
    }
    const { wallet, bundle } = makeBundle(spec);
    if (s.allBundles.some((b) => b.publicKey === bundle.publicKey)) {
      throw new Error('That account is already added.');
    }
    const bundles = [...s.allBundles, bundle];
    const patch = stateForBundles(bundles, bundle.publicKey);
    set(patch);
    await persistAccounts({ ...s, allBundles: bundles, activeId: bundle.publicKey });
    emitDappEvent('accountsChanged', [bundle.publicKey]);
    void registerPushNotifications(wallet);
    void registerOnNode(wallet, bundle.displayName, bundle.encPublicKey, 'add-account', bundle.avatarUrl ?? null);
  },

  switchAccount: async (id) => {
    const s = get();
    if (id === s.activeId) return;
    const target = s.allBundles.find((b) => b.publicKey === id);
    if (!target) return;
    const prev = s.wallet;
    if (prev) void unregisterPushNotifications(prev);
    const patch = stateForBundles(s.allBundles, id);
    set(patch);
    await persistAccounts({ ...s, activeId: id });
    emitDappEvent('accountsChanged', [target.publicKey]);
    void registerPushNotifications(patch.wallet!);
    void registerOnNode(patch.wallet!, target.displayName, patch.encPublicKey ?? target.encPublicKey, 'switch', target.avatarUrl ?? null);
  },

  removeAccount: async (id) => {
    const s = get();
    const removed = s.allBundles.find((b) => b.publicKey === id);
    const bundles = s.allBundles.filter((b) => b.publicKey !== id);
    if (bundles.length === 0) {
      // Removing the only account = full wipe.
      await get().logout();
      return;
    }
    if (removed) {
      // Reflect the removal in the node directory / stop its pushes.
      void unregisterPushNotifications(Wallet.fromKeys(removed.publicKey, removed.privateKey));
    }
    const wasActive = id === s.activeId;
    const newActiveId = wasActive ? bundles[0].publicKey : s.activeId ?? bundles[0].publicKey;
    const patch = stateForBundles(bundles, newActiveId);
    set(patch);
    await persistAccounts({ ...s, allBundles: bundles, activeId: newActiveId });
    if (wasActive && patch.wallet) {
      emitDappEvent('accountsChanged', [patch.wallet.publicKey]);
      void registerPushNotifications(patch.wallet);
      void registerOnNode(patch.wallet, patch.displayName, patch.encPublicKey ?? '', 'switch', patch.avatarUrl);
    }
  },

  logout: async () => {
    const w = get().wallet;
    if (w) void unregisterPushNotifications(w);
    emitDappEvent('accountsChanged', []);
    emitDappEvent('disconnect', {});
    await clearWalletBundle();
    await clearMessageCache();
    await disableBiometricUnlock();
    await setLockState(false);
    set({ ...emptyState, isLocked: false, hasPassword: false, biometricEnabled: false, sessionKey: null, sessionSalt: null });
  },

  setDisplayName: async (name: string) => {
    const s = get();
    if (!s.activeId || !s.wallet || !s.encPublicKey) return;
    const bundles = s.allBundles.map((b) => (b.publicKey === s.activeId ? { ...b, displayName: name } : b));
    set({ allBundles: bundles, accounts: bundles.map(metaOfBundle), displayName: name });
    await persistAccounts({ ...s, allBundles: bundles });
    void registerOnNode(s.wallet, name, s.encPublicKey, 'rename', s.avatarUrl);
  },

  reRegister: () => {
    const s = get();
    if (s.wallet && s.encPublicKey) {
      void registerOnNode(s.wallet, s.displayName, s.encPublicKey, 'discoverable', s.avatarUrl);
    }
  },

  setAvatar: async (url: string | null) => {
    const s = get();
    if (!s.activeId || !s.wallet || !s.encPublicKey) return;
    const bundles = s.allBundles.map((b) =>
      b.publicKey === s.activeId ? { ...b, avatarUrl: url ?? undefined } : b,
    );
    set({ allBundles: bundles, accounts: bundles.map(metaOfBundle), avatarUrl: url });
    await persistAccounts({ ...s, allBundles: bundles });
    void registerOnNode(s.wallet, s.displayName, s.encPublicKey, 'avatar', url);
  },

  // Set/change the shared password: (re-)encrypt ALL accounts under a fresh key.
  setPassword: async (password: string) => {
    const s = get();
    if (s.allBundles.length === 0) throw new Error('No wallet loaded');
    const activeId = s.activeId ?? s.allBundles[0].publicKey;
    const { key, salt } = await encryptAndSaveAccounts({ accounts: s.allBundles, activeId }, password);
    await setLockState(false);
    if (get().biometricEnabled) {
      try {
        await enableBiometricUnlock(bytesToHex(key));
      } catch {
        await disableBiometricUnlock();
        set({ biometricEnabled: false });
      }
    }
    set({ hasPassword: true, sessionKey: key, sessionSalt: salt });
  },

  lock: async () => {
    if (!get().hasPassword) return;
    await setLockState(true);
    // Clear secrets + decrypted bundles; keep account metas for the lock screen.
    set({
      wallet: null,
      mnemonic: null,
      encPublicKey: null,
      encPrivateKey: null,
      legacyEncPublicKey: null,
      legacyEncPrivateKey: null,
      allBundles: [],
      isLocked: true,
      sessionKey: null,
      sessionSalt: null,
    });
  },

  unlock: async (password: string) => {
    const result = await unlockAccounts(password);
    if (!result) return false;
    const patch = stateForBundles(result.payload.accounts, result.payload.activeId);
    await setLockState(false);
    set({ ...patch, hasPassword: true, isLocked: false, sessionKey: result.key, sessionSalt: result.salt });
    if (patch.wallet) {
      void registerPushNotifications(patch.wallet);
      void registerOnNode(patch.wallet, patch.displayName, patch.encPublicKey ?? '', 'unlock', patch.avatarUrl);
    }
    return true;
  },

  enableBiometrics: async (password: string) => {
    // Verify the password decrypts the accounts, then stash the derived key.
    const result = await unlockAccounts(password);
    if (!result) return false;
    await enableBiometricUnlock(bytesToHex(result.key));
    set({ biometricEnabled: true });
    return true;
  },

  disableBiometrics: async () => {
    await disableBiometricUnlock();
    set({ biometricEnabled: false });
  },

  unlockWithBiometrics: async () => {
    const keyHex = await getBiometricKey('Unlock your Qwalla wallet');
    if (!keyHex) return false;
    const result = await unlockAccountsWithKey(keyHex);
    if (!result) {
      await disableBiometricUnlock();
      set({ biometricEnabled: false });
      return false;
    }
    const patch = stateForBundles(result.payload.accounts, result.payload.activeId);
    await setLockState(false);
    set({ ...patch, hasPassword: true, isLocked: false, sessionKey: result.key, sessionSalt: result.salt });
    if (patch.wallet) {
      void registerPushNotifications(patch.wallet);
      void registerOnNode(patch.wallet, patch.displayName, patch.encPublicKey ?? '', 'unlock', patch.avatarUrl);
    }
    return true;
  },
}));
