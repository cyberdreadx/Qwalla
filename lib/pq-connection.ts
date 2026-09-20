/**
 * Verifies whether the browser's HTTPS connections actually use a post-quantum
 * key exchange — i.e. whether the `PostQuantumKyber` switch in the desktop
 * shell (desktop/main.js) is taking effect end to end.
 *
 * Cloudflare echoes the negotiated TLS key-exchange group on its trace
 * endpoint (`kex=...`), so a fetch from the renderer reflects Chromium's real
 * network stack — not Node's, and not a guess. On the desktop app the cross-
 * origin fetch succeeds because main.js relaxes CORS for remote responses.
 *
 * Scope: this measures the *connection* layer only. It says nothing about the
 * certificate signatures (still classical RSA/ECDSA across the web PKI) or
 * about Qwalla's own message/mail/wallet crypto (already ML-DSA-65 / ML-KEM-768
 * and independent of the browser).
 */

const TRACE_URL = 'https://www.cloudflare.com/cdn-cgi/trace';

export interface PqKexResult {
  /** The negotiated key-exchange group, e.g. "X25519MLKEM768",
   *  "X25519Kyber768Draft00", or "X25519". Null if it couldn't be read. */
  kex: string | null;
  /** True when the negotiated group is a post-quantum (ML-KEM / Kyber) hybrid. */
  postQuantum: boolean;
  /** True when the trace itself couldn't be fetched (offline, blocked, etc.). */
  error: boolean;
}

/** Post-quantum groups Chromium may negotiate, matched case-insensitively. */
const PQ_GROUP = /kyber|mlkem|ml-kem/i;

export async function checkPostQuantumKex(): Promise<PqKexResult> {
  try {
    const res = await fetch(TRACE_URL, { cache: 'no-store' });
    if (!res.ok) return { kex: null, postQuantum: false, error: true };
    const text = await res.text();
    const m = text.match(/^kex=(.+)$/m);
    const kex = m ? m[1].trim() : null;
    return { kex, postQuantum: !!kex && PQ_GROUP.test(kex), error: false };
  } catch {
    return { kex: null, postQuantum: false, error: true };
  }
}
