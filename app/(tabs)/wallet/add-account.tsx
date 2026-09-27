import { Ionicons } from '@expo/vector-icons';
import { useHeaderHeight } from '@react-navigation/elements';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { colors, radius, spacing } from '@/constants/theme';
import { useT } from '@/lib/i18n';
import { useWalletStore } from '@/stores/wallet';

export default function AddAccountScreen() {
  const { t } = useT();
  const headerHeight = useHeaderHeight();
  const addAccount = useWalletStore((s) => s.addAccount);
  const [name, setName] = useState('');
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState<null | 'create' | 'import'>(null);

  async function run(spec: Parameters<typeof addAccount>[0], which: 'create' | 'import') {
    setBusy(which);
    try {
      await addAccount(spec);
      router.back();
    } catch (e) {
      Alert.alert(t('w_acct_add_failed'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding" keyboardVerticalOffset={headerHeight}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.heading}>{t('w_acct_add')}</Text>
          <Text style={styles.hint}>{t('w_acct_add_hint')}</Text>

          {/* Create new */}
          <Card style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
              <Text style={styles.cardTitle}>{t('w_acct_create')}</Text>
            </View>
            <Field
              label={t('w_acct_name_label')}
              value={name}
              onChangeText={setName}
              placeholder={t('w_acct_name_ph')}
            />
            <Button
              title={t('w_acct_create_btn')}
              loading={busy === 'create'}
              disabled={busy !== null}
              onPress={() => run({ kind: 'create', displayName: name.trim() || 'Account' }, 'create')}
            />
          </Card>

          {/* Import with phrase */}
          <Card style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name="key-outline" size={18} color={colors.accent} />
              <Text style={styles.cardTitle}>{t('w_acct_import')}</Text>
            </View>
            <Field
              label={t('w_acct_phrase_label')}
              value={phrase}
              onChangeText={setPhrase}
              placeholder={t('w_acct_phrase_ph')}
              autoCapitalize="none"
              multiline
              style={styles.phrase}
            />
            <Button
              title={t('w_acct_import_btn')}
              variant="secondary"
              loading={busy === 'import'}
              disabled={busy !== null || !phrase.trim()}
              onPress={() => run({ kind: 'mnemonic', mnemonic: phrase, displayName: name.trim() || 'Account' }, 'import')}
            />
          </Card>

          <View style={styles.note}>
            <Ionicons name="information-circle-outline" size={14} color={colors.textTertiary} />
            <Text style={styles.noteText}>{t('w_acct_add_note')}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  heading: { color: colors.text, fontSize: 24, fontWeight: '800' },
  hint: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: spacing.sm },
  card: { gap: spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.xs },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  phrase: { minHeight: 80 },
  note: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: spacing.xs },
  noteText: { color: colors.textTertiary, fontSize: 12, flex: 1, lineHeight: 17 },
});
