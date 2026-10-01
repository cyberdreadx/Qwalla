import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { Ionicons } from '@expo/vector-icons';

/**
 * Shared document / audio file attachments for chat + mail. A file message is a
 * plain string: the `[file]` marker followed by JSON of this shape (data is raw
 * base64, reconstructed into a data URI only when opened). All native modules
 * used here (document-picker, file-system, sharing) already ship in the binary,
 * so this is OTA-safe.
 */
export type FileAttach = { name: string; type: string; size: number; data: string };

const FILE_PREFIX = '[file]';

export function isFileMessage(text: string): boolean {
  return typeof text === 'string' && text.startsWith(FILE_PREFIX);
}

export function encodeFileMessage(f: FileAttach): string {
  return FILE_PREFIX + JSON.stringify(f);
}

export function decodeFileMessage(text: string): FileAttach | null {
  if (!isFileMessage(text)) return null;
  try {
    const o = JSON.parse(text.slice(FILE_PREFIX.length));
    if (o && typeof o.data === 'string' && typeof o.name === 'string') {
      return { name: o.name, type: o.type || 'application/octet-stream', size: Number(o.size) || 0, data: o.data };
    }
  } catch {
    /* malformed */
  }
  return null;
}

/** base64 length → decoded byte count. */
function b64Bytes(b64: string): number {
  const len = b64.length;
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((len * 3) / 4) - pad;
}

export type PickResult =
  | { ok: true; file: FileAttach }
  | { ok: false; error: 'too_big' | 'read' }
  | null; // null = cancelled

/**
 * Let the user pick any file and return it as a FileAttach, rejecting anything
 * over `limitBytes` (decoded). Returns null when cancelled.
 */
export async function pickFileAttachment(limitBytes: number): Promise<PickResult> {
  if (Platform.OS === 'web') {
    return pickFileWeb(limitBytes);
  }
  try {
    const res = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled || !res.assets?.[0]) return null;
    const asset = res.assets[0];
    const data = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
    const size = b64Bytes(data);
    if (size > limitBytes) return { ok: false, error: 'too_big' };
    return {
      ok: true,
      file: { name: asset.name || 'file', type: asset.mimeType || 'application/octet-stream', size, data },
    };
  } catch {
    return { ok: false, error: 'read' };
  }
}

function pickFileWeb(limitBytes: number): Promise<PickResult> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const data = result.includes(',') ? result.slice(result.indexOf(',') + 1) : '';
        const size = b64Bytes(data);
        if (size > limitBytes) return resolve({ ok: false, error: 'too_big' });
        resolve({
          ok: true,
          file: { name: file.name, type: file.type || 'application/octet-stream', size, data },
        });
      };
      reader.onerror = () => resolve({ ok: false, error: 'read' });
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

/** Save / open a received file via the OS share sheet (or a download on web). */
export async function openFileAttachment(f: FileAttach): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof document === 'undefined') return;
    const a = document.createElement('a');
    a.href = `data:${f.type};base64,${f.data}`;
    a.download = f.name;
    a.click();
    return;
  }
  const safe = (f.name || 'file').replace(/[^\w.\-]+/g, '_');
  const path = `${FileSystem.cacheDirectory}${safe}`;
  await FileSystem.writeAsStringAsync(path, f.data, { encoding: FileSystem.EncodingType.Base64 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, { mimeType: f.type, dialogTitle: f.name });
  }
}

/** A sensible Ionicon name for a file's type. */
export function fileIconName(type: string, name = ''): keyof typeof Ionicons.glyphMap {
  const t = (type || '').toLowerCase();
  const ext = name.toLowerCase().split('.').pop() || '';
  if (t.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'ogg', 'flac'].includes(ext)) return 'musical-notes-outline';
  if (t === 'application/pdf' || ext === 'pdf') return 'document-text-outline';
  if (t.startsWith('video/')) return 'videocam-outline';
  if (t.startsWith('image/')) return 'image-outline';
  if (['text/markdown', 'text/plain'].includes(t) || ['md', 'txt'].includes(ext)) return 'document-outline';
  if (['zip', 'rar', '7z'].includes(ext)) return 'archive-outline';
  return 'document-outline';
}

/** Human-readable file size. */
export function humanFileSize(bytes: number): string {
  if (!bytes) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

/** Decoded-byte limits: chat double-encrypts + hex-encodes, so keep it small. */
export const CHAT_FILE_LIMIT = 320 * 1024;
export const MAIL_FILE_LIMIT = 2 * 1024 * 1024;
