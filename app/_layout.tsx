import 'react-native-get-random-values';

import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import * as Linking from 'expo-linking';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, useCallback, useRef } from 'react';
import { StatusBar, Alert, Platform, AppState, type AppStateStatus } from 'react-native';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ApprovalModal from '@/components/dapp/ApprovalModal';
import LockScreen from '@/components/LockScreen';
import { ToastHost } from '@/components/ui/Toast';
import { colors } from '@/constants/theme';
import { useInitialUnreadCounts } from '@/hooks/useInitialUnreadCounts';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useRealtimeNotifications } from '@/hooks/useRealtimeNotifications';
import type { ApprovalRequest } from '@/lib/dapp-provider';
import { parsePairingUri, startPairingSession } from '@/lib/dapp-session';
import { useNetworkStore } from '@/stores/network';
import { useSettingsStore } from '@/stores/settings';
import { useWalletStore } from '@/stores/wallet';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'index',
};

SplashScreen.preventAutoHideAsync();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.chrome,
    text: colors.text,
    border: colors.border,
    primary: colors.accent,
  },
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });
  const hydrate = useWalletStore((s) => s.hydrate);
  const hydrated = useWalletStore((s) => s.hydrated);
  const hydrateNetwork = useNetworkStore((s) => s.hydrate);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const isLocked = useWalletStore((s) => s.isLocked);
  const hasPassword = useWalletStore((s) => s.hasPassword);
  const lock = useWalletStore((s) => s.lock);
  const [pairingApproval, setPairingApproval] = useState<ApprovalRequest | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  // When the app last entered the background — drives the auto-lock grace period.
  const backgroundedAtRef = useRef<number | null>(null);

  const handleDeepLink = useCallback(
    (url: string) => {
      if (!url || Platform.OS === 'web') return;
      const params = parsePairingUri(url);
      if (!params) return;

      const wallet = useWalletStore.getState().wallet;
      if (!wallet) {
        Alert.alert('No Wallet', 'Create or import a wallet before pairing.');
        return;
      }

      Alert.alert(
        'Pair with dApp?',
        `Connect to relay ${params.relay.replace(/^wss?:\/\//, '')}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Pair',
            onPress: async () => {
              const ok = await startPairingSession(params, (req) =>
                setPairingApproval(req),
              );
              if (!ok) {
                Alert.alert('Pairing Failed', 'Could not connect to the relay.');
              }
            },
          },
        ],
      );
    },
    [],
  );

  useEffect(() => {
    if (Platform.OS === 'web') return;
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink(url);
    });
    const sub = Linking.addEventListener('url', (event) => handleDeepLink(event.url));
    return () => sub.remove();
  }, [handleDeepLink]);

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    // Restore the persisted network first so the wallet re-registers,
    // fetches balances, and opens the WS against the right chain.
    void hydrateNetwork().then(() => hydrate());
  }, [hydrateNetwork, hydrate]);

  useEffect(() => {
    // Load the auto-lock preference (independent of wallet/network hydration).
    void hydrateSettings();
  }, [hydrateSettings]);

  useEffect(() => {
    if (loaded && hydrated) {
      SplashScreen.hideAsync();
    }
  }, [loaded, hydrated]);

  // Auto-lock based on the user's configured grace period (Settings → Wallet
  // lock), instead of on every background event. With a grace period, quick trips
  // out of the app — copying an address, the share / document-picker sheet,
  // glancing at another app to grab a message — come back without re-entering the
  // password, while leaving the app for longer still locks it. Testers hit the old
  // lock-on-every-background behavior as "it asks for the password every time, even
  // after switching back from another app." 'Immediately' (0) keeps the strict
  // lock-on-background behavior for anyone who wants it.
  //
  // iOS/Android fire 'inactive' for transient interruptions (app switcher,
  // permission/share sheets, the biometric prompt) — those must NOT arm the
  // timer, so only 'background' does. Keys stay in memory during the grace window;
  // a cold start always locks (hydrate() → isLocked for encrypted wallets).
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const lockIfProtected = () => {
      const { hasPassword: hasPw, wallet: w } = useWalletStore.getState();
      if (hasPw && w) void lock();
    };

    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;

      const autoLockMs = useSettingsStore.getState().autoLockMs;

      if (nextState === 'background') {
        if (autoLockMs <= 0) {
          lockIfProtected(); // 'Immediately' — lock as soon as we background
          return;
        }
        if (backgroundedAtRef.current == null) backgroundedAtRef.current = Date.now();
        return;
      }

      if (nextState === 'active' && prev !== 'active') {
        const since = backgroundedAtRef.current;
        backgroundedAtRef.current = null;
        if (since == null) return;
        if (Date.now() - since < autoLockMs) return; // within grace — stay unlocked
        lockIfProtected();
      }
    });

    return () => sub.remove();
  }, [lock]);

  useRealtimeNotifications();
  usePushNotifications();
  useInitialUnreadCounts();

  if (!loaded || !hydrated) {
    return null;
  }

  if (isLocked) {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" />
        <LockScreen />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider value={navTheme}>
        <StatusBar barStyle="light-content" />
        <Stack screenOptions={{ contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
        <ToastHost />
        <ApprovalModal
          request={pairingApproval}
          onClose={() => setPairingApproval(null)}
        />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
