import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, type DimensionValue, type ViewStyle } from 'react-native';

import { colors, radius as themeRadius } from '@/constants/theme';

type SkeletonProps = {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: ViewStyle | ViewStyle[];
};

/**
 * A single pulsing placeholder block. Used to show layout-stable loading state
 * instead of empty space or a lone spinner while data streams in. Honors the
 * OS "reduce motion" setting by holding a static dimmed block.
 */
export function Skeleton({ width = '100%', height = 16, radius = themeRadius.sm, style }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled || reduced) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 750, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.5, duration: 750, useNativeDriver: true }),
        ]),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [opacity]);

  return (
    <Animated.View
      style={[{ width, height, borderRadius: radius, backgroundColor: colors.surface, opacity }, style]}
    />
  );
}

/** A stack of skeleton "rows" (icon + two text lines) for list placeholders. */
export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <Animated.View key={i} style={styles.row}>
          <Skeleton width={28} height={28} radius={14} />
          <Animated.View style={styles.rowText}>
            <Skeleton width="45%" height={13} />
            <Skeleton width="28%" height={11} />
          </Animated.View>
          <Skeleton width={64} height={14} />
        </Animated.View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11 },
  rowText: { flex: 1, gap: 6 },
});
