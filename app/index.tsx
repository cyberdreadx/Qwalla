import { Redirect } from 'expo-router';
import { Platform } from 'react-native';

import LandingPage from '@/components/landing/LandingPage';
import { useWalletStore } from '@/stores/wallet';

function isStandalonePWA() {
  if (Platform.OS !== 'web') return false;
  if (typeof window === 'undefined') return false;
  return (
    (window.matchMedia?.('(display-mode: standalone)')?.matches) ||
    (window.navigator as any)?.standalone === true
  );
}

export default function Index() {
  const wallet = useWalletStore((s) => s.wallet);

  if (wallet) {
    return <Redirect href="/(tabs)/messenger" />;
  }

  if (Platform.OS === 'web' && !isStandalonePWA()) {
    return <LandingPage />;
  }

  return <Redirect href="/(auth)/welcome" />;
}
