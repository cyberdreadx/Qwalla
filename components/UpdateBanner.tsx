import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/constants/theme';

/**
 * MetaMask-style "update ready" banner. Expo already downloads a shipped OTA in
 * the background (and would apply it on the next cold start); this surfaces it so
 * users can apply it immediately. Also re-checks when the app returns to the
 * foreground, so long-lived sessions still get prompted.
 *
 * Native only, and only in real builds (Updates.isEnabled is false in dev /
 * Expo Go). The parent gates this to Platform.OS !== 'web'.
 */
export function UpdateBanner() {
  const { isUpdatePending } = Updates.useUpdates();
  const insets = useSafeAreaInsets();
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!Updates.isEnabled) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      Updates.checkForUpdateAsync()
        .then((res) => (res.isAvailable ? Updates.fetchUpdateAsync() : undefined))
        .catch(() => {
          /* offline / no update — ignore */
        });
    });
    return () => sub.remove();
  }, []);

  if (!Updates.isEnabled || !isUpdatePending) return null;

  async function apply() {
    setReloading(true);
    try {
      await Updates.reloadAsync();
    } catch {
      setReloading(false);
    }
  }

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 8 }]}>
      <View style={styles.inner}>
        <Ionicons name="sparkles" size={16} color={colors.bg} />
        <Text style={styles.text}>A new version of Qwalla is ready</Text>
        <Pressable
          onPress={apply}
          disabled={reloading}
          style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}>
          {reloading ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text style={styles.btnText}>Update</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 200,
    backgroundColor: colors.accent,
    paddingBottom: 10,
    paddingHorizontal: spacing.md,
  },
  inner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  text: { flex: 1, color: colors.bg, fontSize: 13, fontWeight: '700' },
  btn: {
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 7,
    minWidth: 72,
    alignItems: 'center',
  },
  btnText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
});
