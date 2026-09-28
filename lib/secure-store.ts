import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { gcm } from '@noble/ciphers/aes.js';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { pbkdf2Sha256 } from '@qwalla/core/wallet/pbkdf2';
import { attachAvatars, extractAvatars } from '@/lib/avatar-store';

const WALLET_KEY = 'qwalla_wallet_bundle_v1';
const LOCK_STATE_KEY = 'qwalla_lock_state_v1';

/**
 * The Electron desktop shell injects an OS-keychain-backed secure store at
 * `window.qwallaSecureStore` (see desktop/preload.js). Values are encrypted at
 * rest by the OS keychain (macOS Keychain / Windows DPAPI) in the main process,
 * never in browser localStorage. `available` is false when the OS can't provide
 * encryption, in which case we treat it as absent and keep the wallet disabled.
 */
type DesktopSecureStore = {
  available: boolean;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const desktopStore: DesktopSecureStore | null =
  typeof globalThis !== 'undefined' &&
  (globalThis as { qwallaSecureStore?: DesktopSecureStore }).qwallaSecureStore?.available
    ? (globalThis as { qwallaSecureStore?: DesktopSecureStore }).qwallaSecureStore!
    : null;

/**
 * Whether this build can safely persist private keys. True on the iOS/Android
 * app (Keychain/Keystore) and in the Electron desktop app (OS keychain via
 * safeStorage). It is deliberately FALSE in a plain browser: localStorage is
 * readable by any script on the origin and by extensions, so keeping keys there
 * would be a full key-exfiltration risk via XSS. Plain-web builds route users to
 * the iOS/Android app instead (see stores/wallet.ts guards).
 */
export const WALLET_SUPPORTED = Platform.OS !== 'web' || !!desktopStore;

async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS !== 'web') return SecureStore.getItemAsync(key);
  if (desktopStore) return desktopStore.getItem(key);
  return null;
}

async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS !== 'web') {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED,
    });
    return;
  }
  if (desktopStore) {
    await desktopStore.setItem(key, value);
    return;
  }
  throw new Error('Secure storage is unavailable on web.');
}

async function secureRemove(key: string): Promise<void> {
  if (Platform.OS !== 'web') {
    await SecureStore.deleteItemAsync(key);
    return;
  }
  if (desktopStore) await desktopStore.removeItem(key);
}

// NON-DESTRUCTIVE redundant storage. The wallet record is written to EVERY slot
// it can safely live in and read from ANY of them — no write ever deletes another
// copy (only an explicit logout clears them). This makes "wallet gone" impossible
// from a single store failing/truncating/racing:
//  - Keychain (expo-secure-store): the proven primary. Small records fit; a large
//    2-account v3 blob may hit its value-size ceiling, which is why we ALSO mirror.
//  - AsyncStorage: no size limit; safe for the v3 record because it's already
//    AES-256-GCM(PBKDF2(password))-encrypted. NOT used for the plaintext legacy
//    bundle (that raw key must stay in the keychain only).
// (A previous version moved v3 to AsyncStorage and DELETED the keychain copy — if
//  AsyncStorage didn't read back, both copies were gone. Never delete on write.)
const WALLET_BACKUP_KEY = 'qwalla_wallet_bundle_backup_v1';
const WALLET_V3_ASYNC_KEY = 'qwalla_wallet_v3_v1';
// Bumped each ship so the welcome diagnostic tells us which bundle is running.
const STORAGE_BUILD_MARKER = 'heal4';

/** Recognise a raw string as a wallet record we can load (v3 / v2 / legacy). */
function isWalletRecord(raw: string | null): raw is string {
  if (!raw) return false;
  try {
    const p = JSON.parse(raw);
    if ((p?.v === 3 || p?.v === 2) && p.ct) return true;
    return !!p?.privateKey;
  } catch {
    return false;
  }
}

function isV3(raw: string): boolean {
  try {
    return JSON.parse(raw)?.v === 3;
  } catch {
    return false;
  }
}

async function asyncGet(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function safeSecureGet(key: string): Promise<string | null> {
  try {
    return await secureGet(key);
  } catch {
    return null;
  }
}

/**
 * Persist the wallet record to every safe slot, non-destructively. The v3
 * (encrypted) record also goes to AsyncStorage so a keychain size limit can't
 * lose it; the plaintext legacy bundle is keychain-only. At least one write
 * succeeding is enough for the record to survive.
 */
async function writeWalletRecord(value: string): Promise<void> {
  let wrote = false;
  try {
    await secureSet(WALLET_KEY, value);
    wrote = true;
  } catch {
    /* keychain may reject an oversized value — the AsyncStorage mirror covers it */
  }
  try {
    await secureSet(WALLET_BACKUP_KEY, value);
    wrote = true;
  } catch {
    /* best-effort */
  }
  if (isV3(value)) {
    // Encrypted blob — safe outside the keychain, and not size-limited there.
    try {
      await AsyncStorage.setItem(WALLET_V3_ASYNC_KEY, value);
      wrote = true;
    } catch {
      /* best-effort */
    }
  }
  if (!wrote) throw new Error('Could not save the wallet to secure storage.');
}

/**
 * Read the wallet record from ANY slot that holds a valid copy: keychain first
 * (with one retry for the reload-race), then its backup, then the AsyncStorage v3
 * mirror. Returns null only when no valid record exists anywhere.
 */
async function readWalletRecord(): Promise<string | null> {
  // Try every slot, and RETRY with backoff before ever concluding "no wallet".
  // After an OTA reload, AsyncStorage/keychain can be briefly unready and return
  // empty on the first read — treating that as "no wallet" wrongly dropped users
  // on onboarding even though the data was present (confirmed via diagnostic).
  // Prefer the AsyncStorage v3 mirror (can't truncate) over a keychain copy a
  // size limit may have cut short.
  const delays = [0, 120, 300];
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
    const v3 = await asyncGet(WALLET_V3_ASYNC_KEY);
    if (isWalletRecord(v3)) return v3;
    const primary = await safeSecureGet(WALLET_KEY);
    if (isWalletRecord(primary)) return primary;
    const backup = await safeSecureGet(WALLET_BACKUP_KEY);
    if (isWalletRecord(backup)) return backup;
  }
  return null;
}

export type StoredWalletBundle = {
  publicKey: string;
  privateKey: string;
  encPublicKey: string;
  encPrivateKey: string;
  displayName: string;
  mnemonic?: string;
  avatarUrl?: string;
};

/** Non-secret fields shown on the lock screen without decrypting. */
export type WalletMeta = {
  publicKey: string;
  displayName: string;
  avatarUrl?: string;
};

/** On-disk record when the wallet is protected by a password. */
type EncryptedRecord = {
  v: 2;
  salt: string; // hex — PBKDF2 salt
  iv: string; // hex — AES-GCM nonce
  ct: string; // hex — AES-256-GCM(JSON(bundle))
  meta: WalletMeta;
};

export type StoredFormat = 'none' | 'encrypted' | 'legacy';

const PBKDF2_ITERATIONS = 200_000;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * PBKDF2-HMAC-SHA-256 → 32-byte AES key.
 *
 * Delegates to the shared native-first PBKDF2 (see lib/pbkdf2): it runs via
 * react-native-quick-crypto's C++/JSI pbkdf2Sync when available — the 200k
 * iterations finish in ~100ms instead of blocking Hermes' JS thread for tens of
 * seconds on Android (a pure-JS derivation there stayed stuck on "Unlocking…").
 * The native path is used only after a startup self-check confirms it is
 * byte-identical to the noble JS reference, so existing wallets always stay
 * decryptable; otherwise it falls back to pure-JS noble.
 *
 * Iterations MUST stay at PBKDF2_ITERATIONS — the count is not stored in the
 * encrypted record, so changing it would make every existing wallet undecryptable.
 * Returns a Promise so callers (which `await`) don't change.
 */
export function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return Promise.resolve(pbkdf2Sha256(password, salt, PBKDF2_ITERATIONS, 32));
}

function metaOf(bundle: StoredWalletBundle): WalletMeta {
  return {
    publicKey: bundle.publicKey,
    displayName: bundle.displayName,
    avatarUrl: bundle.avatarUrl,
  };
}

function writeEncrypted(bundle: StoredWalletBundle, key: Uint8Array, salt: Uint8Array): string {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(bundle));
  const ct = gcm(key, iv).encrypt(pt);
  const record: EncryptedRecord = {
    v: 2,
    salt: toHex(salt),
    iv: toHex(iv),
    ct: toHex(ct),
    meta: metaOf(bundle),
  };
  return JSON.stringify(record);
}

/**
 * Encrypt the bundle under a fresh salt derived from `password` and persist it.
 * Returns the derived key + salt so the caller can hold them in memory for the
 * session (to re-save on profile edits without re-prompting for the password).
 */
export async function encryptAndSaveWallet(
  bundle: StoredWalletBundle,
  password: string,
): Promise<{ key: Uint8Array; salt: Uint8Array }> {
  if (!WALLET_SUPPORTED) {
    throw new Error('The Qwalla wallet is available in the iOS and Android app.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  await secureSet(WALLET_KEY, writeEncrypted(bundle, key, salt));
  return { key, salt };
}

/** Re-encrypt with the session key/salt already in memory (profile edits). */
export async function resaveWallet(
  bundle: StoredWalletBundle,
  key: Uint8Array,
  salt: Uint8Array,
): Promise<void> {
  if (!WALLET_SUPPORTED) return;
  await secureSet(WALLET_KEY, writeEncrypted(bundle, key, salt));
}

/**
 * Attempt to decrypt the stored wallet with `password`. Returns null when
 * there is no encrypted wallet or the password is wrong (GCM tag mismatch).
 */
export async function unlockWallet(
  password: string,
): Promise<{ bundle: StoredWalletBundle; key: Uint8Array; salt: Uint8Array } | null> {
  const raw = await readWalletRecord();
  if (!raw) return null;
  let record: EncryptedRecord;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v !== 2 || !parsed.ct) return null;
    record = parsed as EncryptedRecord;
  } catch {
    return null;
  }
  const salt = fromHex(record.salt);
  const key = await deriveKey(password, salt);
  try {
    const pt = gcm(key, fromHex(record.iv)).decrypt(fromHex(record.ct));
    const bundle = JSON.parse(new TextDecoder().decode(pt)) as StoredWalletBundle;
    return { bundle, key, salt };
  } catch {
    return null; // wrong password or corrupt record
  }
}

/**
 * Decrypt the stored wallet with an already-derived AES key (hex), skipping the
 * expensive PBKDF2 step. Used by biometric unlock, which stashes the derived key
 * behind the OS secure enclave so Face ID/Touch ID can decrypt near-instantly.
 * Returns null on any mismatch (stale key, corrupt record, or no wallet).
 */
export async function unlockWalletWithKey(
  keyHex: string,
): Promise<{ bundle: StoredWalletBundle; key: Uint8Array; salt: Uint8Array } | null> {
  const raw = await readWalletRecord();
  if (!raw) return null;
  let record: EncryptedRecord;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v !== 2 || !parsed.ct) return null;
    record = parsed as EncryptedRecord;
  } catch {
    return null;
  }
  try {
    const key = fromHex(keyHex);
    const pt = gcm(key, fromHex(record.iv)).decrypt(fromHex(record.ct));
    const bundle = JSON.parse(new TextDecoder().decode(pt)) as StoredWalletBundle;
    return { bundle, key, salt: fromHex(record.salt) };
  } catch {
    return null; // stale key or corrupt record — caller falls back to password
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Multi-account (v3)
//
// All accounts live in ONE encrypted record under a single shared password:
// AES-256-GCM(JSON({ accounts: bundle[], activeId })). Unlock decrypts the whole
// blob once, so switching accounts is instant (no re-derive, no re-prompt).
// Backward compatible: unlock/meta transparently read the old single-bundle v2
// (and legacy plaintext) as a one-account list, so existing wallets keep working
// and only migrate to v3 on the next save.

export type AccountsPayload = {
  accounts: StoredWalletBundle[];
  /** publicKey of the active account. */
  activeId: string;
};

type AccountsRecord = {
  v: 3;
  salt: string;
  iv: string;
  ct: string; // AES-256-GCM(JSON(AccountsPayload))
  metas: WalletMeta[]; // readable without the password (account switcher / lock screen)
  activeId: string;
};

export type AccountsMeta = { metas: WalletMeta[]; activeId: string };

function writeAccountsRecord(payload: AccountsPayload, key: Uint8Array, salt: Uint8Array): string {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(payload));
  const ct = gcm(key, iv).encrypt(pt);
  const record: AccountsRecord = {
    v: 3,
    salt: toHex(salt),
    iv: toHex(iv),
    ct: toHex(ct),
    metas: payload.accounts.map(metaOf),
    activeId: payload.activeId,
  };
  return JSON.stringify(record);
}

function decodeAccountsPayload(record: { iv: string; ct: string }, key: Uint8Array): AccountsPayload | null {
  try {
    const pt = gcm(key, fromHex(record.iv)).decrypt(fromHex(record.ct));
    const payload = JSON.parse(new TextDecoder().decode(pt)) as AccountsPayload;
    if (Array.isArray(payload.accounts) && payload.accounts.length > 0 && payload.activeId) return payload;
    return null;
  } catch {
    return null;
  }
}

/** Encrypt + persist all accounts under a fresh salt derived from `password`. */
export async function encryptAndSaveAccounts(
  payload: AccountsPayload,
  password: string,
): Promise<{ key: Uint8Array; salt: Uint8Array }> {
  if (!WALLET_SUPPORTED) {
    throw new Error('The Qwalla wallet is available in the iOS and Android app.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  // Avatars (large base64) go to AsyncStorage; the secure-store record stays small.
  const accounts = await extractAvatars(payload.accounts);
  await writeWalletRecord(writeAccountsRecord({ accounts, activeId: payload.activeId }, key, salt));
  return { key, salt };
}

/** Re-encrypt the accounts blob with the session key/salt already in memory. */
export async function resaveAccounts(
  payload: AccountsPayload,
  key: Uint8Array,
  salt: Uint8Array,
): Promise<void> {
  if (!WALLET_SUPPORTED) return;
  const accounts = await extractAvatars(payload.accounts);
  await writeWalletRecord(writeAccountsRecord({ accounts, activeId: payload.activeId }, key, salt));
}

/** Decrypt all accounts with `password` (reads v3, or migrates v2 single). */
export async function unlockAccounts(
  password: string,
): Promise<{ payload: AccountsPayload; key: Uint8Array; salt: Uint8Array } | null> {
  const raw = await readWalletRecord();
  if (!raw) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed?.v === 3 && parsed.ct) {
    const salt = fromHex(parsed.salt as string);
    const key = await deriveKey(password, salt);
    const payload = decodeAccountsPayload(parsed as { iv: string; ct: string }, key);
    if (!payload) return null;
    return { payload: { ...payload, accounts: await attachAvatars(payload.accounts) }, key, salt };
  }
  // Migrate a single encrypted (v2) wallet → one-account list.
  if (parsed?.v === 2 && parsed.ct) {
    const salt = fromHex(parsed.salt as string);
    const key = await deriveKey(password, salt);
    try {
      const pt = gcm(key, fromHex(parsed.iv as string)).decrypt(fromHex(parsed.ct as string));
      const bundle = JSON.parse(new TextDecoder().decode(pt)) as StoredWalletBundle;
      const [withAvatar] = await attachAvatars([bundle]);
      return { payload: { accounts: [withAvatar], activeId: bundle.publicKey }, key, salt };
    } catch {
      return null;
    }
  }
  return null;
}

/** Decrypt all accounts with an already-derived key (biometric path). */
export async function unlockAccountsWithKey(
  keyHex: string,
): Promise<{ payload: AccountsPayload; key: Uint8Array; salt: Uint8Array } | null> {
  const raw = await readWalletRecord();
  if (!raw) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const key = fromHex(keyHex);
  if (parsed?.v === 3 && parsed.ct) {
    const payload = decodeAccountsPayload(parsed as { iv: string; ct: string }, key);
    if (!payload) return null;
    return {
      payload: { ...payload, accounts: await attachAvatars(payload.accounts) },
      key,
      salt: fromHex(parsed.salt as string),
    };
  }
  if (parsed?.v === 2 && parsed.ct) {
    try {
      const pt = gcm(key, fromHex(parsed.iv as string)).decrypt(fromHex(parsed.ct as string));
      const bundle = JSON.parse(new TextDecoder().decode(pt)) as StoredWalletBundle;
      const [withAvatar] = await attachAvatars([bundle]);
      return { payload: { accounts: [withAvatar], activeId: bundle.publicKey }, key, salt: fromHex(parsed.salt as string) };
    } catch {
      return null;
    }
  }
  return null;
}

/** Account metadata (all accounts + which is active) without the password. */
export async function loadAccountsMeta(): Promise<AccountsMeta | null> {
  const raw = await readWalletRecord();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v === 3 && Array.isArray(parsed.metas)) {
      const metas = await attachAvatars(parsed.metas as WalletMeta[]);
      return { metas, activeId: String(parsed.activeId ?? '') };
    }
    if (parsed?.v === 2 && parsed.meta) {
      const [m] = await attachAvatars([parsed.meta as WalletMeta]);
      return { metas: [m], activeId: m.publicKey };
    }
    if (parsed?.privateKey) {
      const b = parsed as StoredWalletBundle;
      const [m] = await attachAvatars([{ publicKey: b.publicKey, displayName: b.displayName, avatarUrl: b.avatarUrl }]);
      return { metas: [m], activeId: b.publicKey };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** What kind of wallet (if any) is currently stored. */
export async function getStoredFormat(): Promise<StoredFormat> {
  const raw = await readWalletRecord();
  if (!raw) return 'none';
  try {
    const parsed = JSON.parse(raw);
    if ((parsed?.v === 3 || parsed?.v === 2) && parsed.ct) return 'encrypted';
    if (parsed?.privateKey) return 'legacy';
  } catch {
    /* fall through */
  }
  return 'none';
}

/** Lock-screen metadata (name/avatar) available without the password. */
export async function loadWalletMeta(): Promise<WalletMeta | null> {
  const raw = await readWalletRecord();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v === 2 && parsed.meta) {
      const [m] = await attachAvatars([parsed.meta as WalletMeta]);
      return m;
    }
    if (parsed?.privateKey) {
      const b = parsed as StoredWalletBundle;
      const [m] = await attachAvatars([{ publicKey: b.publicKey, displayName: b.displayName, avatarUrl: b.avatarUrl }]);
      return m;
    }
  } catch {
    /* fall through */
  }
  return null;
}

// --- Legacy (pre-password) plaintext bundle ---
//
// Freshly created/imported wallets are stored in plaintext (still protected at
// rest by the OS Keychain/Keystore) until the user sets a password, at which
// point encryptAndSaveWallet overwrites this with an encrypted record. This
// also keeps wallets from installs made before password-encryption readable.

export async function saveLegacyBundle(bundle: StoredWalletBundle): Promise<void> {
  if (!WALLET_SUPPORTED) {
    throw new Error('The Qwalla wallet is available in the iOS and Android app.');
  }
  // Keep the base64 avatar out of the (size-limited) secure-store record.
  const [clean] = await extractAvatars([bundle]);
  await writeWalletRecord(JSON.stringify(clean));
}

export async function loadLegacyBundle(): Promise<StoredWalletBundle | null> {
  const raw = await readWalletRecord();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.privateKey) {
      const [withAvatar] = await attachAvatars([parsed as StoredWalletBundle]);
      return withAvatar;
    }
  } catch {
    /* not a legacy bundle */
  }
  return null;
}

export async function clearWalletBundle(): Promise<void> {
  await secureRemove(WALLET_KEY);
  await secureRemove(WALLET_BACKUP_KEY);
  try {
    await AsyncStorage.removeItem(WALLET_V3_ASYNC_KEY);
  } catch {
    /* best-effort */
  }
}

/**
 * Diagnostic snapshot of every wallet-storage slot — length + detected format,
 * never the secret contents. Surfaced on the welcome screen while chasing the
 * "wallet gone on restart" bug so we can see whether the record is truly absent,
 * present-but-unreadable (truncated), or in a slot the reader missed.
 */
export async function debugWalletStorage(): Promise<string> {
  const describe = (raw: string | null): string => {
    if (raw == null) return 'empty';
    let fmt = 'other';
    try {
      const p = JSON.parse(raw);
      fmt = p?.v === 3 ? 'v3' : p?.v === 2 ? 'v2' : p?.privateKey ? 'legacy' : 'other';
    } catch {
      fmt = 'UNPARSEABLE';
    }
    return `${raw.length}b ${fmt}${isWalletRecord(raw) ? '' : ' (invalid)'}`;
  };
  const [k, kb, a] = await Promise.all([
    safeSecureGet(WALLET_KEY),
    safeSecureGet(WALLET_BACKUP_KEY),
    asyncGet(WALLET_V3_ASYNC_KEY),
  ]);
  // Run the actual boot-path functions so we can see whether they resolve the
  // wallet when called here (vs at hydrate). Distinguishes logic bug from timing.
  let fmt = '?';
  let rec = '?';
  try {
    fmt = await getStoredFormat();
  } catch (e) {
    fmt = `err:${String(e)}`;
  }
  try {
    const r = await readWalletRecord();
    rec = r ? describe(r) : 'null';
  } catch (e) {
    rec = `err:${String(e)}`;
  }
  return [
    `keychain:     ${describe(k)}`,
    `keychain.bak: ${describe(kb)}`,
    `async.v3:     ${describe(a)}`,
    `getStoredFormat: ${fmt}`,
    `readWalletRecord: ${rec}`,
    `supported: ${WALLET_SUPPORTED} · platform: ${Platform.OS}`,
    `build: ${STORAGE_BUILD_MARKER}`,
  ].join('\n');
}

// --- Message-cache encryption key ---
//
// A random 32-byte key held in OS secure storage (Keychain/Keystore/desktop
// keychain), used to encrypt the on-device message cache at rest so decrypted
// message text never lands in plaintext AsyncStorage. Only available where
// secure storage exists (i.e. wherever the wallet runs) — null elsewhere, which
// disables caching. Memoised to avoid repeated keychain reads.

const MSG_CACHE_KEY_ID = 'qwalla_msg_cache_key_v1';
let cacheKeyHex: string | null | undefined;

export async function getMessageCacheKey(): Promise<string | null> {
  if (cacheKeyHex !== undefined) return cacheKeyHex;
  if (!WALLET_SUPPORTED) {
    cacheKeyHex = null;
    return null;
  }
  try {
    let hex = await secureGet(MSG_CACHE_KEY_ID);
    if (!hex) {
      hex = toHex(crypto.getRandomValues(new Uint8Array(32)));
      await secureSet(MSG_CACHE_KEY_ID, hex);
    }
    cacheKeyHex = hex;
  } catch {
    cacheKeyHex = null;
  }
  return cacheKeyHex;
}

// --- Lock state persistence ---

export async function setLockState(locked: boolean): Promise<void> {
  if (!WALLET_SUPPORTED) return;
  if (locked) {
    await secureSet(LOCK_STATE_KEY, 'locked');
  } else {
    await secureRemove(LOCK_STATE_KEY);
  }
}

export async function getLockState(): Promise<boolean> {
  const val = await secureGet(LOCK_STATE_KEY);
  return val === 'locked';
}
