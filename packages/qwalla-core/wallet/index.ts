/**
 * wallet — key management, encrypted storage, backups.
 *
 * Pending migration from lib/: secure-store, encrypted-backup, evm-wallet,
 * address, wallet-directory. Platform coupling (AsyncStorage / expo-secure-store
 * / OS keychain / native PBKDF2) will be injected via a small host adapter so
 * the wallet logic itself stays framework-agnostic.
 */
export {};
