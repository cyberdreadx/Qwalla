// Silence the expected pbkdf2 "native unavailable → JS fallback" warning in the
// Node test environment (there's no react-native-quick-crypto here, so the
// pure-JS path is used by design). The warning is intentionally kept for real
// builds, where it flags slow key derivation.
const originalWarn = console.warn;
console.warn = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('[pbkdf2]')) return;
  originalWarn(...args);
};
