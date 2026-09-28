// Silence the expected pbkdf2 "native unavailable → JS fallback" warning in the
// Node test environment (there's no react-native-quick-crypto here, so the
// pure-JS path is used by design). The warning is intentionally kept for real
// builds, where it flags slow key derivation.
// AsyncStorage's native module is null under Node; use its in-memory jest mock
// so lib/secure-store (which now mirrors the wallet record there) can be tested.
// Test files that need to control read behaviour override this per-file.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const originalWarn = console.warn;
console.warn = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('[pbkdf2]')) return;
  originalWarn(...args);
};
