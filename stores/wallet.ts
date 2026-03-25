import { create } from 'zustand';

import { Wallet, bytesToHex, validateMnemonic } from '@rougechain/sdk';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';

import { registerPushNotifications, unregisterPushNotifications } from '@/lib/push';
import { rc } from '@/lib/rougechain';
import { clearWalletBundle, loadWalletBundle, saveWalletBundle, type StoredWalletBundle } from '@/lib/secure-store';

type WalletState = {
  hydrated: boolean;
  wallet: Wallet | null;
  mnemonic: string | null;
  encPublicKey: string | null;
  encPrivateKey: string | null;
  displayName: string;
  avatarUrl: string | null;
  hydrate: () => Promise<void>;
  createWallet: (displayName: string) => Promise<void>;
  importWallet: (publicKey: string, privateKey: string, displayName: string) => Promise<void>;
  importFromMnemonic: (mnemonic: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  setDisplayName: (name: string) => Promise<void>;
  setAvatar: (url: string | null) => Promise<void>;
};

export const useWalletStore = create<WalletState>((set, get) => ({
  hydrated: false,
  wallet: null,
  mnemonic: null,
  encPublicKey: null,
  encPrivateKey: null,
  displayName: '',
  avatarUrl: null,

  hydrate: async () => {
    const bundle = await loadWalletBundle();
    if (!bundle) {
      set({ hydrated: true, wallet: null, mnemonic: null, encPublicKey: null, encPrivateKey: null, displayName: '', avatarUrl: null });
      return;
    }
    const wallet = Wallet.fromKeys(bundle.publicKey, bundle.privateKey);
    set({
      hydrated: true,
      wallet,
      mnemonic: bundle.mnemonic ?? null,
      encPublicKey: bundle.encPublicKey,
      encPrivateKey: bundle.encPrivateKey,
      displayName: bundle.displayName,
      avatarUrl: bundle.avatarUrl ?? null,
    });
    void registerPushNotifications(wallet.publicKey);
  },

  createWallet: async (displayName: string) => {
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
    await saveWalletBundle(bundle);
    set({ wallet, mnemonic: wallet.mnemonic ?? null, encPublicKey, encPrivateKey, displayName });
    void registerPushNotifications(wallet.publicKey);
    try {
      await rc.messenger.registerWallet({
        id: wallet.publicKey,
        displayName,
        signingPublicKey: wallet.publicKey,
        encryptionPublicKey: encPublicKey,
      });
    } catch {
      /* messenger optional at signup */
    }
  },

  importWallet: async (publicKey: string, privateKey: string, displayName: string) => {
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
    await saveWalletBundle(bundle);
    set({ wallet, mnemonic: null, encPublicKey, encPrivateKey, displayName });
    void registerPushNotifications(wallet.publicKey);
    try {
      await rc.messenger.registerWallet({
        id: wallet.publicKey,
        displayName,
        signingPublicKey: wallet.publicKey,
        encryptionPublicKey: encPublicKey,
      });
    } catch {
      /* optional */
    }
  },

  importFromMnemonic: async (mnemonic: string, displayName: string) => {
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
    await saveWalletBundle(bundle);
    set({ wallet, mnemonic: phrase, encPublicKey, encPrivateKey, displayName });
    void registerPushNotifications(wallet.publicKey);
    try {
      await rc.messenger.registerWallet({
        id: wallet.publicKey,
        displayName,
        signingPublicKey: wallet.publicKey,
        encryptionPublicKey: encPublicKey,
      });
    } catch {
      /* optional */
    }
  },

  logout: async () => {
    const w = get().wallet;
    if (w) void unregisterPushNotifications(w.publicKey);
    await clearWalletBundle();
    set({ wallet: null, mnemonic: null, encPublicKey: null, encPrivateKey: null, displayName: '', avatarUrl: null });
  },

  setDisplayName: async (name: string) => {
    const w = get().wallet;
    const enc = get().encPublicKey;
    if (!w || !enc) return;
    const bundle: StoredWalletBundle = {
      publicKey: w.publicKey,
      privateKey: w.privateKey,
      encPublicKey: enc,
      encPrivateKey: get().encPrivateKey!,
      displayName: name,
      mnemonic: get().mnemonic ?? undefined,
    };
    await saveWalletBundle(bundle);
    set({ displayName: name });
    try {
      await rc.messenger.registerWallet({
        id: w.publicKey,
        displayName: name,
        signingPublicKey: w.publicKey,
        encryptionPublicKey: enc,
      });
    } catch {
      /* optional */
    }
  },

  setAvatar: async (url: string | null) => {
    const w = get().wallet;
    if (!w) return;
    const bundle: StoredWalletBundle = {
      publicKey: w.publicKey,
      privateKey: w.privateKey,
      encPublicKey: get().encPublicKey!,
      encPrivateKey: get().encPrivateKey!,
      displayName: get().displayName,
      mnemonic: get().mnemonic ?? undefined,
      avatarUrl: url ?? undefined,
    };
    await saveWalletBundle(bundle);
    set({ avatarUrl: url });
  },
}));
