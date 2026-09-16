import { Ionicons } from '@expo/vector-icons';
import { router, useSegments } from 'expo-router';
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { colors } from '@/constants/theme';
import { useNotificationStore } from '@/stores/notifications';

/**
 * Desktop chrome: on wide web viewports (desktop / Electron) the bottom tab bar
 * is replaced by a vertical left icon rail (Signal-style), and screen content
 * fills the rest of the window. Pass-through on native and mobile web, where the
 * normal bottom tabs are used.
 */

const BREAKPOINT = 760;
const RAIL_W = 76;

type TabDef = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: '/messenger' | '/mail' | '/wallet' | '/browser' | '/settings';
};

const TABS: TabDef[] = [
  { key: 'messenger', label: 'Chats', icon: 'chatbubble', href: '/messenger' },
  { key: 'mail', label: 'Mail', icon: 'mail', href: '/mail' },
  { key: 'wallet', label: 'Wallet', icon: 'wallet', href: '/wallet' },
  { key: 'browser', label: 'Browser', icon: 'compass', href: '/browser' },
  { key: 'settings', label: 'Settings', icon: 'settings-sharp', href: '/settings' },
];

export function DesktopShell({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const segments = useSegments();
  const unreadChats = useNotificationStore((s) => s.unreadChats);
  const unreadMail = useNotificationStore((s) => s.unreadMail);

  if (Platform.OS !== 'web' || width < BREAKPOINT) return <>{children}</>;

  const active = segments[1] ?? 'messenger';

  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        {TABS.map((t) => {
          const on = active === t.key;
          const badge = t.key === 'messenger' ? unreadChats : t.key === 'mail' ? unreadMail : 0;
          return (
            <Pressable
              key={t.key}
              onPress={() => router.push(t.href)}
              style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]}>
              <View>
                <Ionicons name={t.icon} size={22} color={on ? colors.accent : colors.textTertiary} />
                {badge > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.label, on && styles.labelActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  rail: {
    width: RAIL_W,
    backgroundColor: colors.chrome,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
    alignItems: 'center',
    paddingTop: 18,
    gap: 4,
  },
  item: { width: RAIL_W, alignItems: 'center', paddingVertical: 10, gap: 3 },
  label: { color: colors.textTertiary, fontSize: 10, fontWeight: '600' },
  labelActive: { color: colors.accent },
  badge: {
    position: 'absolute',
    top: -5,
    right: -9,
    backgroundColor: colors.accent,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: colors.bg, fontSize: 9, fontWeight: '700' },
  content: { flex: 1 },
});
