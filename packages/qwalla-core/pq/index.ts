/**
 * pq — post-quantum cryptography + connection checks.
 *
 * Migrated: pq-connection (TLS key-exchange verification).
 * Pending (from lib/): encryption (ML-KEM-768 / ML-DSA-65 / XChaCha20-Poly1305),
 * rougee-kem, pbkdf2 (native fast-path injected by host), safety-number,
 * stark-prover.
 */
export * from './pq-connection';
