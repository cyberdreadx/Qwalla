import { Ionicons } from '@expo/vector-icons';
import { router, useSegments } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { colors } from '@/constants/theme';
import { IS_BROWSER_APP } from '@/lib/app-mode';
import { useT } from '@/lib/i18n';
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
  labelKey: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: '/messenger' | '/mail' | '/wallet' | '/browser' | '/settings';
};

const TABS: TabDef[] = [
  { key: 'messenger', labelKey: 'shell_chats', icon: 'chatbubble', href: '/messenger' },
  { key: 'mail', labelKey: 'shell_mail', icon: 'mail', href: '/mail' },
  { key: 'wallet', labelKey: 'shell_wallet', icon: 'wallet', href: '/wallet' },
  { key: 'browser', labelKey: 'shell_browser', icon: 'compass', href: '/browser' },
  { key: 'settings', labelKey: 'shell_settings', icon: 'settings-sharp', href: '/settings' },
];

export function DesktopShell({ children }: { children: ReactNode }) {
  const { t } = useT();
  const { width } = useWindowDimensions();
  const [collapsed, setCollapsed] = useState(false);
  const segments = useSegments();
  const unreadChats = useNotificationStore((s) => s.unreadChats);
  const unreadMail = useNotificationStore((s) => s.unreadMail);

  if (Platform.OS !== 'web' || width < BREAKPOINT) return <>{children}</>;

  // Cast to string[]: expo-router's typed-routes typegen can narrow useSegments()
  // to a length-1 tuple in CI, which makes a direct segments[1] access a TS2493
  // ("no element at index 1") error even though it's fine at runtime.
  const active = (segments as string[])[1] ?? (IS_BROWSER_APP ? 'browser' : 'messenger');

  // The standalone browser app shows a browser-first rail: Browser, Wallet,
  // Settings — no messenger/mail.
  const railTabs = IS_BROWSER_APP
    ? (['browser', 'wallet', 'settings'].map((k) => TABS.find((tab) => tab.key === k)!) as TabDef[])
    : TABS;

  if (collapsed) {
    return (
      <View style={styles.row}>
        <View style={styles.railCollapsed}>
          <Pressable onPress={() => setCollapsed(false)} style={styles.collapseBtn} hitSlop={8}>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </Pressable>
        </View>
        <View style={styles.content}>{children}</View>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        {railTabs.map((tab) => {
          const on = active === tab.key;
          const badge = tab.key === 'messenger' ? unreadChats : tab.key === 'mail' ? unreadMail : 0;
          return (
            <Pressable
              key={tab.key}
              onPress={() => router.push(tab.href)}
              style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]}>
              <View>
                <Ionicons name={tab.icon} size={22} color={on ? colors.accent : colors.textTertiary} />
                {badge > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.label, on && styles.labelActive]}>{t(tab.labelKey)}</Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => setCollapsed(true)}
          style={[styles.collapseBtn, styles.collapseBtnBottom]}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={16} color={colors.textTertiary} />
        </Pressable>
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
  railCollapsed: {
    width: 22,
    backgroundColor: colors.chrome,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
    alignItems: 'center',
    paddingTop: 18,
  },
  collapseBtn: { padding: 6, alignItems: 'center', justifyContent: 'center' },
  collapseBtnBottom: { marginTop: 'auto', marginBottom: 12 },
});
