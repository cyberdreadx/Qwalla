import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';

export default function MailStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: colors.bg },
      }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="compose" options={{ title: 'Compose' }} />
      <Stack.Screen name="[id]" options={{ title: 'Message' }} />
    </Stack>
  );
}
