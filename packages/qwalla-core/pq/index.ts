/**
 * pq — post-quantum cryptography + connection checks. Pure @noble/* +
 * @rougechain/sdk (runs in RN, Chromium, and Node — no platform imports).
 *
 * Migrated: pq-connection (TLS key-exchange verification), encryption
 * (ML-KEM-768 / ML-DSA-65 / XChaCha20-Poly1305 for messages + mail),
 * rougee-kem (RouGee envelope KEM), safety-number.
 * Pending: pbkdf2 (needs a host adapter for the native fast-path). stark-prover
 * stays in the app (it's a react-native-webview hook, not framework-agnostic).
 */
export * from './pq-connection';
export * from './encryption';
export * from './rougee-kem';
export * from './safety-number';
