import 'react-native-get-random-values';

import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StatusBar } from 'react-native';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastHost } from '@/components/ui/Toast';
import { colors } from '@/constants/theme';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useRealtimeNotifications } from '@/hooks/useRealtimeNotifications';
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
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
