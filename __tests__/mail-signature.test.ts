import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { bytesToHex, hexToBytes } from '@rougechain/sdk';

import { sanitizeFileName, safeMimeType } from '@/lib/file-attach';

// Mirrors compose.tsx (sign) and mail/[id].tsx (verify): the content signature
// is ml_dsa65 over subject|body(|attachment) of the ENCRYPTED fields.
function sigPayload(subject: string, body: string, attachment?: string) {
  return subject + '|' + body + (attachment ? '|' + attachment : '');
}

const kp = ml_dsa65.keygen();
const otherKp = ml_dsa65.keygen();

test('mail content signature round-trips (sender key verifies)', () => {
  const payload = sigPayload('ENC_SUBJECT', 'ENC_BODY');
  const sig = bytesToHex(ml_dsa65.sign(new TextEncoder().encode(payload), kp.secretKey));
  const ok = ml_dsa65.verify(hexToBytes(sig), new TextEncoder().encode(payload), kp.publicKey);
  expect(ok).toBe(true);
});

test('signature includes the attachment field', () => {
  const payload = sigPayload('S', 'B', 'ENC_ATTACH');
  const sig = bytesToHex(ml_dsa65.sign(new TextEncoder().encode(payload), kp.secretKey));
  // Verifying WITHOUT the attachment in the payload must fail (tamper check).
  expect(
    ml_dsa65.verify(hexToBytes(sig), new TextEncoder().encode(sigPayload('S', 'B')), kp.publicKey),
  ).toBe(false);
  expect(ml_dsa65.verify(hexToBytes(sig), new TextEncoder().encode(payload), kp.publicKey)).toBe(true);
});

test('a different sender key and tampered content both fail', () => {
  const payload = sigPayload('S', 'B');
  const sig = bytesToHex(ml_dsa65.sign(new TextEncoder().encode(payload), kp.secretKey));
  expect(ml_dsa65.verify(hexToBytes(sig), new TextEncoder().encode(payload), otherKp.publicKey)).toBe(false);
  expect(
    ml_dsa65.verify(hexToBytes(sig), new TextEncoder().encode(sigPayload('S', 'EVIL')), kp.publicKey),
  ).toBe(false);
});

test('sanitizeFileName strips paths, unsafe chars, leading dots', () => {
  expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
  expect(sanitizeFileName('C:\\Windows\\evil.exe')).toBe('evil.exe');
  expect(sanitizeFileName('.hidden')).toBe('hidden');
  expect(sanitizeFileName('my report (final).pdf')).toBe('my_report_final_.pdf');
  expect(sanitizeFileName('')).toBe('file');
});

test('safeMimeType allow-lists, else opaque octet-stream', () => {
  expect(safeMimeType('application/pdf')).toBe('application/pdf');
  expect(safeMimeType('image/png')).toBe('image/png');
  expect(safeMimeType('AUDIO/MPEG')).toBe('audio/mpeg');
  expect(safeMimeType('text/html')).toBe('application/octet-stream');
  expect(safeMimeType('application/x-msdownload')).toBe('application/octet-stream');
  expect(safeMimeType('')).toBe('application/octet-stream');
});
