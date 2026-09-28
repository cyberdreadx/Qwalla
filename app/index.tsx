import { Redirect } from 'expo-router';
import { Platform } from 'react-native';

import LandingPage from '@/components/landing/LandingPage';
import { IS_BROWSER_APP } from '@/lib/app-mode';
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
  // A locked (or password-protected) wallet still EXISTS — route to the app and
  // let the lock-screen overlay cover it until unlock. Redirecting to onboarding
  // while locked stranded users on the welcome screen after biometric unlock,
  // because nothing navigated back to the app once the wallet loaded.
  const isLocked = useWalletStore((s) => s.isLocked);
  const hasPassword = useWalletStore((s) => s.hasPassword);

  // Standalone Qwalla Browser: always boot into the browser. Browsing doesn't
  // require a wallet — it's only used for dApp approvals — so this bypasses the
  // landing page and the messenger default.
  if (IS_BROWSER_APP) {
    return <Redirect href="/(tabs)/browser" />;
  }

  if (wallet || isLocked || hasPassword) {
    return <Redirect href="/(tabs)/messenger" />;
  }

  if (Platform.OS === 'web' && !isStandalonePWA()) {
    return <LandingPage />;
  }

  return <Redirect href="/(auth)/welcome" />;
}
