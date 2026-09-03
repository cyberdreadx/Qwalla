import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';

export default function WalletStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: colors.bg },
      }}>
      {/* headerShown is false here, but `title` is still used as the back-button
          label on screens pushed from the wallet home (otherwise it falls back
          to the route name "index"). */}
      <Stack.Screen name="index" options={{ headerShown: false, title: 'Wallet' }} />
      <Stack.Screen name="send" options={{ title: 'Send' }} />
      <Stack.Screen name="send-base" options={{ title: 'Send on Base' }} />
      <Stack.Screen name="receive" options={{ title: 'Receive' }} />
      <Stack.Screen name="create-token" options={{ title: 'Create Token' }} />
      <Stack.Screen name="swap" options={{ title: 'Swap' }} />
      <Stack.Screen name="bridge" options={{ title: 'Bridge' }} />
      <Stack.Screen name="stake" options={{ title: 'Staking' }} />
    </Stack>
  );
}
