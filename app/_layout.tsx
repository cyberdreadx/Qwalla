import 'react-native-get-random-values';

import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import * as Linking from 'expo-linking';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, useCallback } from 'react';
import { StatusBar, Alert, Platform } from 'react-native';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ApprovalModal from '@/components/dapp/ApprovalModal';
import { ToastHost } from '@/components/ui/Toast';
import { colors } from '@/constants/theme';
import { useInitialUnreadCounts } from '@/hooks/useInitialUnreadCounts';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useRealtimeNotifications } from '@/hooks/useRealtimeNotifications';
import type { ApprovalRequest } from '@/lib/dapp-provider';
import { parsePairingUri, startPairingSession } from '@/lib/dapp-session';
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
  const [pairingApproval, setPairingApproval] = useState<ApprovalRequest | null>(null);

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
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (loaded && hydrated) {
      SplashScreen.hideAsync();
    }
  }, [loaded, hydrated]);

  useRealtimeNotifications();
  usePushNotifications();
  useInitialUnreadCounts();

  if (!loaded || !hydrated) {
    return null;
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
