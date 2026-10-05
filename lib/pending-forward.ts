import type { FileAttach } from '@/lib/file-attach';

/**
 * Hand-off slot for a forwarded mail attachment. Attachments are up to ~2MB of
 * base64 — far too large to pass through navigation params (URL length limits),
 * so the mail detail screen stashes it here and the compose screen takes it on
 * mount. In-memory only and single-use (take() clears it) so a stale attachment
 * can't leak into an unrelated compose.
 */
let pending: FileAttach | null = null;

export function setPendingForwardAttachment(file: FileAttach | null): void {
  pending = file;
}

export function takePendingForwardAttachment(): FileAttach | null {
  const f = pending;
  pending = null;
  return f;
}
