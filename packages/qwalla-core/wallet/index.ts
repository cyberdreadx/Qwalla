/**
 * wallet — key management, encrypted storage, backups, EVM/Base accounts.
 *
 * MIGRATED: evm-wallet (BIP-32/39 EVM/Base account derivation + EIP-1559/191
 * signing via @scure/* + micro-eth-signer), address (RougeChain address
 * encoding via @noble). Both pure — run in RN, Chromium, Node.
 *
 * PENDING: secure-store + encrypted-backup (need a host storage/keychain
 * adapter — AsyncStorage / expo-secure-store / OS keychain injected, not
 * imported), wallet-directory (chain-coupled — migrates with
 * @qwalla/core/rougechain once the chain client is a factory instead of
 * reading the active-network store).
 */
export * from './evm-wallet';
export * from './address';
export * from './blocked-users';
export * from './pbkdf2';
