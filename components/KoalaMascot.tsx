import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '@/constants/theme';

export type KoalaMood = 'wave' | 'sleep' | 'think' | 'happy' | 'oops';

const emoji: Record<KoalaMood, string> = {
  wave: '🐨',
  sleep: '😴',
  think: '🔄',
  happy: '✅',
  oops: '⚠️',
};

const captions: Record<KoalaMood, string> = {
  wave: 'Quantum-safe vibes',
  sleep: 'Nothing here yet',
  think: 'Syncing qubits…',
  happy: 'Nice!',
  oops: 'Something went wrong',
};

export function KoalaMascot({ mood = 'wave', size = 56 }: { mood?: KoalaMood; size?: number }) {
  return (
    <View style={styles.wrap}>
      <View style={[styles.ring, { width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={{ fontSize: size * 0.45 }}>{emoji[mood]}</Text>
      </View>
      <Text style={styles.caption}>{captions[mood]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  ring: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accentMid,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  caption: {
    color: colors.textTertiary,
    fontSize: 12,
    textAlign: 'center',
  },
});
