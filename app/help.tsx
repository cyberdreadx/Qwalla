import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/constants/theme';
import { useT } from '@/lib/i18n';
import { HELP_SECTIONS } from '@/lib/help-content';
import { useSettingsStore } from '@/stores/settings';

export default function HelpScreen() {
  const { t } = useT();
  const setSeenTutorial = useSettingsStore((s) => s.setSeenTutorial);

  const replay = async () => {
    // Re-arm the first-run tour (mounted in the tabs layout) and return to it.
    await setSeenTutorial(false);
    router.back();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: t('help_title'), headerShown: true }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {HELP_SECTIONS.map((s) => (
          <View key={s.id} style={styles.card}>
            <View style={styles.head}>
              <View style={styles.iconWrap}>
                <Ionicons name={s.icon} size={18} color={colors.accent} />
              </View>
              <Text style={styles.title}>{t(s.titleKey)}</Text>
            </View>
            <Text style={styles.body}>{t(s.bodyKey)}</Text>
          </View>
        ))}

        <Pressable onPress={replay} style={({ pressed }) => [styles.replay, pressed && { opacity: 0.85 }]}>
          <Ionicons name="play-circle-outline" size={18} color={colors.accent} />
          <Text style={styles.replayText}>{t('tour_replay')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.chrome,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.sm },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.accentDim ?? 'rgba(0,206,182,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', flex: 1 },
  body: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
  replay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  replayText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
});
