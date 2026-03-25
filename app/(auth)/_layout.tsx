import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: colors.bg },
      }}>
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen name="create-wallet" options={{ title: 'New wallet' }} />
      <Stack.Screen name="import-wallet" options={{ title: 'Import wallet' }} />
    </Stack>
  );
}
