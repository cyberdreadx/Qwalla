import { useMemo } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';

import { colors, spacing } from '@/constants/theme';

export type PricePoint = { timestamp: number; price_a_in_b?: number; price_b_in_a?: number };

type Props = {
  points: PricePoint[];
  label?: string;
  height?: number;
};

export function PriceChart({ points, label = 'XRGE pool price', height = 140 }: Props) {
  const w = Dimensions.get('window').width - spacing.lg * 2;
  const series = useMemo(() => {
    const vals = points
      .map((p) => p.price_a_in_b ?? p.price_b_in_a ?? 0)
      .filter((n) => Number.isFinite(n) && n > 0);
    return vals;
  }, [points]);

  const { polyline, min, max } = useMemo(() => {
    if (series.length < 2) {
      return { polyline: '', min: 0, max: 0 };
    }
    const minV = Math.min(...series);
    const maxV = Math.max(...series);
    const pad = (maxV - minV) * 0.08 || 0.01;
    const lo = minV - pad;
    const hi = maxV + pad;
    const pts = series.map((v, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = height - ((v - lo) / (hi - lo)) * height;
      return `${x},${y}`;
    });
    return { polyline: pts.join(' '), min: minV, max: maxV };
  }, [series, w, height]);

  if (series.length < 2) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>No chart yet</Text>
        <Text style={styles.muted}>Swap activity will populate this sparkline.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Svg width={w} height={height}>
        <Polyline
          points={polyline}
          fill="none"
          stroke={colors.accent}
          strokeWidth={2}
        />
      </Svg>
      <View style={styles.row}>
        <Text style={styles.muted}>Low {min.toFixed(6)}</Text>
        <Text style={styles.muted}>High {max.toFixed(6)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: spacing.sm },
  label: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.sm, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  muted: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  fallback: { paddingVertical: spacing.lg, alignItems: 'center', gap: spacing.xs },
  fallbackTitle: { color: colors.text, fontWeight: '700', fontSize: 14 },
});
