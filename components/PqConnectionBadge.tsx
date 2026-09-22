import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing, radius, fontSize } from '@/constants/theme';
import { checkPostQuantumKex, type PqKexResult } from '@qwalla/core/pq';

/**
 * Shows the TLS key-exchange group the browser actually negotiated, and whether
 * it is post-quantum. Desktop-oriented: it verifies the `PostQuantumKyber`
 * switch in the Electron shell is taking effect. Deliberately scoped to the
 * connection layer — it does not claim certificates or the wider web are
 * quantum-safe.
 */
export default function PqConnectionBadge() {
  const [result, setResult] = useState<PqKexResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    checkPostQuantumKex().then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pq = result?.postQuantum === true;
  const accent = result == null ? colors.textSecondary : pq ? colors.success : colors.warning;

  return (
    <View style={[styles.card, { borderColor: `${accent}55` }]}>
      <View style={[styles.iconWrap, { backgroundColor: `${accent}18` }]}>
        <Ionicons
          name={result == null ? 'shield-outline' : pq ? 'shield-checkmark' : 'shield-half'}
          size={20}
          color={accent}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Connection security</Text>
        {result == null ? (
          <View style={styles.row}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
            <Text style={styles.sub}>Checking key exchange…</Text>
          </View>
        ) : result.error ? (
          <Text style={styles.sub}>Couldn&apos;t verify the connection.</Text>
        ) : (
          <>
            <Text style={[styles.status, { color: accent }]}>
              {pq ? 'Post-quantum key exchange active' : 'Classical key exchange'}
            </Text>
            <Text style={styles.sub}>
              {result.kex ? `TLS group: ${result.kex}` : 'Key-exchange group unavailable'}
              {' · connection layer only'}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    width: '100%',
    maxWidth: 520,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700', marginBottom: 2 },
  status: { fontSize: fontSize.sm, fontWeight: '600' },
  sub: { color: colors.textTertiary, fontSize: fontSize.xs, marginTop: 2 },
});
