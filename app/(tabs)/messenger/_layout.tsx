import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';

export default function MessengerStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: colors.bg },
      }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="new" options={{ title: 'New chat' }} />
      <Stack.Screen name="new-group" options={{ title: 'New group' }} />
      <Stack.Screen name="[id]" options={{ title: 'Chat' }} />
    </Stack>
  );
}
