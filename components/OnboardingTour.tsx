import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/constants/theme';
import { useT } from '@/lib/i18n';
import { HELP_SECTIONS } from '@/lib/help-content';

/**
 * First-run guided tour: pages through the shared HELP_SECTIONS (welcome → each
 * tab → security → backup). Shown once (gated by settings.seenTutorial); also
 * replayable from the Help screen.
 */
export function OnboardingTour({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useT();
  const [page, setPage] = useState(0);
  const last = HELP_SECTIONS.length - 1;
  const section = HELP_SECTIONS[Math.min(page, last)];

  const next = () => {
    if (page >= last) {
      finish();
    } else {
      setPage((p) => p + 1);
    }
  };
  const finish = () => {
    setPage(0);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent={false} onRequestClose={finish}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.topBar}>
          <Text style={styles.step}>
            {page + 1} / {HELP_SECTIONS.length}
          </Text>
          <Pressable onPress={finish} hitSlop={8} style={({ pressed }) => pressed && { opacity: 0.6 }}>
            <Text style={styles.skip}>{t('tour_skip')}</Text>
          </Pressable>
        </View>

        <View style={styles.body}>
          <View style={styles.iconWrap}>
            <Ionicons name={section.icon} size={44} color={colors.accent} />
          </View>
          <Text style={styles.title}>{t(section.titleKey)}</Text>
          <Text style={styles.text}>{t(section.bodyKey)}</Text>
        </View>

        <View style={styles.dots}>
          {HELP_SECTIONS.map((s, i) => (
            <View key={s.id} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>

        <View style={styles.actions}>
          {page > 0 ? (
            <Pressable
              onPress={() => setPage((p) => p - 1)}
              style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}>
              <Text style={styles.backText}>{t('tour_back')}</Text>
            </Pressable>
          ) : (
            <View style={styles.backBtn} />
          )}
          <Pressable
            onPress={next}
            style={({ pressed }) => [styles.nextBtn, pressed && { opacity: 0.85 }]}>
            <Text style={styles.nextText}>{page >= last ? t('tour_done') : t('tour_next')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
  step: { color: colors.textTertiary, fontSize: 13, fontWeight: '600' },
  skip: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.lg },
  iconWrap: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.accentDim ?? 'rgba(0,206,182,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  text: { color: colors.textSecondary, fontSize: 15, lineHeight: 23, textAlign: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: spacing.lg },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.accent, width: 20 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingBottom: spacing.lg },
  backBtn: { flex: 1, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  backText: { color: colors.textSecondary, fontSize: 16, fontWeight: '600' },
  nextBtn: {
    flex: 2,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextText: { color: colors.bg, fontSize: 16, fontWeight: '700' },
});
