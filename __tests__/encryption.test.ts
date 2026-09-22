import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { bytesToHex } from '@rougechain/sdk';

import {
  decryptAny,
  decryptMailV2,
  decryptMessage,
  encryptMailV2,
  encryptMessage,
} from '@qwalla/core/pq';

// Deterministic-ish keypairs for the tests (keygen is random, which is fine —
// we assert round-trip correctness, not fixed ciphertext).
function keypair() {
  const kp = ml_kem768.keygen();
  return { pubHex: bytesToHex(kp.publicKey), privHex: bytesToHex(kp.secretKey) };
}

describe('encryption: 1:1 messages (encryptMessage / decryptMessage)', () => {
  it('recipient and sender can both decrypt their copy', () => {
    const alice = keypair(); // recipient
    const bob = keypair(); // sender
    const plaintext = 'hello quantum world 🔐';

    const pkg = encryptMessage(plaintext, alice.pubHex, bob.pubHex);

    // Recipient decrypts the recipient copy.
    expect(decryptMessage(pkg, alice.privHex, false)).toBe(plaintext);
    // Sender decrypts their self-copy.
    expect(decryptMessage(pkg, bob.privHex, true)).toBe(plaintext);
  });

  it('a wrong key does not recover the plaintext', () => {
    const alice = keypair();
    const bob = keypair();
    const mallory = keypair();
    const pkg = encryptMessage('secret', alice.pubHex, bob.pubHex);

    expect(decryptMessage(pkg, mallory.privHex, false)).not.toBe('secret');
  });

  it('decryptAny resolves the recipient copy', () => {
    const alice = keypair();
    const bob = keypair();
    const pkg = encryptMessage('via decryptAny', alice.pubHex, bob.pubHex);
    expect(decryptAny(pkg, alice.privHex, alice.pubHex, false)).toBe('via decryptAny');
  });

  it('preserves unicode and empty-ish content', () => {
    const alice = keypair();
    const bob = keypair();
    for (const msg of ['', ' ', 'a', '日本語のテスト', '👍🔥']) {
      const pkg = encryptMessage(msg, alice.pubHex, bob.pubHex);
      expect(decryptMessage(pkg, alice.privHex, false)).toBe(msg);
    }
  });
});

describe('encryption: group / mail (encryptMailV2 / decryptMailV2)', () => {
  it('every recipient can decrypt; sender can too', () => {
    const sender = keypair();
    const members = [keypair(), keypair(), keypair()];
    const plaintext = 'group message to N members';

    const pkg = encryptMailV2(
      plaintext,
      members.map((m) => m.pubHex),
      sender.pubHex,
    );

    for (const m of members) {
      expect(decryptMailV2(pkg, m.privHex, m.pubHex)).toBe(plaintext);
    }
    // Sender is included as a recipient so their own client can read it back.
    expect(decryptMailV2(pkg, sender.privHex, sender.pubHex)).toBe(plaintext);
  });

  it('a non-member cannot decrypt', () => {
    const sender = keypair();
    const members = [keypair(), keypair()];
    const outsider = keypair();
    const pkg = encryptMailV2(
      'members only',
      members.map((m) => m.pubHex),
      sender.pubHex,
    );
    expect(decryptMailV2(pkg, outsider.privHex, outsider.pubHex)).not.toBe('members only');
  });
});
