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

/**
 * On-chain limit enforced by the node for an inline token logo: the WHOLE
 * `data:` URI string (prefix + base64) must be <= 32 KiB
 * (`MAX_TOKEN_IMAGE_DATA_URI_BYTES` in the daemon). Leave a little headroom.
 */
export const TOKEN_LOGO_DATA_URI_MAX_CHARS = 32 * 1024;
const TOKEN_LOGO_TARGET_CHARS = 30 * 1024;

// Square logo: progressively smaller edge + lower JPEG quality.
const LOGO_ATTEMPTS: Array<{ size: number; quality: number }> = [
  { size: 256, quality: 0.8 },
  { size: 256, quality: 0.6 },
  { size: 192, quality: 0.6 },
  { size: 160, quality: 0.5 },
  { size: 128, quality: 0.5 },
  { size: 128, quality: 0.35 },
  { size: 96, quality: 0.35 },
];

/**
 * Shrink a picked image into a token logo the chain will accept and return
 * the full `data:image/jpeg;base64,...` URI. The picker already crops to a
 * square; we only resize + re-encode. Returns null if even 96px won't fit.
 */
export async function compressTokenLogoToDataUri(uri: string): Promise<string | null> {
  for (const attempt of LOGO_ATTEMPTS) {
    const result = await manipulateAsync(
      uri,
      [{ resize: { width: attempt.size, height: attempt.size } }],
      { compress: attempt.quality, format: SaveFormat.JPEG, base64: true },
    );
    if (!result.base64) continue;
    const dataUri = `data:image/jpeg;base64,${result.base64}`;
    if (dataUri.length <= TOKEN_LOGO_TARGET_CHARS) return dataUri;
  }
  return null;
}
