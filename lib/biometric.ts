/**
 * Biometric unlock (Face ID / Touch ID / Fingerprint).
 *
 * The wallet bundle is AES-encrypted at rest under a PBKDF2 key derived from the
 * user's password, which is never persisted. To let biometrics unlock without
 * re-typing it, we stash the password in a *biometric-gated* Keychain/Keystore
 * item: reading it back requires a successful Face ID/Touch ID match. A separate
 * plaintext flag lets us know biometrics are enabled without triggering a prompt.
 *
 * Security note: the password only ever lives behind the OS secure enclave with
 * `requireAuthentication`, and is device-local. Turning biometrics off, logging
 * out, or a wrong match all fall back to the existing password entry.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const BIO_PW_KEY = 'qwalla_bio_pw_v1'; // password — biometric-gated
const BIO_FLAG_KEY = 'qwalla_bio_enabled_v1'; // plaintext on/off flag (no prompt)
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
 * Persist `password` behind a biometric-gated Keychain item so a later Face ID/
 * Touch ID match can retrieve it and unlock. The caller must have already
 * verified the password decrypts the wallet.
 */
export async function enableBiometricUnlock(password: string): Promise<void> {
  if (!BIOMETRICS_SUPPORTED) throw new Error('Biometrics are unavailable on this platform.');
  await SecureStore.setItemAsync(BIO_PW_KEY, password, {
    keychainService: KEYCHAIN_SERVICE,
    requireAuthentication: true,
  });
  await SecureStore.setItemAsync(BIO_FLAG_KEY, '1');
}

/** Turn biometric unlock off: drop the stored credential and the flag. */
export async function disableBiometricUnlock(): Promise<void> {
  if (!BIOMETRICS_SUPPORTED) return;
  try {
    await SecureStore.deleteItemAsync(BIO_PW_KEY, { keychainService: KEYCHAIN_SERVICE });
  } catch {
    /* item may not exist */
  }
  try {
    await SecureStore.deleteItemAsync(BIO_FLAG_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Prompt for biometrics and, on success, return the stored wallet password.
 * Returns null if biometrics are disabled, the prompt is cancelled, no match, or
 * the credential was invalidated (e.g. the user changed their enrolled fingers).
 */
export async function getBiometricPassword(promptMessage: string): Promise<string | null> {
  if (!(await isBiometricEnabled())) return null;
  try {
    // Reading a requireAuthentication item triggers the system biometric prompt.
    const pw = await SecureStore.getItemAsync(BIO_PW_KEY, {
      keychainService: KEYCHAIN_SERVICE,
      requireAuthentication: true,
      authenticationPrompt: promptMessage,
    });
    return pw ?? null;
  } catch {
    return null;
  }
}
