/**
 * Biometric unlock (Face ID / Touch ID / Fingerprint).
 *
 * The wallet bundle is AES-encrypted at rest under a PBKDF2 key derived from the
 * user's password. Deriving that key costs ~200k PBKDF2 iterations (seconds on a
 * phone), so instead of stashing the password and re-deriving on every unlock, we
 * stash the *already-derived AES key* in a biometric-gated Keychain/Keystore item.
 * A Face ID/Touch ID match returns the key and we decrypt directly — no PBKDF2, so
 * biometric unlock is near-instant. A separate plaintext flag lets us know
 * biometrics are enabled without triggering a prompt.
 *
 * Security note: the key only ever lives behind the OS secure enclave with
 * `requireAuthentication`, and is device-local. Turning biometrics off, logging
 * out, or a wrong match all fall back to password entry (which re-derives).
 */
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// v2: was the password (v1); now the derived AES key (hex). Bumped so any beta
// entry from the password scheme is ignored and the user simply re-enables.
const BIO_KEY_KEY = 'qwalla_bio_key_v2'; // derived AES key (hex) — biometric-gated
const BIO_FLAG_KEY = 'qwalla_bio_enabled_v2'; // plaintext on/off flag (no prompt)
const KEYCHAIN_SERVICE = 'qwalla.biometric';

/** Native-only, same as the wallet itself. */
export const BIOMETRICS_SUPPORTED = Platform.OS !== 'web';

/** Hardware present AND the user has enrolled a biometric on the device. */
export async function isBiometricAvailable(): Promise<boolean> {
  if (!BIOMETRICS_SUPPORTED) return false;
  try {
    const [hasHardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hasHardware && enrolled;
  } catch {
    return false;
  }
}

/** Human label for the device's primary biometric, e.g. "Face ID". */
export async function getBiometricLabel(): Promise<string> {
  if (!BIOMETRICS_SUPPORTED) return 'Biometrics';
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      return Platform.OS === 'ios' ? 'Face ID' : 'Face Unlock';
    }
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      return Platform.OS === 'ios' ? 'Touch ID' : 'Fingerprint';
    }
    if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return 'Iris';
  } catch {
    /* fall through to generic label */
  }
  return 'Biometrics';
}

/** Whether the user turned biometric unlock on. Reads a flag — never prompts. */
export async function isBiometricEnabled(): Promise<boolean> {
  if (!BIOMETRICS_SUPPORTED) return false;
  try {
    return (await SecureStore.getItemAsync(BIO_FLAG_KEY)) === '1';
  } catch {
    return false;
  }
}

/**
 * Persist the derived AES key (hex) behind a biometric-gated Keychain item so a
 * later Face ID/Touch ID match can retrieve it and decrypt without PBKDF2. The
 * caller must have already verified this key decrypts the wallet.
 */
export async function enableBiometricUnlock(keyHex: string): Promise<void> {
  if (!BIOMETRICS_SUPPORTED) throw new Error('Biometrics are unavailable on this platform.');
  await SecureStore.setItemAsync(BIO_KEY_KEY, keyHex, {
    keychainService: KEYCHAIN_SERVICE,
    requireAuthentication: true,
  });
  await SecureStore.setItemAsync(BIO_FLAG_KEY, '1');
}

/** Turn biometric unlock off: drop the stored key and the flag. */
export async function disableBiometricUnlock(): Promise<void> {
  if (!BIOMETRICS_SUPPORTED) return;
  try {
    await SecureStore.deleteItemAsync(BIO_KEY_KEY, { keychainService: KEYCHAIN_SERVICE });
  } catch {
    /* item may not exist */
  }
  try {
    await SecureStore.deleteItemAsync(BIO_FLAG_KEY);
  } catch {
    /* ignore */
  }
}

/** Why a biometric unlock didn't return a key. */
export type BiometricFailure = 'disabled' | 'cancelled' | 'failed' | 'timeout';

export type BiometricKeyResult = { key: string } | { error: BiometricFailure };

// After repeated failed matches iOS locks biometry out, and the Keychain read
// behind `requireAuthentication` can then stay pending forever. Cap the wait so
// the lock screen never hangs; the user can retry or use their password.
const BIOMETRIC_TIMEOUT_MS = 30_000;

/**
 * Prompt for biometrics and, on success, return the stored derived AES key (hex).
 * Otherwise returns why it failed: biometrics disabled, prompt cancelled, no
 * match / locked out / invalidated credential, or the prompt never answered.
 */
export async function getBiometricKey(promptMessage: string): Promise<BiometricKeyResult> {
  if (!(await isBiometricEnabled())) return { error: 'disabled' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<BiometricKeyResult>((resolve) => {
    timer = setTimeout(() => resolve({ error: 'timeout' }), BIOMETRIC_TIMEOUT_MS);
  });
  // Reading a requireAuthentication item triggers the system biometric prompt.
  const read = SecureStore.getItemAsync(BIO_KEY_KEY, {
    keychainService: KEYCHAIN_SERVICE,
    requireAuthentication: true,
    authenticationPrompt: promptMessage,
  }).then(
    (keyHex): BiometricKeyResult => (keyHex ? { key: keyHex } : { error: 'failed' }),
    (e: unknown): BiometricKeyResult =>
      /cancel/i.test(String((e as Error)?.message ?? e)) ? { error: 'cancelled' } : { error: 'failed' },
  );
  try {
    return await Promise.race([read, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
