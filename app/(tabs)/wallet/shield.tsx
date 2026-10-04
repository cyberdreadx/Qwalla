import { Ionicons } from '@expo/vector-icons';
import { useHeaderHeight } from '@react-navigation/elements';
import * as Clipboard from 'expo-clipboard';
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
import { colors, radius, spacing } from '@/constants/theme';
import { formatNumber } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { rc } from '@/lib/rougechain';
import {
  saveNote,
  getActiveNotes,
  getShieldedBalance,
  importNote,
  markSpent,
  getSentNotes,
  sentNoteToJson,
  type StoredNote,
  type SentNote,
} from '@/lib/note-store';
import { useStarkProver } from '@/lib/stark-prover';
import { useWalletStore } from '@/stores/wallet';

const SHIELD_FEE = 1;

export default function ShieldScreen() {
  const { t } = useT();
  const headerHeight = useHeaderHeight();
  const wallet = useWalletStore((s) => s.wallet);
  const { webViewRef, onMessage, proveUnshield, ready: proverReady, proverUrl } = useStarkProver();
  const [tab, setTab] = useState<'shield' | 'unshield' | 'sent'>('shield');
  const [balance, setBalance] = useState(0);
  const [shieldedBal, setShieldedBal] = useState(0);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<StoredNote[]>([]);
  const [sentNotes, setSentNotes] = useState<SentNote[]>([]);
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
      setSentNotes(await getSentNotes(wallet.publicKey));
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
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={headerHeight}>
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Shielded balance is the point of this screen, so it's the hero;
              the public balance sits underneath as context. */}
          <Card style={styles.balCard}>
            <View style={styles.balHeroRow}>
              <View style={styles.shieldGlyph}>
                <Ionicons name="shield-checkmark" size={24} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.balLabel}>{t('wshield_shieldedBalance')}</Text>
                <Text style={styles.balHeroValue}>{formatNumber(shieldedBal)} XRGE</Text>
              </View>
            </View>
            <View style={styles.balDivider} />
            <View style={styles.balSubRow}>
              <Text style={styles.balSubLabel}>{t('wshield_publicBalance')}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <TokenIcon symbol="XRGE" size={18} />
                <Text style={styles.balSubValue}>{formatNumber(balance)} XRGE</Text>
              </View>
            </View>
          </Card>

          {/* Tabs */}
          <View style={styles.tabs}>
            {([
              { key: 'shield', icon: 'shield-checkmark', label: t('wshield_tabShield') },
              { key: 'unshield', icon: 'lock-open', label: t('wshield_tabUnshield') },
              { key: 'sent', icon: 'paper-plane', label: t('wshield_tabSent') },
            ] as const).map((tb) => {
              const active = tab === tb.key;
              return (
                <Pressable
                  key={tb.key}
                  onPress={() => setTab(tb.key)}
                  style={[styles.tab, active && styles.tabActive]}>
                  <Ionicons
                    name={tb.icon}
                    size={14}
                    color={active ? '#fff' : colors.textTertiary}
                  />
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>{tb.label}</Text>
                </Pressable>
              );
            })}
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
                  <View style={styles.inputLabelRow}>
                    <Text style={styles.inputLabel}>{t('wshield_amountToShield')}</Text>
                    <Pressable
                      hitSlop={8}
                      onPress={() => setAmount(String(Math.max(0, Math.floor(balance - SHIELD_FEE))))}>
                      <Text style={styles.maxBtn}>{t('wshield_max')}</Text>
                    </Pressable>
                  </View>
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
                  {(() => {
                    const amt = parseInt(amount, 10);
                    const valid = !isNaN(amt) && amt > 0;
                    return (
                      <View style={styles.summaryBox}>
                        <View style={styles.summaryRow}>
                          <Text style={styles.summaryLabel}>{t('wshield_fee')}</Text>
                          <Text style={styles.summaryValue}>{SHIELD_FEE} XRGE</Text>
                        </View>
                        <View style={styles.summaryRow}>
                          <Text style={styles.summaryLabel}>{t('wshield_total')}</Text>
                          <Text style={[styles.summaryValue, styles.summaryTotal]}>
                            {valid ? formatNumber(amt + SHIELD_FEE) : '—'} XRGE
                          </Text>
                        </View>
                      </View>
                    );
                  })()}
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
          ) : tab === 'unshield' ? (
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
          ) : (
            <>
              <Text style={styles.sentIntro}>{t('wshield_sentIntro')}</Text>
              {sentNotes.length === 0 ? (
                <Card>
                  <View style={styles.empty}>
                    <Ionicons name="paper-plane-outline" size={28} color={colors.textTertiary} />
                    <Text style={styles.emptyText}>{t('wshield_noSentNotes')}</Text>
                    <Text style={styles.emptyHint}>{t('wshield_noSentNotesHint')}</Text>
                  </View>
                </Card>
              ) : (
                sentNotes.map((note) => {
                  const json = sentNoteToJson(note);
                  return (
                    <Card key={note.commitment} style={styles.noteListCard}>
                      <View style={styles.noteListRow}>
                        <TokenIcon symbol="XRGE" size={28} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.noteListAmt}>{formatNumber(note.value)} XRGE</Text>
                          <Text style={styles.noteListHash} numberOfLines={1}>
                            {t('wshield_sentTo')}: {note.ownerPubKey.slice(0, 16)}…
                          </Text>
                        </View>
                        <Pressable
                          onPress={async () => {
                            await Clipboard.setStringAsync(json);
                            Alert.alert(t('wshield_copied'), t('wshield_copiedMsg'));
                          }}
                          style={styles.unshieldBtn}>
                          <Ionicons name="copy-outline" size={14} color={colors.accent} />
                          <Text style={styles.unshieldBtnText}> {t('wshield_copy')}</Text>
                        </Pressable>
                      </View>
                      <ScrollView horizontal style={styles.sentJsonScroll}>
                        <Text style={styles.noteJson} selectable>{json}</Text>
                      </ScrollView>
                    </Card>
                  );
                })
              )}
            </>
          )}

          {/* Pushes the explainer to the bottom so a short form doesn't leave a
              dead void; on long content it just scrolls normally. */}
          <View style={styles.spacer} />

          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Ionicons name="lock-closed" size={14} color={colors.accent} />
              <Text style={styles.infoText}>{t('wshield_info1')}</Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="key-outline" size={14} color={colors.accent} />
              <Text style={styles.infoText}>{t('wshield_info2')}</Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="warning-outline" size={14} color={colors.warning} />
              <Text style={styles.infoText}>{t('wshield_info3')}</Text>
            </View>
          </View>
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
  scroll: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  spacer: { flex: 1, minHeight: spacing.lg },
  infoCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 10,
  },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  infoText: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  balCard: { marginBottom: spacing.md },
  balHeroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  shieldGlyph: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(31,224,197,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  balLabel: { color: colors.textTertiary, fontSize: 11, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' },
  balHeroValue: { color: colors.accent, fontSize: 26, fontWeight: '800', marginTop: 2 },
  balDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  balSubRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  balSubLabel: { color: colors.textTertiary, fontSize: 13, fontWeight: '600' },
  balSubValue: { color: colors.text, fontSize: 15, fontWeight: '700' },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 3,
    marginBottom: spacing.md,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  tabActive: { backgroundColor: colors.accent },
  tabText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  inputLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  inputLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  maxBtn: { color: colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
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
  summaryBox: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
    gap: 4,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryLabel: { color: colors.textTertiary, fontSize: 12 },
  summaryValue: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  summaryTotal: { color: colors.text, fontSize: 13, fontWeight: '800' },
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
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(31,224,197,0.12)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  unshieldBtnText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  sentIntro: { color: colors.textSecondary, fontSize: 12, marginBottom: spacing.md, lineHeight: 17 },
  sentJsonScroll: { marginTop: 10 },
});
