/**
 * Host adapters — the small set of platform services @qwalla/core needs but
 * must NOT import directly (so the core stays framework-free and runs in RN,
 * Chromium, and Node alike).
 *
 * Each host — Qwalla Mobile (React Native) and Qwalla Browser (Electron) —
 * registers concrete implementations ONCE at startup via `setHostAdapters()`;
 * core modules read them through the getters below.
 *
 *   Mobile:  storage=AsyncStorage, secureStore=expo-secure-store,
 *            crypto=react-native-quick-crypto
 *   Browser: storage=localStorage-backed, secureStore=Electron safeStorage,
 *            crypto=Node/none (noble fallback)
 */

/** Async key/value store for non-secret app data (block lists, sessions, caches). */
export interface HostStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** OS-keychain-backed secure store for wallet secrets (encrypted at rest). */
export interface HostSecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Optional native crypto fast-paths; core falls back to @noble when absent. */
export interface HostCrypto {
  /** Native PBKDF2-SHA256. Must be byte-identical to @noble; core self-checks. */
  pbkdf2Sha256?(
    password: Uint8Array,
    salt: Uint8Array,
    iterations: number,
    keyLen: number,
  ): Uint8Array;
}

export interface HostAdapters {
  storage?: HostStorage;
  secureStore?: HostSecureStore;
  crypto?: HostCrypto;
}

let registered: HostAdapters = {};

/**
 * Register host adapters. Call once at app startup (before any core storage /
 * wallet code runs). Repeated calls merge, so a host can register piecemeal.
 */
export function setHostAdapters(adapters: HostAdapters): void {
  registered = { ...registered, ...adapters };
}

export function getHostStorage(): HostStorage {
  if (!registered.storage) {
    throw new Error(
      '@qwalla/core: host storage adapter not registered — call setHostAdapters({ storage }) at startup.',
    );
  }
  return registered.storage;
}

export function getHostSecureStore(): HostSecureStore {
  if (!registered.secureStore) {
    throw new Error(
      '@qwalla/core: host secureStore adapter not registered — call setHostAdapters({ secureStore }) at startup.',
    );
  }
  return registered.secureStore;
}

/** Native crypto fast-paths, if the host provided any (else {} → use fallbacks). */
export function getHostCrypto(): HostCrypto {
  return registered.crypto ?? {};
}
