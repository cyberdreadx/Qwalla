/**
 * Encrypted wallet backup using Web Crypto API.
 * PBKDF2 (600k iterations) + AES-256-GCM — same scheme as qRougee & quantum-vault.
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

interface EncryptedBackup {
  version: 1;
  salt: string;   // hex
  iv: string;     // hex
  ciphertext: string; // hex
  pubkey: string; // plaintext public key for identification
}

function hexEncode(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexDecode(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations = 600_000): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface BackupPayload {
  publicKey: string;
  privateKey: string;
  encPublicKey?: string;
  encPrivateKey?: string;
  mnemonic?: string;
  displayName?: string;
}

/**
 * Encrypt wallet data and export as a .pqcbackup file.
 * On native: writes to cache dir then opens the share sheet.
 * On web: triggers a download via an anchor tag.
 */
export async function exportEncryptedBackup(
  payload: BackupPayload,
  passphrase: string,
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);

  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

  const backup: EncryptedBackup = {
    version: 1,
    salt: hexEncode(salt.buffer as ArrayBuffer),
    iv: hexEncode(iv.buffer as ArrayBuffer),
    ciphertext: hexEncode(ciphertext),
    pubkey: payload.publicKey,
  };

  const json = JSON.stringify(backup, null, 2);
  const fileName = `qwalla-backup-${payload.publicKey.slice(0, 8)}-${Date.now()}.pqcbackup`;

  if (Platform.OS === 'web') {
    const blob = new Blob([json], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  } else {
    // Native: write to cache then share
    const path = `${FileSystem.cacheDirectory}${fileName}`;
    await FileSystem.writeAsStringAsync(path, json, { encoding: FileSystem.EncodingType.UTF8 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, { mimeType: 'application/octet-stream', dialogTitle: 'Save encrypted backup' });
    }
  }
}

/**
 * Decrypt a .pqcbackup file contents with a passphrase.
 * Supports two formats:
 *  1. Qwalla JSON format: { version, salt, iv, ciphertext, pubkey }
 *  2. Extension base64 format: base64( salt[16] + iv[12] + aes-gcm-ciphertext )
 * Returns the original wallet payload.
 */
export async function decryptBackup(
  raw: string,
  passphrase: string,
): Promise<BackupPayload> {
  const trimmed = raw.trim();

  // Try JSON format first (Qwalla export)
  if (trimmed.startsWith('{')) {
    const backup: EncryptedBackup = JSON.parse(trimmed);
    if (backup.version !== 1) throw new Error('Unsupported backup version');

    const salt = hexDecode(backup.salt);
    const iv = hexDecode(backup.iv);
    const ciphertext = hexDecode(backup.ciphertext);
    const key = await deriveKey(passphrase, salt);

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      key,
      ciphertext.buffer as ArrayBuffer,
    );

    return JSON.parse(new TextDecoder().decode(plaintext)) as BackupPayload;
  }

  // Extension base64 format: base64( salt[16] + iv[12] + encrypted )
  const combined = Uint8Array.from(atob(trimmed), (c) => c.charCodeAt(0));
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const encrypted = combined.slice(28);

  async function tryDecrypt(iterations: number): Promise<BackupPayload> {
    const key = await deriveKey(passphrase, salt, iterations);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      key,
      encrypted.buffer.slice(encrypted.byteOffset, encrypted.byteOffset + encrypted.byteLength),
    );
    const wallet = JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, unknown>;
    return normalizeWalletPayload(wallet);
  }

  // Try 600K iterations (current), then 100K (legacy extension vaults)
  try {
    return await tryDecrypt(600_000);
  } catch {
    return await tryDecrypt(100_000);
  }
}

/**
 * Normalize extension UnifiedWallet fields to our BackupPayload format.
 */
function normalizeWalletPayload(w: Record<string, unknown>): BackupPayload {
  return {
    publicKey:
      String(w.signingPublicKey ?? w.publicKey ?? ''),
    privateKey:
      String(w.signingPrivateKey ?? w.privateKey ?? ''),
    encPublicKey:
      String(w.encryptionPublicKey ?? w.encPublicKey ?? ''),
    encPrivateKey:
      String(w.encryptionPrivateKey ?? w.encPrivateKey ?? ''),
    mnemonic: w.mnemonic ? String(w.mnemonic) : undefined,
    displayName: w.displayName ? String(w.displayName) : undefined,
  };
}
