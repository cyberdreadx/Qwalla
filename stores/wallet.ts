import { Platform } from 'react-native';
import { create } from 'zustand';

import { Wallet, bytesToHex, validateMnemonic } from '@rougechain/sdk';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';

import { emitDappEvent } from '@/lib/dapp-events';
import { registerPushNotifications, unregisterPushNotifications } from '@/lib/push';
import { rc } from '@/lib/rougechain';
import {
  clearWalletBundle,
  encryptAndSaveWallet,
  getStoredFormat,
  loadLegacyBundle,
  loadWalletMeta,
  resaveWallet,
  saveLegacyBundle,
  setLockState,
  unlockWallet,
  type StoredWalletBundle,
} from '@/lib/secure-store';

/** The wallet persists private keys, which is native-only (see lib/secure-store). */
const WEB_UNSUPPORTED = 'The Qwalla wallet is available in the iOS and Android app.';
function assertNativeWallet() {
  if (Platform.OS === 'web') throw new Error(WEB_UNSUPPORTED);
}

type WalletState = {
  hydrated: boolean;
  wallet: Wallet | null;
  mnemonic: string | null;
  encPublicKey: string | null;
  encPrivateKey: string | null;
  displayName: string;
  avatarUrl: string | null;
  isLocked: boolean;
  hasPassword: boolean;
  /** In-memory only (never persisted): password-derived key + salt for re-saving. */
  sessionKey: Uint8Array | null;
  sessionSalt: Uint8Array | null;
  hydrate: () => Promise<void>;
  createWallet: (displayName: string) => Promise<void>;
  importWallet: (publicKey: string, privateKey: string, displayName: string) => Promise<void>;
  importFromBackup: (payload: {
    publicKey: string;
    privateKey: string;
    encPublicKey?: string;
    encPrivateKey?: string;
    mnemonic?: string;
    displayName?: string;
  }) => Promise<void>;
  importFromMnemonic: (mnemonic: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  setDisplayName: (name: string) => Promise<void>;
  setAvatar: (url: string | null) => Promise<void>;
  setPassword: (password: string) => Promise<void>;
  lock: () => Promise<void>;
  unlock: (password: string) => Promise<boolean>;
};

/** Rebuild the on-disk bundle shape from current in-memory state. */
function bundleFromState(s: WalletState): StoredWalletBundle | null {
  if (!s.wallet || !s.encPublicKey || !s.encPrivateKey) return null;
  return {
    publicKey: s.wallet.publicKey,
    privateKey: s.wallet.privateKey,
    encPublicKey: s.encPublicKey,
    encPrivateKey: s.encPrivateKey,
    displayName: s.displayName,
    mnemonic: s.mnemonic ?? undefined,
    avatarUrl: s.avatarUrl ?? undefined,
  };
}

async function registerOnNode(wallet: Wallet, displayName: string, encPublicKey: string, tag: string) {
  try {
    await rc.messenger.registerWallet(wallet, {
      id: wallet.publicKey,
      displayName,
      signingPublicKey: wallet.publicKey,
      encryptionPublicKey: encPublicKey,
    });
    console.log(`[Qwalla] Wallet registered on node (${tag})`);
  } catch (e) {
    console.warn(`[Qwalla] Wallet registration failed (${tag}):`, e);
  }
}

export const useWalletStore = create<WalletState>((set, get) => ({
  hydrated: false,
  wallet: null,
  mnemonic: null,
  encPublicKey: null,
  encPrivateKey: null,
  displayName: '',
  avatarUrl: null,
  isLocked: false,
  hasPassword: false,
  sessionKey: null,
  sessionSalt: null,

  hydrate: async () => {
    const format = await getStoredFormat();

    if (format === 'none') {
      set({
        hydrated: true, wallet: null, mnemonic: null, encPublicKey: null, encPrivateKey: null,
        displayName: '', avatarUrl: null, hasPassword: false, isLocked: false,
        sessionKey: null, sessionSalt: null,
      });
      return;
    }

    if (format === 'encrypted') {
      // Keys are encrypted at rest; require the password before loading them.
      const meta = await loadWalletMeta();
      await setLockState(true);
      set({
        hydrated: true, wallet: null, mnemonic: null, encPublicKey: null, encPrivateKey: null,
        displayName: meta?.displayName ?? '', avatarUrl: meta?.avatarUrl ?? null,
        hasPassword: true, isLocked: true, sessionKey: null, sessionSalt: null,
      });
      return;
    }

    // Legacy plaintext wallet (no password set yet) — load it unlocked.
    const bundle = await loadLegacyBundle();
    if (!bundle) {
      set({ hydrated: true, wallet: null, hasPassword: false, isLocked: false });
      return;
    }
    const wallet = Wallet.fromKeys(bundle.publicKey, bundle.privateKey);
    set({
      hydrated: true, wallet, mnemonic: bundle.mnemonic ?? null,
      encPublicKey: bundle.encPublicKey, encPrivateKey: bundle.encPrivateKey,
      displayName: bundle.displayName, avatarUrl: bundle.avatarUrl ?? null,
      hasPassword: false, isLocked: false, sessionKey: null, sessionSalt: null,
    });
    await setLockState(false);
    void registerPushNotifications(wallet);
    void registerOnNode(wallet, bundle.displayName, bundle.encPublicKey, 're-register');
  },

  createWallet: async (displayName: string) => {
    assertNativeWallet();
    const wallet = Wallet.generate();
    const kem = ml_kem768.keygen();
    const encPublicKey = bytesToHex(kem.publicKey);
    const encPrivateKey = bytesToHex(kem.secretKey);
    const bundle: StoredWalletBundle = {
      publicKey: wallet.publicKey,
      privateKey: wallet.privateKey,
      encPublicKey,
      encPrivateKey,
      displayName,
      mnemonic: wallet.mnemonic,
    };
    // Persisted in plaintext (Keychain-protected) until the user sets a
    // password in the next step, which encrypts it. See setPassword.
    await saveLegacyBundle(bundle);
    set({ wallet, mnemonic: wallet.mnemonic ?? null, encPublicKey, encPrivateKey, displayName, isLocked: false, hasPassword: false, sessionKey: null, sessionSalt: null });
    void registerPushNotifications(wallet);
    void registerOnNode(wallet, displayName, encPublicKey, 'create');
  },

  importWallet: async (publicKey: string, privateKey: string, displayName: string) => {
    assertNativeWallet();
    const wallet = Wallet.fromKeys(publicKey.trim(), privateKey.trim());
    if (!wallet.verify()) {
      throw new Error('Invalid key pair');
    }
    const kem = ml_kem768.keygen();
    const encPublicKey = bytesToHex(kem.publicKey);
    const encPrivateKey = bytesToHex(kem.secretKey);
    const bundle: StoredWalletBundle = {
      publicKey: wallet.publicKey,
      privateKey: wallet.privateKey,
      encPublicKey,
      encPrivateKey,
      displayName,
    };
    await saveLegacyBundle(bundle);
    set({ wallet, mnemonic: null, encPublicKey, encPrivateKey, displayName, isLocked: false, hasPassword: false, sessionKey: null, sessionSalt: null });
    void registerPushNotifications(wallet);
    void registerOnNode(wallet, displayName, encPublicKey, 'import');
  },

  importFromBackup: async (payload) => {
    assertNativeWallet();
    const wallet = Wallet.fromKeys(payload.publicKey.trim(), payload.privateKey.trim());
    const hasEncKeys = payload.encPublicKey && payload.encPrivateKey;
    let encPublicKey: string;
    let encPrivateKey: string;
    if (hasEncKeys) {
      encPublicKey = payload.encPublicKey!;
      encPrivateKey = payload.encPrivateKey!;
    } else {
      const kem = ml_kem768.keygen();
      encPublicKey = bytesToHex(kem.publicKey);
      encPrivateKey = bytesToHex(kem.secretKey);
    }
    const displayName = payload.displayName || 'Restored';
    const bundle: StoredWalletBundle = {
      publicKey: wallet.publicKey,
      privateKey: wallet.privateKey,
      encPublicKey,
      encPrivateKey,
      displayName,
      mnemonic: payload.mnemonic,
    };
    await saveLegacyBundle(bundle);
    set({ wallet, mnemonic: payload.mnemonic ?? null, encPublicKey, encPrivateKey, displayName, isLocked: false, hasPassword: false, sessionKey: null, sessionSalt: null });
    void registerPushNotifications(wallet);
    void registerOnNode(wallet, displayName, encPublicKey, 'backup');
  },

  importFromMnemonic: async (mnemonic: string, displayName: string) => {
    assertNativeWallet();
    const phrase = mnemonic.trim().toLowerCase();
    if (!validateMnemonic(phrase)) {
      throw new Error('Invalid recovery phrase');
    }
    const wallet = Wallet.fromMnemonic(phrase);
    const kem = ml_kem768.keygen();
    const encPublicKey = bytesToHex(kem.publicKey);
    const encPrivateKey = bytesToHex(kem.secretKey);
    const bundle: StoredWalletBundle = {
      publicKey: wallet.publicKey,
      privateKey: wallet.privateKey,
      encPublicKey,
      encPrivateKey,
      displayName,
      mnemonic: phrase,
    };
    await saveLegacyBundle(bundle);
    set({ wallet, mnemonic: phrase, encPublicKey, encPrivateKey, displayName, isLocked: false, hasPassword: false, sessionKey: null, sessionSalt: null });
    void registerPushNotifications(wallet);
    void registerOnNode(wallet, displayName, encPublicKey, 'mnemonic');
  },

  logout: async () => {
    const w = get().wallet;
    if (w) void unregisterPushNotifications(w);
    emitDappEvent('accountsChanged', []);
    emitDappEvent('disconnect', {});
    await clearWalletBundle();
    await setLockState(false);
    set({ wallet: null, mnemonic: null, encPublicKey: null, encPrivateKey: null, displayName: '', avatarUrl: null, isLocked: false, hasPassword: false, sessionKey: null, sessionSalt: null });
  },

  setDisplayName: async (name: string) => {
    const s = get();
    const bundle = bundleFromState({ ...s, displayName: name });
    if (!bundle) return;
    if (s.sessionKey && s.sessionSalt) {
      await resaveWallet(bundle, s.sessionKey, s.sessionSalt);
    } else {
      await saveLegacyBundle(bundle);
    }
    set({ displayName: name });
    void registerOnNode(s.wallet!, name, bundle.encPublicKey, 'rename');
  },

  setAvatar: async (url: string | null) => {
    const s = get();
    const bundle = bundleFromState({ ...s, avatarUrl: url });
    if (!bundle) return;
    if (s.sessionKey && s.sessionSalt) {
      await resaveWallet(bundle, s.sessionKey, s.sessionSalt);
    } else {
      await saveLegacyBundle(bundle);
    }
    set({ avatarUrl: url });
  },

  // Set or change the wallet password: (re-)encrypt the bundle at rest under a
  // fresh key derived from the password, and hold the key in memory for the
  // session so profile edits can re-save without re-prompting.
  setPassword: async (password: string) => {
    const s = get();
    const bundle = bundleFromState(s);
    if (!bundle) throw new Error('No wallet loaded');
    const { key, salt } = await encryptAndSaveWallet(bundle, password);
    await setLockState(false);
    set({ hasPassword: true, sessionKey: key, sessionSalt: salt });
  },

  lock: async () => {
    if (!get().hasPassword) return;
    await setLockState(true);
    set({
      wallet: null,
      mnemonic: null,
      encPublicKey: null,
      encPrivateKey: null,
      isLocked: true,
      sessionKey: null,
      sessionSalt: null,
    });
  },

  unlock: async (password: string) => {
    const result = await unlockWallet(password);
    if (!result) return false;
    const { bundle, key, salt } = result;

    const wallet = Wallet.fromKeys(bundle.publicKey, bundle.privateKey);
    await setLockState(false);
    set({
      wallet,
      mnemonic: bundle.mnemonic ?? null,
      encPublicKey: bundle.encPublicKey,
      encPrivateKey: bundle.encPrivateKey,
      displayName: bundle.displayName,
      avatarUrl: bundle.avatarUrl ?? null,
      isLocked: false,
      hasPassword: true,
      sessionKey: key,
      sessionSalt: salt,
    });
    void registerPushNotifications(wallet);
    void registerOnNode(wallet, bundle.displayName, bundle.encPublicKey, 'unlock');
    return true;
  },
}));
