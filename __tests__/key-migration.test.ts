import { deriveRougeeKem, encryptMessage, decryptMessage } from '@qwalla/core/pq';
import { bytesToHex } from '@rougechain/sdk';

// Validates the seed-key migration premise: the recovery-phrase-derived
// messaging key is deterministic (so Qwalla and the site arrive at the SAME
// key), it differs from the legacy private-key-derived key, and a message
// encrypted to one key does NOT open with the other — which is exactly why the
// decrypt fallback (primary seed key, then legacy key) is required.

const MNEMONIC =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';
const PRIV = 'a1b2c3d4e5f6'.repeat(8);

test('seed derivation is deterministic — Qwalla and the site derive the same key', () => {
  const a = deriveRougeeKem(MNEMONIC, PRIV);
  const b = deriveRougeeKem(MNEMONIC, PRIV);
  expect(a.publicKeyHex).toBe(b.publicKeyHex);
  expect(bytesToHex(a.secretKey)).toBe(bytesToHex(b.secretKey));
});

test('seed key (recovery phrase) differs from the legacy private-key key', () => {
  const seed = deriveRougeeKem(MNEMONIC, PRIV);
  const legacy = deriveRougeeKem(null, PRIV); // pre-migration material = private key
  expect(seed.publicKeyHex).not.toBe(legacy.publicKeyHex);
});

test('message to the seed key opens with seed, not legacy — fallback is needed', () => {
  const seed = deriveRougeeKem(MNEMONIC, PRIV);
  const legacy = deriveRougeeKem(null, PRIV);
  const plaintext = 'gm from the site';

  // Encrypted to the seed key (as the migrated site/peer would).
  const cipher = encryptMessage(plaintext, seed.publicKeyHex, seed.publicKeyHex);

  // Primary (seed) key opens it.
  expect(decryptMessage(cipher, bytesToHex(seed.secretKey), true)).toBe(plaintext);

  // Legacy key cannot — it must throw (or not return the plaintext), which is
  // what makes the try-seed-then-legacy fallback correct in both directions.
  let legacyOpened = false;
  try {
    legacyOpened = decryptMessage(cipher, bytesToHex(legacy.secretKey), true) === plaintext;
  } catch {
    legacyOpened = false;
  }
  expect(legacyOpened).toBe(false);
});
