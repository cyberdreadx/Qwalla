/**
 * ML-KEM-768 + AES-256-GCM encryption for messenger/mail payloads.
 * Matches the rougechain-node / rougechain-wallet browser extension format:
 *   KEM encapsulate → HKDF(SHA-256, salt=zeros(32), info="pqc-msg") → AES-256-GCM
 */
import { gcm } from '@noble/ciphers/aes';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { ml_kem768 } from '@noble/post-quantum/ml-kem';
import { bytesToHex, hexToBytes } from '@rougechain/sdk';

const HKDF_SALT = new Uint8Array(32);
const HKDF_INFO = new TextEncoder().encode('pqc-msg');

function deriveAesKey(sharedSecret: Uint8Array): Uint8Array {
  return hkdf(sha256, sharedSecret, HKDF_SALT, HKDF_INFO, 32);
}

function aesGcmEncrypt(
  key: Uint8Array,
  plaintext: Uint8Array
): { iv: string; encryptedContent: string } {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const cipher = gcm(key, iv);
  const ct = cipher.encrypt(plaintext);
  return {
    iv: bytesToHex(iv),
    encryptedContent: bytesToHex(ct),
  };
}

function aesGcmDecrypt(
  key: Uint8Array,
  ivHex: string,
  encryptedContentHex: string
): Uint8Array {
  const iv = hexToBytes(ivHex);
  const ct = hexToBytes(encryptedContentHex);
  const cipher = gcm(key, iv);
  return cipher.decrypt(ct);
}

/** Payload format matching rougechain-node / browser extension */
type EncryptedPackage = {
  kemCipherText: string;
  iv: string;
  encryptedContent: string;
  senderKemCipherText?: string;
  senderIv?: string;
  senderEncryptedContent?: string;
};

/** v2 mail format with per-recipient wrapped CEK */
type V2MailPackage = {
  version: 2;
  iv: string;
  encryptedContent: string;
  wrappedKeys: Record<string, {
    kemCipherText: string;
    wrappedCek: string;
    wrappedIv: string;
  }>;
};

/** Legacy Qwalla v1 format (XChaCha20-Poly1305) */
type LegacyDualPayload = {
  v: 1;
  forRecipient: { kem: string; data: string };
  forSender: { kem: string; data: string };
};

/**
 * Encrypt a message for both recipient and sender (self-copy).
 * Produces JSON matching the rougechain-node format.
 */
export function encryptMessage(
  plaintextUtf8: string,
  recipientEncPubHex: string,
  senderEncPubHex: string
): string {
  const pt = new TextEncoder().encode(plaintextUtf8);
  const recipientPub = hexToBytes(recipientEncPubHex);
  const senderPub = hexToBytes(senderEncPubHex);

  const r1 = ml_kem768.encapsulate(recipientPub);
  const k1 = deriveAesKey(r1.sharedSecret);
  const enc1 = aesGcmEncrypt(k1, pt);

  const r2 = ml_kem768.encapsulate(senderPub);
  const k2 = deriveAesKey(r2.sharedSecret);
  const enc2 = aesGcmEncrypt(k2, pt);

  const pkg: EncryptedPackage = {
    kemCipherText: bytesToHex(r1.cipherText),
    iv: enc1.iv,
    encryptedContent: enc1.encryptedContent,
    senderKemCipherText: bytesToHex(r2.cipherText),
    senderIv: enc2.iv,
    senderEncryptedContent: enc2.encryptedContent,
  };
  return JSON.stringify(pkg);
}

/** Keep old name as alias for callers that haven't been updated */
export const encryptDual = encryptMessage;

/**
 * Decrypt an encrypted package. Handles:
 *  1. rougechain-node format (AES-256-GCM + HKDF)
 *  2. Legacy Qwalla format (XChaCha20-Poly1305 + HKDF)
 *  3. Fallback to sender copy if recipient fails
 */
export function decryptMessage(
  json: string,
  encPrivateKeyHex: string,
  isSender: boolean
): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return json;
  }

  const sk = hexToBytes(encPrivateKeyHex);

  // Legacy Qwalla v1 format
  if ((parsed as LegacyDualPayload).v === 1 && (parsed as LegacyDualPayload).forRecipient) {
    return decryptLegacyQwalla(parsed as LegacyDualPayload, sk, isSender);
  }

  const pkg = parsed as EncryptedPackage;

  // rougechain-node format: try the appropriate copy first
  if (isSender && pkg.senderKemCipherText && pkg.senderIv && pkg.senderEncryptedContent) {
    try {
      return kemDecrypt(pkg.senderKemCipherText, pkg.senderIv, pkg.senderEncryptedContent, sk);
    } catch { /* fall through */ }
  }

  if (pkg.kemCipherText && pkg.iv && pkg.encryptedContent) {
    try {
      return kemDecrypt(pkg.kemCipherText, pkg.iv, pkg.encryptedContent, sk);
    } catch { /* fall through */ }
  }

  // Fallback: try the other copy
  if (!isSender && pkg.senderKemCipherText && pkg.senderIv && pkg.senderEncryptedContent) {
    try {
      return kemDecrypt(pkg.senderKemCipherText, pkg.senderIv, pkg.senderEncryptedContent, sk);
    } catch { /* fall through */ }
  }
  if (isSender && pkg.kemCipherText && pkg.iv && pkg.encryptedContent) {
    try {
      return kemDecrypt(pkg.kemCipherText, pkg.iv, pkg.encryptedContent, sk);
    } catch { /* fall through */ }
  }

  return '[Unable to decrypt]';
}

function kemDecrypt(
  kemCipherTextHex: string,
  ivHex: string,
  encryptedContentHex: string,
  privateKey: Uint8Array
): string {
  const sharedSecret = ml_kem768.decapsulate(hexToBytes(kemCipherTextHex), privateKey);
  const key = deriveAesKey(sharedSecret);
  const pt = aesGcmDecrypt(key, ivHex, encryptedContentHex);
  return new TextDecoder().decode(pt);
}

/** Decrypt old Qwalla v1 payload (XChaCha20-Poly1305 + different HKDF info) */
function decryptLegacyQwalla(
  payload: LegacyDualPayload,
  sk: Uint8Array,
  isSender: boolean
): string {
  const LEGACY_INFO = new TextEncoder().encode('qwalla-e2e-v1');
  const part = isSender ? payload.forSender : payload.forRecipient;
  const kem = hexToBytes(part.kem);
  const shared = ml_kem768.decapsulate(kem, sk);
  const key = hkdf(sha256, shared, undefined, LEGACY_INFO, 32);
  const blob = hexToBytes(part.data);
  const nonce = blob.subarray(0, 24);
  const ct = blob.subarray(24);
  const cipher = xchacha20poly1305(key, nonce);
  return new TextDecoder().decode(cipher.decrypt(ct));
}

/**
 * Encrypt for v2 mail format (per-recipient wrapped CEK).
 * Produces output compatible with the website's decryptMailContent.
 */
export function encryptMailV2(
  plaintextUtf8: string,
  recipientEncPubKeys: string[],
  senderEncPubKey: string,
): string {
  const pt = new TextEncoder().encode(plaintextUtf8);

  const cek = new Uint8Array(32);
  crypto.getRandomValues(cek);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const contentCipher = gcm(cek, iv);
  const encrypted = contentCipher.encrypt(pt);

  const WRAP_INFO = new TextEncoder().encode('pqc-cek-wrap');
  const wrappedKeys: Record<string, { kemCipherText: string; wrappedCek: string; wrappedIv: string }> = {};
  const allKeys = [...new Set([...recipientEncPubKeys, senderEncPubKey])];

  for (const encPubKey of allKeys) {
    if (!encPubKey) continue;
    const { cipherText, sharedSecret } = ml_kem768.encapsulate(hexToBytes(encPubKey));
    const wrapKey = hkdf(sha256, sharedSecret, new Uint8Array(32), WRAP_INFO, 32);
    const wrapIv = new Uint8Array(12);
    crypto.getRandomValues(wrapIv);
    const wrapCipher = gcm(wrapKey, wrapIv);
    const wrappedCek = wrapCipher.encrypt(cek);

    wrappedKeys[encPubKey] = {
      kemCipherText: bytesToHex(cipherText),
      wrappedCek: bytesToHex(wrappedCek),
      wrappedIv: bytesToHex(wrapIv),
    };
  }

  return JSON.stringify({
    version: 2,
    iv: bytesToHex(iv),
    encryptedContent: bytesToHex(encrypted),
    wrappedKeys,
  });
}

/**
 * Decrypt v2 mail format (per-recipient wrapped CEK).
 * Matches the website's encryptForMultipleRecipients output.
 */
export function decryptMailV2(
  json: string,
  encPrivateKeyHex: string,
  encPublicKeyHex: string,
): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return json;
  }

  if ((parsed as { version?: number }).version === 2 && (parsed as V2MailPackage).wrappedKeys) {
    const pkg = parsed as V2MailPackage;
    const myWrapped = pkg.wrappedKeys[encPublicKeyHex];
    if (!myWrapped) return '[Unable to decrypt]';

    const sk = hexToBytes(encPrivateKeyHex);
    const sharedSecret = ml_kem768.decapsulate(hexToBytes(myWrapped.kemCipherText), sk);
    const WRAP_INFO = new TextEncoder().encode('pqc-cek-wrap');
    const wrapKey = hkdf(sha256, sharedSecret, new Uint8Array(32), WRAP_INFO, 32);

    const wrapIv = hexToBytes(myWrapped.wrappedIv);
    const wrappedCek = hexToBytes(myWrapped.wrappedCek);
    const unwrapCipher = gcm(wrapKey, wrapIv);
    const cek = unwrapCipher.decrypt(wrappedCek);

    const iv = hexToBytes(pkg.iv);
    const ct = hexToBytes(pkg.encryptedContent);
    const contentCipher = gcm(cek, iv);
    return new TextDecoder().decode(contentCipher.decrypt(ct));
  }

  // Fall back to messenger decryption
  return decryptMessage(json, encPrivateKeyHex, false);
}

/** Convenience wrapper matching the old API shape */
export function decryptMessageContent(
  encryptedJson: string,
  encPrivateKeyHex: string,
  mySigningPubHex: string,
  _myEncPubHex: string,
  _peerEncPubHex: string,
  messageSenderSigningPub: string
): string {
  const isSender = messageSenderSigningPub.toLowerCase() === mySigningPubHex.toLowerCase();
  return decryptMessage(encryptedJson, encPrivateKeyHex, isSender);
}
