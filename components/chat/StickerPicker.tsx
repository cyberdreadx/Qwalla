import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';
import { STICKER_PACKS, type Sticker } from '@/constants/stickers';

type Props = { onSelect: (sticker: Sticker) => void };

export function StickerPicker({ onSelect }: Props) {
  const [packIdx, setPackIdx] = useState(0);
  const pack = STICKER_PACKS[packIdx];

  return (
    <View style={styles.container}>
      <View style={styles.packTabs}>
        {STICKER_PACKS.map((p, i) => (
          <Pressable
            key={p.name}
            onPress={() => setPackIdx(i)}
            style={[styles.packTab, i === packIdx && styles.packTabActive]}>
            <Text style={[styles.packLabel, i === packIdx && styles.packLabelActive]}>
              {p.name}
            </Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={pack.stickers}
        numColumns={4}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.gridRow}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.stickerCell, pressed && { opacity: 0.6 }]}
            onPress={() => onSelect(item)}>
            <Text style={styles.stickerEmoji}>{item.emoji}</Text>
            <Text style={styles.stickerLabel}>{item.label}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 260, backgroundColor: colors.chrome },
  packTabs: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  packTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  packTabActive: { backgroundColor: colors.accentDim },
  packLabel: { color: colors.textTertiary, fontSize: 12, fontWeight: '600' },
  packLabelActive: { color: colors.accent },
  grid: { padding: spacing.sm },
  gridRow: { gap: spacing.xs },
  stickerCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: radius.sm,
  },
  stickerEmoji: { fontSize: 32 },
  stickerLabel: { color: colors.textTertiary, fontSize: 10, marginTop: 4 },
});
