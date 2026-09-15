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
      {/* The chat screen renders its own header (peer + actions) with a back
          button, so the native nav header is hidden — this also removes the
          iOS back label falling back to the route name ("index"). */}
      <Stack.Screen name="[id]" options={{ headerShown: false }} />
    </Stack>
  );
}
