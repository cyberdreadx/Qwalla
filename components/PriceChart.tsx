import { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { colors, radius, spacing } from '@/constants/theme';

export type PricePoint = { timestamp: number; price_a_in_b?: number; price_b_in_a?: number };

type Props = {
  points: PricePoint[];
  label?: string;
  height?: number;
};

/** Format a pool price sanely across the huge range this token trades in. */
function fmtPrice(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (v >= 1) return v.toFixed(3);
  if (v >= 0.01) return v.toFixed(4);
  return v.toPrecision(2);
}

/** Catmull-Rom → cubic-bezier so the line is smooth instead of jagged. */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

export function PriceChart({ points, label = 'XRGE pool price', height = 150 }: Props) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.width;
    if (Math.abs(next - w) > 1) setW(next);
  };

  const series = useMemo(
    () =>
      points
        .map((p) => p.price_a_in_b ?? p.price_b_in_a ?? 0)
        .filter((n) => Number.isFinite(n) && n > 0),
    [points],
  );

  const stats = useMemo(() => {
    if (series.length < 2) return null;
    const first = series[0];
    const last = series[series.length - 1];
    const minV = Math.min(...series);
    const maxV = Math.max(...series);
    const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
    return { first, last, minV, maxV, changePct, up: last >= first };
  }, [series]);

  const geom = useMemo(() => {
    if (!stats || w <= 0) return null;
    const padX = 3;
    const padTop = 10;
    const padBottom = 8;
    const plotW = Math.max(w - padX * 2, 1);
    const plotH = Math.max(height - padTop - padBottom, 1);
    const lo = stats.minV;
    const hi = stats.maxV;
    const span = hi - lo || Math.abs(hi) || 1; // flat series → don't divide by zero
    const pts = series.map((v, i) => ({
      x: padX + (series.length === 1 ? plotW / 2 : (i / (series.length - 1)) * plotW),
      // 0.12 headroom top+bottom so the curve/dot never kiss the edges
      y: padTop + (1 - (v - lo) / span) * plotH * 0.82 + plotH * 0.09,
    }));
    const line = smoothPath(pts);
    const last = pts[pts.length - 1];
    const area = line
      ? `${line} L ${last.x.toFixed(2)},${height} L ${pts[0].x.toFixed(2)},${height} Z`
      : '';
    // Two faint gridlines (thirds) for depth.
    const grid = [1, 2].map((i) => padTop + (plotH / 3) * i);
    return { line, area, last, grid, padX, plotW };
  }, [stats, series, w, height]);

  if (series.length < 2) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>No chart yet</Text>
        <Text style={styles.muted}>Swap activity will populate this chart.</Text>
      </View>
    );
  }

  const trend = stats!.up ? colors.accent : colors.error;

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <View style={styles.header}>
        <View>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.price}>{fmtPrice(stats!.last)}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: trend + '1F', borderColor: trend + '55' }]}>
          <Text style={[styles.badgeText, { color: trend }]}>
            {stats!.up ? '▲' : '▼'} {Math.abs(stats!.changePct).toFixed(2)}%
          </Text>
        </View>
      </View>

      <View style={{ height }}>
        {geom ? (
          <Svg width={w} height={height}>
            <Defs>
              <LinearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={trend} stopOpacity={0.28} />
                <Stop offset="1" stopColor={trend} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            {geom.grid.map((gy, i) => (
              <Path
                key={i}
                d={`M ${geom.padX},${gy} L ${geom.padX + geom.plotW},${gy}`}
                stroke={colors.border}
                strokeWidth={1}
              />
            ))}
            <Path d={geom.area} fill="url(#priceFill)" />
            <Path
              d={geom.line}
              fill="none"
              stroke={trend}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* End marker with a soft glow ring. */}
            <Circle cx={geom.last.x} cy={geom.last.y} r={7} fill={trend} opacity={0.18} />
            <Circle cx={geom.last.x} cy={geom.last.y} r={3.5} fill={trend} />
            <Circle cx={geom.last.x} cy={geom.last.y} r={3.5} fill="none" stroke={colors.bg} strokeWidth={1.5} />
          </Svg>
        ) : null}
      </View>

      <View style={styles.row}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Low</Text>
          <Text style={styles.statValue}>{fmtPrice(stats!.minV)}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>High</Text>
          <Text style={styles.statValue}>{fmtPrice(stats!.maxV)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: spacing.xs },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  price: { color: colors.text, fontSize: 22, fontWeight: '800', marginTop: 2 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  badgeText: { fontSize: 13, fontWeight: '800' },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  stat: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  statLabel: { color: colors.textTertiary, fontSize: 11, fontWeight: '600' },
  statValue: { color: colors.text, fontSize: 14, fontWeight: '700', marginTop: 1 },
  muted: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  fallback: { paddingVertical: spacing.lg, alignItems: 'center', gap: spacing.xs },
  fallbackTitle: { color: colors.text, fontWeight: '700', fontSize: 14 },
});
