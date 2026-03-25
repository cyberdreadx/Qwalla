import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { NotificationType } from '@/stores/notifications';
import { colors, fontSize, radius, spacing } from '@/constants/theme';

type ToastItem = { id: string; type: NotificationType; title: string; body: string };

const DISPLAY_MS = 4000;
const SLIDE_MS = 300;

const iconMap: Record<NotificationType, { name: keyof typeof Ionicons.glyphMap; color: string }> = {
  transfer_in: { name: 'arrow-down-circle', color: colors.success },
  transfer_out: { name: 'arrow-up-circle', color: colors.warning },
  message: { name: 'chatbubble', color: colors.accent },
  mail: { name: 'mail', color: colors.purple },
  block: { name: 'cube', color: colors.textSecondary },
  info: { name: 'information-circle', color: colors.accent },
};

let pushToast: ((item: ToastItem) => void) | null = null;

export function showToast(item: ToastItem) {
  pushToast?.(item);
}

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const [queue, setQueue] = useState<ToastItem[]>([]);
  const [current, setCurrent] = useState<ToastItem | null>(null);
  const translateY = useRef(new Animated.Value(-120)).current;
  const timer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    pushToast = (item) => setQueue((q) => [...q, item]);
    return () => { pushToast = null; };
  }, []);

  useEffect(() => {
    if (current || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    setCurrent(next);
  }, [queue, current]);

  useEffect(() => {
    if (!current) return;
    translateY.setValue(-120);
    Animated.timing(translateY, {
      toValue: 0,
      duration: SLIDE_MS,
      useNativeDriver: true,
    }).start();

    timer.current = setTimeout(() => dismiss(), DISPLAY_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [current]);

  const dismiss = () => {
    Animated.timing(translateY, {
      toValue: -120,
      duration: SLIDE_MS,
      useNativeDriver: true,
    }).start(() => setCurrent(null));
  };

  if (!current) return null;

  const { name: iconName, color: iconColor } = iconMap[current.type] ?? iconMap.info;

  return (
    <Animated.View
      style={[
        styles.container,
        { top: insets.top + spacing.xs, transform: [{ translateY }] },
      ]}
      pointerEvents="box-none"
    >
      <Pressable style={styles.toast} onPress={dismiss}>
        <Ionicons name={iconName} size={22} color={iconColor} style={styles.icon} />
        <View style={styles.textWrap}>
          <Text style={styles.title} numberOfLines={1}>{current.title}</Text>
          <Text style={styles.body} numberOfLines={2}>{current.body}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: 9999,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.chrome,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    width: '100%',
    maxWidth: 420,
  },
  icon: { marginRight: spacing.sm + 2 },
  textWrap: { flex: 1 },
  title: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  body: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
});
