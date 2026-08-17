import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

/** Approximate decoded byte size of a base64 string (ignores the data: prefix). */
export function base64Bytes(b64: string): number {
  const comma = b64.indexOf(',');
  const raw = comma >= 0 ? b64.slice(comma + 1) : b64;
  return Math.ceil(raw.length * 0.75);
}

export interface FittedImage {
  /** Raw base64 (no data: prefix). */
  base64: string;
  mimeType: string;
  uri: string;
  sizeBytes: number;
}

// Progressively smaller dimension + lower JPEG quality. First pass that lands
// under the limit wins, so small-ish images stay near full quality.
const ATTEMPTS: Array<{ maxW: number; quality: number }> = [
  { maxW: 1600, quality: 0.7 },
  { maxW: 1600, quality: 0.5 },
  { maxW: 1280, quality: 0.45 },
  { maxW: 1024, quality: 0.4 },
  { maxW: 800, quality: 0.35 },
  { maxW: 640, quality: 0.3 },
];

/**
 * Resize + re-encode an image (as JPEG) until its base64 payload fits under
 * `maxBytes`. `originalWidth` (from the picker asset) prevents upscaling small
 * images. Returns null if it can't get under the limit even at the smallest
 * attempt.
 */
export async function compressImageToLimit(
  uri: string,
  maxBytes: number,
  originalWidth?: number,
): Promise<FittedImage | null> {
  for (const attempt of ATTEMPTS) {
    const targetW = originalWidth ? Math.min(attempt.maxW, originalWidth) : attempt.maxW;
    const result = await manipulateAsync(uri, [{ resize: { width: targetW } }], {
      compress: attempt.quality,
      format: SaveFormat.JPEG,
      base64: true,
    });
    const b64 = result.base64 ?? '';
    const sizeBytes = base64Bytes(b64);
    if (b64 && sizeBytes <= maxBytes) {
      return { base64: b64, mimeType: 'image/jpeg', uri: result.uri, sizeBytes };
    }
  }
  return null;
}
