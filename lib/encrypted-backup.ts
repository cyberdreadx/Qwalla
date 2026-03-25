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

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
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
      iterations: 600_000,
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
 * Returns the original wallet payload.
 */
export async function decryptBackup(
  encryptedJson: string,
  passphrase: string,
): Promise<BackupPayload> {
  const backup: EncryptedBackup = JSON.parse(encryptedJson);
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
