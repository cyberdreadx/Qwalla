import { pbkdf2Sha256 } from '@/lib/pbkdf2';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('pbkdf2-hmac-sha256', () => {
  it('is deterministic for the same inputs', () => {
    const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const a = pbkdf2Sha256('correct horse battery staple', salt, 2048, 32);
    const b = pbkdf2Sha256('correct horse battery staple', salt, 2048, 32);
    expect(a.length).toBe(32);
    expect(hex(a)).toBe(hex(b));
  });

  it('changes with a different salt', () => {
    const a = pbkdf2Sha256('pw', new Uint8Array([1]), 2048, 32);
    const b = pbkdf2Sha256('pw', new Uint8Array([2]), 2048, 32);
    expect(hex(a)).not.toBe(hex(b));
  });

  it('changes with a different password', () => {
    const salt = new Uint8Array([9, 9, 9, 9]);
    const a = pbkdf2Sha256('password-a', salt, 2048, 32);
    const b = pbkdf2Sha256('password-b', salt, 2048, 32);
    expect(hex(a)).not.toBe(hex(b));
  });

  it('matches a known RFC-style vector (P="password", S="salt", c=4096)', () => {
    // dkLen=32, sha256 — widely published test vector.
    const dk = pbkdf2Sha256(
      'password',
      new Uint8Array([115, 97, 108, 116]), // "salt"
      4096,
      32,
    );
    expect(hex(dk)).toBe('c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a');
  });
});
