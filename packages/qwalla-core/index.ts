/**
 * @qwalla/core — the single source of truth for Qwalla's wallet, cryptography,
 * chain, and dApp-provider logic, shared by BOTH Qwalla Mobile (React Native)
 * and Qwalla Browser (Electron). Nothing framework-specific lives here: crypto
 * is @noble/* (runs in RN, Node, and Chromium); platform services (persistent
 * storage, OS keychain, native crypto fast-paths) are injected by each host
 * rather than imported, so this package has no react-native / expo dependency.
 *
 *   Qwalla Mobile  ─┐
 *                   ├─►  @qwalla/core
 *   Qwalla Browser ─┘
 *
 * Prefer importing a submodule directly (e.g. `@qwalla/core/pq`) to keep host
 * bundles lean; this barrel is a convenience for consumers that want it all.
 *
 * Migration status (into this package):
 *   pq               ← lib/pq-connection.ts (done); lib/encryption, rougee-kem,
 *                      pbkdf2, safety-number, stark-prover (pending)
 *   wallet           ← lib/secure-store, encrypted-backup, evm-wallet, address (pending)
 *   rougechain       ← lib/rougechain, ws, fees, evm-rpc, *-api (pending)
 *   domain-resolver  ← new: native .rouge resolution (stubbed)
 *   provider-bridge  ← lib/dapp-provider, evm-provider, dapp-session (pending)
 */
export * as pq from './pq';
export * as wallet from './wallet';
export * as rougechain from './rougechain';
export * as domainResolver from './domain-resolver';
export * as providerBridge from './provider-bridge';
