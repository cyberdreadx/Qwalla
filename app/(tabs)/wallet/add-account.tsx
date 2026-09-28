import { Ionicons } from '@expo/vector-icons';
import { useHeaderHeight } from '@react-navigation/elements';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { colors, radius, spacing } from '@/constants/theme';
import { decryptBackup } from '@/lib/encrypted-backup';
import { useT } from '@/lib/i18n';
import { useWalletStore } from '@/stores/wallet';

export default function AddAccountScreen() {
  const { t } = useT();
  const headerHeight = useHeaderHeight();
  const addAccount = useWalletStore((s) => s.addAccount);
  const [name, setName] = useState('');
  const [phrase, setPhrase] = useState('');
  const [backupJson, setBackupJson] = useState('');
  const [backupFileName, setBackupFileName] = useState('');
  const [backupPassword, setBackupPassword] = useState('');
  const [busy, setBusy] = useState<null | 'create' | 'import' | 'backup'>(null);

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

  async function pickBackupFile() {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pqcbackup,.json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        setBackupFileName(file.name);
        setBackupJson(await file.text());
      };
      input.click();
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'application/octet-stream', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setBackupFileName(asset.name);
      setBackupJson(
        await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 }),
      );
    } catch (e) {
      Alert.alert(t('w_acct_add_failed'), e instanceof Error ? e.message : String(e));
    }
  }

  async function runBackup() {
    setBusy('backup');
    try {
      const payload = await decryptBackup(backupJson, backupPassword.trim());
      await addAccount({
        kind: 'backup',
        payload: { ...payload, displayName: payload.displayName || name.trim() || 'Account' },
      });
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

          {/* Restore from backup file — brings back messages too (seed alone can't). */}
          <Card style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name="document-lock-outline" size={18} color={colors.accent} />
              <Text style={styles.cardTitle}>{t('w_acct_backup')}</Text>
            </View>
            <Button
              title={backupFileName || t('w_acct_backup_pick')}
              variant="secondary"
              disabled={busy !== null}
              onPress={pickBackupFile}
            />
            {backupJson ? (
              <Field
                label={t('w_acct_backup_pwd_label')}
                value={backupPassword}
                onChangeText={setBackupPassword}
                placeholder={t('w_acct_backup_pwd_ph')}
                secureTextEntry
                autoCapitalize="none"
              />
            ) : null}
            <Button
              title={t('w_acct_backup_btn')}
              loading={busy === 'backup'}
              disabled={busy !== null || !backupJson || !backupPassword.trim()}
              onPress={runBackup}
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
