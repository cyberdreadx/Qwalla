import type { ReactNode } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import { colors } from '@/constants/theme';

/**
 * Presents the mobile-first app as a centered, phone-width column on wide web
 * viewports (desktop / Electron), so it reads as an intentional app rather than
 * a stretched phone screen. It is a pass-through on native and on narrow web
 * (mobile browsers / PWA), so those layouts are unchanged.
 *
 * This is the responsive shell only — individual screens keep their existing
 * layouts inside the column. True desktop-optimized screens (multi-column,
 * sidebars) would be a per-screen follow-up.
 */

// Below this width, behave exactly like mobile (full-bleed). Above it, frame.
const DESKTOP_BREAKPOINT = 700;
// Phone-like column width on desktop.
const APP_MAX_WIDTH = 480;

export function DesktopFrame({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();

  if (Platform.OS !== 'web' || width < DESKTOP_BREAKPOINT) {
    return <>{children}</>;
  }

  return (
    <View style={styles.backdrop}>
      <View style={styles.frame}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    // Noticeably darker than the app bg so the centered column reads as a
    // raised panel rather than content stranded in a void.
    backgroundColor: '#04060A',
  },
  frame: {
    flex: 1,
    width: '100%',
    maxWidth: APP_MAX_WIDTH,
    backgroundColor: colors.bg,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    // Soft edge shadow (react-native-web maps these to box-shadow) so the panel
    // lifts off the backdrop on desktop.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 48,
    shadowOpacity: 0.55,
  },
});
