# Qwalla — Encryption Export Self-Classification

This is the annual self-classification report required under U.S. Export
Administration Regulations (EAR) License Exception ENC, § 740.17(b)(1), for
mass-market software that uses only standardized, published encryption
algorithms.

**Fill in the `[BRACKETED]` fields, then send the email below to BOTH addresses.**
Keep a copy — you reference the submission year in App Store Connect's export
compliance step, and the report is re-sent annually (or whenever the crypto
materially changes).

---

## Facts about Qwalla's encryption (for your reference)

All primitives are public, standardized algorithms implemented via the audited
open-source `@noble/*` libraries — no proprietary or custom cryptography.

| Function | Algorithm | Standard |
|---|---|---|
| Key encapsulation (E2E messaging/mail) | ML-KEM-768 | NIST FIPS 203 |
| Symmetric content encryption | AES-256-GCM | NIST FIPS 197 / SP 800-38D |
| Legacy symmetric encryption | XChaCha20-Poly1305 | IETF RFC 8439 (+ XChaCha extension) |
| Key derivation (E2E) | HKDF-SHA-256 | IETF RFC 5869 |
| Key derivation (backup passphrase) | PBKDF2-HMAC-SHA-256, 600k iterations | NIST SP 800-132 / RFC 8018 |
| Hashing | SHA-256 | NIST FIPS 180-4 |
| Transport | TLS 1.2+ (HTTPS/WSS) | IETF RFC 8446 |

Uses: end-to-end encrypted messaging and mail between wallet users, and
passphrase-encrypted local wallet backups. Symmetric key length 256 bits;
asymmetric security via ML-KEM-768 (NIST security category 3).

---

## Email to send

**To:** crypt@bis.doc.gov, enc@nsa.gov
**Subject:** Self-Classification Report — Qwalla mobile application

---

To Whom It May Concern:

Pursuant to Section 742.15(b) of the Export Administration Regulations (EAR),
please find below the self-classification report for the following mass-market
encryption product.

**Point of contact**
- Company / Author: [YOUR LEGAL NAME OR COMPANY NAME]
- Address: [MAILING ADDRESS]
- Email: [CONTACT EMAIL]
- Phone: [PHONE]

**Product**
- Product name: Qwalla
- Product type: Mobile application (iOS and Android) — cryptocurrency wallet
  with end-to-end encrypted messaging and mail
- Version: 1.0.0
- ECCN: 5D992.c
- Authorization type: Mass market, self-classified under License Exception ENC,
  § 740.17(b)(1)

**Encryption description**
Qwalla implements end-to-end encryption for user-to-user messaging and mail, and
passphrase-based encryption for local wallet backups, using only standardized,
publicly available algorithms:

- ML-KEM-768 (NIST FIPS 203) for post-quantum key encapsulation
- AES-256-GCM (NIST FIPS 197 / SP 800-38D) for symmetric encryption
- XChaCha20-Poly1305 (RFC 8439) for legacy symmetric encryption
- HKDF-SHA-256 (RFC 5869) and PBKDF2-HMAC-SHA-256 (NIST SP 800-132) for key
  derivation
- SHA-256 (NIST FIPS 180-4) for hashing
- TLS 1.2+ for transport

Maximum symmetric key length is 256 bits. The product uses standard,
non-proprietary cryptography and does not provide any cryptanalytic,
custom, or open-cryptographic-interface functionality.

Sincerely,
[YOUR NAME]
[TITLE, if applicable]

---

## After sending

1. In **App Store Connect → your app → App Information → Export Compliance**
   (or during a build's submission), answer:
   - "Does your app use encryption?" → **Yes**
   - "Does it qualify for any of the exemptions?" → **No**
   - "Does your app implement the ATS-exempt / standard-encryption path and
     have you filed a self-classification report?" → **Yes**
   - Provide the **year** you submitted this report.
2. Because `ITSAppUsesNonExemptEncryption: true` is now set in `app.json`,
   Apple will surface these questions once and remember the answer per version.
3. Re-send the report each calendar year while the app is distributed, and
   update it if the algorithm list materially changes.

> Not legal advice. For an app handling real financial value, have counsel
> confirm the ECCN (5D992.c assumed) and the self-classification route before
> your first submission.
