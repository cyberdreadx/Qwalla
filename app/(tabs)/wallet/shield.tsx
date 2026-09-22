import { Ionicons } from '@expo/vector-icons';
import { useHeaderHeight } from '@react-navigation/elements';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import WebView from 'react-native-webview';

import { Card } from '@/components/ui/Card';
import { TokenIcon } from '@/components/wallet/TokenIcon';
import { colors, fontSize, radius, spacing } from '@/constants/theme';
import { formatNumber } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { rc } from '@/lib/rougechain';
import { saveNote, getActiveNotes, getShieldedBalance, importNote, markSpent, type StoredNote } from '@/lib/note-store';
import { useStarkProver } from '@/lib/stark-prover';
import { useWalletStore } from '@/stores/wallet';

const SHIELD_FEE = 1;

export default function ShieldScreen() {
  const { t } = useT();
  const headerHeight = useHeaderHeight();
  const wallet = useWalletStore((s) => s.wallet);
  const { webViewRef, onMessage, proveUnshield, ready: proverReady, proverUrl } = useStarkProver();
  const [tab, setTab] = useState<'shield' | 'unshield'>('shield');
  const [balance, setBalance] = useState(0);
  const [shieldedBal, setShieldedBal] = useState(0);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<StoredNote[]>([]);
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [sentNote, setSentNote] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!wallet) return;
    try {
      const b = await rc.getBalance(wallet.publicKey);
      setBalance(typeof b.balance === 'number' ? b.balance : Number(b.balance));
      const sb = await getShieldedBalance(wallet.publicKey);
      setShieldedBal(sb);
      const activeNotes = await getActiveNotes(wallet.publicKey);
      setNotes(activeNotes);
    } catch { /* ignore */ }
  }, [wallet]);

  useEffect(() => { void loadData(); }, [loadData]);

  async function handleShield() {
    if (!wallet) return;
    const amt = parseInt(amount, 10);
    if (isNaN(amt) || amt <= 0) {
      Alert.alert(t('wshield_invalidAmount'));
      return;
    }
    if (amt + SHIELD_FEE > balance) {
      Alert.alert(
        t('wshield_insufficientBalance'),
        t('wshield_insufficientBalanceMsg')
          .replace('{total}', String(amt + SHIELD_FEE))
          .replace('{fee}', String(SHIELD_FEE)),
      );
      return;
    }
    setLoading(true);
    try {
      const result = await rc.shielded.shield(wallet as any, { amount: amt });
      if (!result.success) throw new Error(result.error || t('wshield_shieldFailed'));
      if (result.note) {
        await saveNote(result.note);
        setSentNote(JSON.stringify(result.note, null, 2));
      }
      setAmount('');
      await loadData();
    } catch (e) {
      Alert.alert(t('wshield_error'), e instanceof Error ? e.message : t('wshield_shieldFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handleUnshield(note: StoredNote) {
    if (!wallet) return;
    if (!proverReady) {
      Alert.alert(t('wshield_loading'), t('wshield_proverLoading'));
      return;
    }
    setLoading(true);
    try {
      const proof = await proveUnshield(note.value);
      const result = await rc.shielded.unshield(wallet as any, {
        nullifiers: [note.nullifier],
        amount: note.value,
        proof,
      });
      if (!result.success) throw new Error(result.error || t('wshield_unshieldFailed'));
      await markSpent(note.nullifier);
      Alert.alert(
        t('wshield_success'),
        t('wshield_unshieldedMsg').replace('{amount}', formatNumber(note.value)),
      );
      await loadData();
    } catch (e) {
      Alert.alert(t('wshield_error'), e instanceof Error ? e.message : t('wshield_unshieldFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!wallet) return;
    try {
      const stored = await importNote(importText.trim(), wallet.publicKey);
      Alert.alert(
        t('wshield_imported'),
        t('wshield_importedMsg').replace('{amount}', formatNumber(stored.value)),
      );
      setImportText('');
      setShowImport(false);
      await loadData();
    } catch (e) {
      Alert.alert(t('wshield_importFailed'), e instanceof Error ? e.message : t('wshield_invalidNote'));
    }
  }

  if (!wallet) return null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('wshield_shieldedTitle')}</Text>
        <View style={{ width: 22 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={headerHeight}>
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Balances */}
          <Card style={styles.balCard}>
            <View style={styles.balRow}>
              <View style={styles.balCol}>
                <Text style={styles.balLabel}>{t('wshield_publicBalance')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <TokenIcon symbol="XRGE" size={20} />
                  <Text style={styles.balValue}>{formatNumber(balance)} XRGE</Text>
                </View>
              </View>
              <View style={styles.balCol}>
                <Text style={styles.balLabel}>{t('wshield_shieldedBalance')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <Ionicons name="shield-checkmark" size={16} color={colors.accent} />
                  <Text style={[styles.balValue, { color: colors.accent }]}>
                    {formatNumber(shieldedBal)} XRGE
                  </Text>
                </View>
              </View>
            </View>
          </Card>

          {/* Tabs */}
          <View style={styles.tabs}>
            <Pressable
              onPress={() => setTab('shield')}
              style={[styles.tab, tab === 'shield' && styles.tabActive]}>
              <Text style={[styles.tabText, tab === 'shield' && styles.tabTextActive]}>{t('wshield_tabShield')}</Text>
            </Pressable>
            <Pressable
              onPress={() => setTab('unshield')}
              style={[styles.tab, tab === 'unshield' && styles.tabActive]}>
              <Text style={[styles.tabText, tab === 'unshield' && styles.tabTextActive]}>{t('wshield_tabUnshield')}</Text>
            </Pressable>
          </View>

          {tab === 'shield' ? (
            <>
              {sentNote ? (
                <Card style={styles.noteCard}>
                  <View style={styles.noteHeader}>
                    <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                    <Text style={styles.noteTitle}>{t('wshield_shieldedSuccess')}</Text>
                  </View>
                  <Text style={styles.noteHint}>
                    {t('wshield_saveNoteHint')}
                  </Text>
                  <ScrollView horizontal style={styles.noteJsonScroll}>
                    <Text style={styles.noteJson} selectable>{sentNote}</Text>
                  </ScrollView>
                  <View style={styles.noteActions}>
                    <Pressable
                      onPress={async () => {
                        await Clipboard.setStringAsync(sentNote);
                        Alert.alert(t('wshield_copied'), t('wshield_copiedMsg'));
                      }}
                      style={styles.noteBtn}>
                      <Ionicons name="copy-outline" size={16} color={colors.accent} />
                      <Text style={styles.noteBtnText}>{t('wshield_copy')}</Text>
                    </Pressable>
                    <Pressable onPress={() => setSentNote(null)} style={styles.noteBtn}>
                      <Ionicons name="close" size={16} color={colors.textSecondary} />
                      <Text style={[styles.noteBtnText, { color: colors.textSecondary }]}>{t('wshield_dismiss')}</Text>
                    </Pressable>
                  </View>
                </Card>
              ) : (
                <Card>
                  <Text style={styles.inputLabel}>{t('wshield_amountToShield')}</Text>
                  <View style={styles.inputRow}>
                    <TextInput
                      style={styles.input}
                      value={amount}
                      onChangeText={setAmount}
                      placeholder="0"
                      placeholderTextColor={colors.textTertiary}
                      keyboardType="number-pad"
                    />
                    <Text style={styles.inputSuffix}>XRGE</Text>
                  </View>
                  <Text style={styles.feeHint}>{t('wshield_fee')}: {SHIELD_FEE} XRGE</Text>
                  <Pressable
                    onPress={handleShield}
                    disabled={loading}
                    style={[styles.primaryBtn, loading && { opacity: 0.5 }]}>
                    {loading ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <>
                        <Ionicons name="shield-checkmark" size={18} color="#fff" />
                        <Text style={styles.primaryBtnText}>{t('wshield_shieldXrgeBtn')}</Text>
                      </>
                    )}
                  </Pressable>
                </Card>
              )}
            </>
          ) : (
            <>
              {/* Import */}
              <Pressable onPress={() => setShowImport(!showImport)} style={styles.importToggle}>
                <Ionicons name="download-outline" size={16} color={colors.accent} />
                <Text style={styles.importToggleText}>{t('wshield_importFromJson')}</Text>
              </Pressable>

              {showImport && (
                <Card style={{ marginBottom: spacing.md }}>
                  <TextInput
                    style={styles.importInput}
                    value={importText}
                    onChangeText={setImportText}
                    placeholder={t('wshield_pasteJsonPlaceholder')}
                    placeholderTextColor={colors.textTertiary}
                    multiline
                    numberOfLines={4}
                  />
                  <Pressable
                    onPress={handleImport}
                    disabled={!importText.trim()}
                    style={[styles.primaryBtn, !importText.trim() && { opacity: 0.4 }]}>
                    <Text style={styles.primaryBtnText}>{t('wshield_importNoteBtn')}</Text>
                  </Pressable>
                </Card>
              )}

              {/* Note list */}
              {notes.length === 0 ? (
                <Card>
                  <View style={styles.empty}>
                    <Ionicons name="shield-outline" size={28} color={colors.textTertiary} />
                    <Text style={styles.emptyText}>{t('wshield_noShieldedNotes')}</Text>
                    <Text style={styles.emptyHint}>
                      {t('wshield_noNotesHint')}
                    </Text>
                  </View>
                </Card>
              ) : (
                notes.map((note) => (
                  <Card key={note.nullifier} style={styles.noteListCard}>
                    <View style={styles.noteListRow}>
                      <TokenIcon symbol="XRGE" size={28} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.noteListAmt}>{formatNumber(note.value)} XRGE</Text>
                        <Text style={styles.noteListHash} numberOfLines={1}>
                          {note.commitment.slice(0, 16)}…
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => handleUnshield(note)}
                        disabled={loading}
                        style={styles.unshieldBtn}>
                        {loading ? (
                          <ActivityIndicator size="small" color={colors.accent} />
                        ) : (
                          <Text style={styles.unshieldBtnText}>{t('wshield_unshieldBtn')}</Text>
                        )}
                      </Pressable>
                    </View>
                  </Card>
                ))
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Hidden WebView for STARK proof generation (WASM) */}
      <WebView
        ref={webViewRef}
        source={{ uri: proverUrl }}
        onMessage={onMessage}
        style={{ width: 0, height: 0, position: 'absolute', opacity: 0 }}
        javaScriptEnabled
        originWhitelist={['*']}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  headerTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  balCard: { marginBottom: spacing.md },
  balRow: { flexDirection: 'row', gap: spacing.md },
  balCol: { flex: 1 },
  balLabel: { color: colors.textTertiary, fontSize: 11, fontWeight: '600', marginBottom: 4 },
  balValue: { color: colors.text, fontSize: 16, fontWeight: '700' },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 3,
    marginBottom: spacing.md,
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: radius.sm },
  tabActive: { backgroundColor: colors.accent },
  tabText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  inputLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: 8,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    paddingVertical: 12,
  },
  inputSuffix: { color: colors.textTertiary, fontSize: 14, fontWeight: '600' },
  feeHint: { color: colors.textTertiary, fontSize: 11, marginBottom: spacing.md },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
    marginTop: 4,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  noteCard: { marginBottom: spacing.md },
  noteHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  noteTitle: { color: colors.success, fontSize: 15, fontWeight: '700' },
  noteHint: { color: colors.textSecondary, fontSize: 12, marginBottom: 12 },
  noteJsonScroll: { marginBottom: 12 },
  noteJson: {
    color: colors.text,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: 'rgba(0,0,0,0.3)',
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  noteActions: { flexDirection: 'row', gap: spacing.md },
  noteBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noteBtnText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  importToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  importToggleText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  importInput: {
    color: colors.text,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: radius.sm,
    padding: spacing.sm,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: spacing.sm,
  },
  empty: { alignItems: 'center', paddingVertical: spacing.lg, gap: 8 },
  emptyText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  emptyHint: { color: colors.textTertiary, fontSize: 12, textAlign: 'center', paddingHorizontal: spacing.md },
  noteListCard: { marginBottom: 8 },
  noteListRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  noteListAmt: { color: colors.text, fontSize: 16, fontWeight: '700' },
  noteListHash: { color: colors.textTertiary, fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 2 },
  unshieldBtn: {
    backgroundColor: 'rgba(31,224,197,0.12)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  unshieldBtnText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
});
