/**
 * Registers this app's platform services with @qwalla/core, so shared core
 * modules (connected-sites now; secure-store / wallet next) use them without
 * importing React Native / Expo directly.
 *
 * Side-effect module — imported once at the very top of app/_layout.tsx so it
 * runs before any core storage code. The Electron browser wires its own
 * adapters the same way (via the shared web bundle, this file runs there too;
 * AsyncStorage falls back to localStorage on web).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setHostAdapters } from '@qwalla/core/host';

import { nativePbkdf2 } from './pbkdf2';

setHostAdapters({
  storage: {
    get: (key) => AsyncStorage.getItem(key),
    set: (key, value) => AsyncStorage.setItem(key, value),
    remove: (key) => AsyncStorage.removeItem(key),
  },
  // Native PBKDF2 fast-path, registered only when self-checked byte-identical to
  // @noble (see lib/pbkdf2). When absent, @qwalla/core falls back to noble.
  crypto: nativePbkdf2 ? { pbkdf2Sha256: nativePbkdf2 } : undefined,
});
