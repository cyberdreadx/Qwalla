import * as FileSystem from 'expo-file-system/legacy';
import { RecordingPresets, type RecordingOptions } from 'expo-audio';

/**
 * Low-bitrate mono AAC/m4a for voice notes. A message is capped at ~2 MB of
 * *encrypted* content (≈4x the base64 data-URI text after the dual-copy + hex
 * encoding), so keep the audio small: 32 kbps mono ≈ 4 KB/s. At the 60 s cap
 * that's ~240 KB of audio → ~329 KB data-URI → ~1.3 MB encrypted, safely under
 * the cap. Based on HIGH_QUALITY so both platforms produce .m4a/AAC.
 */
export const VOICE_RECORDING: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 32000,
};

/** Hard cap on a single voice note. Keeps the encrypted message under 2 MB. */
export const MAX_VOICE_MS = 60_000;

/** Data-URI text budget (plaintext); ~4x this is the encrypted size. */
export const VOICE_DATA_URI_MAX = 480 * 1024;

const VOICE_RE = /^data:audio\//i;

export function isVoiceDataUri(s: string): boolean {
  return VOICE_RE.test(s.trim());
}

/** Read a finished recording file into a `data:audio/mp4;base64,…` URI. */
export async function readRecordingAsDataUri(uri: string): Promise<string | null> {
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (!base64) return null;
    // m4a is an MPEG-4 container; audio/mp4 is the correct, widely-played type.
    return `data:audio/mp4;base64,${base64}`;
  } catch {
    return null;
  }
}

// Cache the temp files we materialize from received data-URIs, keyed by a stable
// hash of the URI, so replaying a note doesn't rewrite the file every time.
const fileCache: Record<string, string> = {};

function keyFor(dataUri: string): string {
  // Cheap stable key: length + a sample of the payload (avoids hashing MBs).
  const body = dataUri.slice(dataUri.indexOf(',') + 1);
  return `${body.length}_${body.slice(0, 24)}_${body.slice(-24)}`.replace(/[^a-zA-Z0-9_]/g, '');
}

/**
 * The native player needs a file/URL, not a base64 data-URI, so write the audio
 * to the cache dir once and return the file URI. Safe to call repeatedly.
 */
export async function voiceDataUriToFile(dataUri: string): Promise<string | null> {
  try {
    const key = keyFor(dataUri);
    const cached = fileCache[key];
    if (cached) return cached;
    const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
    const path = `${FileSystem.cacheDirectory}voice_${key}.m4a`;
    await FileSystem.writeAsStringAsync(path, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    fileCache[key] = path;
    return path;
  } catch {
    return null;
  }
}

/** "0:07", "1:23" from a seconds value. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}
