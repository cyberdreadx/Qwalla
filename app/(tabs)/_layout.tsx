import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { useNotificationStore } from '@/stores/notifications';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, Platform.OS === 'web' ? 10 : 6);
  const unreadChats = useNotificationStore((s) => s.unreadChats);
  const unreadMail = useNotificationStore((s) => s.unreadMail);

  return (
    <Tabs
      initialRouteName="messenger"
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        tabBarStyle: {
          backgroundColor: colors.chrome,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          paddingTop: 6,
          paddingBottom: bottomPad,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          marginTop: 1,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
      }}>
      <Tabs.Screen
        name="messenger"
        options={{
          title: 'Chats',
          headerShown: false,
          tabBarBadge: unreadChats > 0 ? unreadChats : undefined,
          tabBarBadgeStyle: unreadChats > 0 ? styles.badge : undefined,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubble" size={size ?? 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="mail"
        options={{
          title: 'Mail',
          headerShown: false,
          tabBarBadge: unreadMail > 0 ? unreadMail : undefined,
          tabBarBadgeStyle: unreadMail > 0 ? styles.badge : undefined,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="mail" size={size ?? 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: 'Wallet',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="wallet" size={size ?? 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="browser"
        options={{
          title: 'Browser',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="compass" size={size ?? 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-sharp" size={size ?? 22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: colors.accent,
    color: colors.bg,
    fontSize: 10,
    fontWeight: '700',
    minWidth: 18,
    height: 18,
    borderRadius: 9,
  },
});
