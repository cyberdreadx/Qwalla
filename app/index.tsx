import { Redirect } from 'expo-router';
import { Platform } from 'react-native';

import LandingPage from '@/components/landing/LandingPage';
import { useWalletStore } from '@/stores/wallet';

export default function Index() {
  const wallet = useWalletStore((s) => s.wallet);

  if (Platform.OS === 'web' && !wallet) {
    return <LandingPage />;
  }

  if (wallet) {
    return <Redirect href="/(tabs)/messenger" />;
  }

  return <Redirect href="/(auth)/welcome" />;
}
