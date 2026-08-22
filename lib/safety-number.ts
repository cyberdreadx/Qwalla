import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Signal-style safety numbers for out-of-band key verification (MITM defense).
 *
 * Each party's identity is fingerprinted from their signing + encryption public
 * keys. The displayed number is the two fingerprints sorted and concatenated,
 * so both sides compute the identical value regardless of who is viewing. If the
 * numbers match on both devices, no one swapped a key in transit.
 */

const CHUNKS = 6; // 6 × 5 digits = 30 digits per party

function fingerprint(signingHex: string, encHex: string): string {
  const input = new TextEncoder().encode(`${signingHex.toLowerCase()}:${encHex.toLowerCase()}`);
  // Iterated hash mirrors Signal's approach of stretching the fingerprint.
  let h = sha256(input);
  for (let i = 0; i < 1024; i++) h = sha256(h);

  let digits = '';
  for (let i = 0; i < CHUNKS; i++) {
    const off = i * 4;
    const n =
      ((h[off] << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]) >>> 0;
    digits += String(n % 100000).padStart(5, '0');
  }
  return digits;
}

/**
 * Compute the shared 60-digit safety number for a 1:1 conversation.
 * Returns the digits grouped in blocks of five for readability.
 */
export function computeSafetyNumber(
  mySigningHex: string,
  myEncHex: string,
  peerSigningHex: string,
  peerEncHex: string,
): string {
  const mine = fingerprint(mySigningHex, myEncHex);
  const theirs = fingerprint(peerSigningHex, peerEncHex);
  const combined = [mine, theirs].sort().join('');
  return (combined.match(/.{1,5}/g) ?? []).join(' ');
}
