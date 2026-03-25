import { StyleSheet, Text, View } from 'react-native';

import { KoalaMascot, type KoalaMood } from '@/components/KoalaMascot';
import { colors, spacing } from '@/constants/theme';

export function EmptyState({
  title,
  subtitle,
  mood = 'sleep',
}: {
  title: string;
  subtitle?: string;
  mood?: KoalaMood;
}) {
  return (
    <View style={styles.wrap}>
      <KoalaMascot mood={mood} />
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: spacing.md,
    textAlign: 'center',
  },
  sub: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: spacing.sm,
    textAlign: 'center',
    lineHeight: 18,
  },
});
