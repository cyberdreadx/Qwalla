import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius } from '@/constants/theme';
import { useT, type Lang } from '@/lib/i18n';

/**
 * Compact EN | ES pill for switching language mid-flow (e.g. during onboarding,
 * before a user reaches Settings). Reads/writes the shared language store, so it
 * stays in sync with the Settings picker and persists.
 */
export function LangSwitch({ style }: { style?: StyleProp<ViewStyle> }) {
  const { lang, setLang } = useT();
  const langs: Lang[] = ['en', 'es'];
  return (
    <View style={[styles.wrap, style]}>
      {langs.map((l) => (
        <Pressable
          key={l}
          onPress={() => setLang(l)}
          hitSlop={6}
          style={({ pressed }) => [
            styles.opt,
            lang === l && styles.optActive,
            pressed && { opacity: 0.7 },
          ]}>
          <Text style={[styles.txt, lang === l && styles.txtActive]}>{l.toUpperCase()}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.full,
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
  opt: { paddingHorizontal: 10, paddingVertical: 4 },
  optActive: { backgroundColor: colors.surface },
  txt: { color: colors.textTertiary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  txtActive: { color: colors.text },
});
