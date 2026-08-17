import { useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

export type WordCount = 12 | 24;

interface Props {
  /** Backing store is always length 24; only the first `count` are rendered. */
  words: string[];
  count: WordCount;
  onWordsChange: (next: string[]) => void;
  onCountChange: (count: WordCount) => void;
}

const COUNTS: WordCount[] = [12, 24];

/**
 * Numbered recovery-phrase entry: one small input per word in a 2-column grid.
 * Pasting a whole phrase into any box splits it across the following boxes (and
 * expands to 24 words if needed); typing a space jumps to the next box.
 */
export function MnemonicInput({ words, count, onWordsChange, onCountChange }: Props) {
  const refs = useRef<Array<TextInput | null>>([]);

  function focusAt(index: number) {
    if (index >= 0 && index < count) refs.current[index]?.focus();
    else refs.current[Math.min(index, 23)]?.blur();
  }

  function setWord(index: number, text: string) {
    const tokens = text.trim().split(/\s+/).filter(Boolean);

    // Multi-word paste: distribute tokens across boxes from `index` onward.
    if (tokens.length > 1) {
      const next = [...words];
      tokens.forEach((tok, i) => {
        const pos = index + i;
        if (pos < 24) next[pos] = tok.toLowerCase();
      });
      onWordsChange(next);
      const filledTo = index + tokens.length; // one past the last filled box
      if (filledTo > 12 && count !== 24) onCountChange(24);
      // Reveal the grid rather than leaving the keyboard over it.
      refs.current[index]?.blur();
      return;
    }

    const hadTrailingSpace = /\s$/.test(text);
    const next = [...words];
    next[index] = (tokens[0] ?? '').toLowerCase();
    onWordsChange(next);
    if (hadTrailingSpace) focusAt(index + 1);
  }

  return (
    <View>
      <View style={styles.countRow}>
        {COUNTS.map((c) => (
          <Pressable
            key={c}
            onPress={() => onCountChange(c)}
            style={[styles.countTab, count === c && styles.countTabActive]}>
            <Text style={[styles.countLabel, count === c && styles.countLabelActive]}>
              {c} words
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.grid}>
        {Array.from({ length: count }).map((_, i) => (
          <View key={i} style={styles.cell}>
            <Text style={styles.num}>{i + 1}</Text>
            <TextInput
              ref={(r) => {
                refs.current[i] = r;
              }}
              style={styles.input}
              value={words[i] ?? ''}
              onChangeText={(t) => setWord(i, t)}
              onSubmitEditing={() => focusAt(i + 1)}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              autoComplete="off"
              textContentType="none"
              keyboardType="ascii-capable"
              returnKeyType={i === count - 1 ? 'done' : 'next'}
              blurOnSubmit={i === count - 1}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  countRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 3,
    marginBottom: spacing.md,
  },
  countTab: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
  },
  countTabActive: { backgroundColor: colors.chrome },
  countLabel: { color: colors.textTertiary, fontWeight: '600', fontSize: 12 },
  countLabelActive: { color: colors.accent },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  cell: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.sm,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 10,
  },
  num: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '700',
    minWidth: 18,
    textAlign: 'right',
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    paddingVertical: 10,
  },
});
