import { Ionicons } from '@expo/vector-icons';
import { useHeaderHeight } from '@react-navigation/elements';
import { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as Clipboard from 'expo-clipboard';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TokenIcon } from '@/components/wallet/TokenIcon';
import { TRANSFER_FEE } from '@/constants/config';
import { colors, radius, spacing } from '@/constants/theme';
import { getSuggestedFee } from '@/lib/fees';
import { useT } from '@/lib/i18n';
import { formatNumber, formatXrge, l1ToHuman, formatL1Human } from '@/lib/format';
import { rc } from '@/lib/rougechain';
import { saveSentNote } from '@/lib/note-store';
import { useNetworkStore } from '@/stores/network';
import { useWalletStore } from '@/stores/wallet';
import { createShieldedNote, createSignedShield, isRougeAddress } from '@rougechain/sdk';
import { Image } from 'react-native';

async function resolveRecipient(
  input: string,
  t: (key: string) => string,
): Promise<string> {
  const trimmed = input.trim();
  if (!isRougeAddress(trimmed)) return trimmed;

  const resolved = await rc.resolveAddress(trimmed);
  if (!resolved?.publicKey) {
    throw new Error(`${t('wsend_resolve_fail_pre')}${trimmed}${t('wsend_resolve_fail_post')}`);
  }
  return resolved.publicKey;
}

export default function SendScreen() {
  const { t } = useT();
  const headerHeight = useHeaderHeight();
  const wallet = useWalletStore((s) => s.wallet);
  const avatarUrl = useWalletStore((s) => s.avatarUrl);
  const displayName = useWalletStore((s) => s.displayName);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [token, setToken] = useState('XRGE');
  const [busy, setBusy] = useState(false);
  const [xrgeBalance, setXrgeBalance] = useState<number | null>(null);
  const [tokenBalances, setTokenBalances] = useState<Record<string, number>>({});
  const [shielded, setShielded] = useState(false);
  const [sentNote, setSentNote] = useState<Record<string, unknown> | null>(null);
  const [noteCopied, setNoteCopied] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const network = useNetworkStore((s) => s.network);
  const [fee, setFee] = useState<number>(TRANSFER_FEE);

  useEffect(() => {
    void getSuggestedFee().then(setFee).catch(() => {});
  }, [network.id]);

  useEffect(() => {
    if (!wallet) return;
    void rc
      .getBalance(wallet.publicKey)
      .then((b: any) => {
        const xrge = typeof b.balance === 'number' ? b.balance : Number(b.balance);
        setXrgeBalance(xrge);
        const toks = b.token_balances ?? b.tokens;
        if (toks && typeof toks === 'object') {
          setTokenBalances(toks as Record<string, number>);
        }
      })
      .catch(() => {});
  }, [wallet]);

  const sym = token.trim().toUpperCase() || 'XRGE';
  const rawBalance = sym === 'XRGE' ? xrgeBalance : (tokenBalances[sym] ?? null);
  const humanBalance = rawBalance !== null ? l1ToHuman(sym, rawBalance) : null;
  const balance = humanBalance;
  const available = sym === 'XRGE'
    ? (xrgeBalance !== null ? Math.max(0, xrgeBalance - fee) : 0)
    : (humanBalance ?? 0);

  const allTokens: { sym: string; bal: string }[] = [
    { sym: 'XRGE', bal: xrgeBalance !== null ? formatXrge(xrgeBalance) : '0' },
    ...Object.entries(tokenBalances).map(([s, raw]) => {
      return { sym: s, bal: formatL1Human(s, l1ToHuman(s, raw)) };
    }),
  ];

  function setPercent(pct: number) {
    if (available <= 0) return;
    const val = (available * pct) / 100;
    setAmount(val % 1 === 0 ? String(val) : val.toFixed(4));
  }

  async function onSend() {
    if (!wallet) return;
    const amt = Number(amount);
    if (!to.trim() || !Number.isFinite(amt) || amt <= 0) {
      Alert.alert(t('wsend_check_fields_title'), t('wsend_check_fields_msg'));
      return;
    }
    if (sym === 'XRGE') {
      if (xrgeBalance !== null && amt + fee > xrgeBalance) {
        Alert.alert(t('wsend_insufficient_balance_title'), `${t('wsend_need_pre')}${amt + fee}${t('wsend_xrge_but_have')}${xrgeBalance}.`);
        return;
      }
    } else {
      const tokenBal = tokenBalances[sym] ?? 0;
      if (amt > tokenBal) {
        Alert.alert(t('wsend_insufficient_balance_title'), `${t('wsend_need_pre')}${amt} ${sym}${t('wsend_but_have')}${tokenBal}.`);
        return;
      }
      if (xrgeBalance !== null && xrgeBalance < fee) {
        Alert.alert(t('wsend_insufficient_xrge_title'), `${t('wsend_need_at_least')}${fee}${t('wsend_xrge_for_fee')}`);
        return;
      }
    }
    setBusy(true);
    try {
      if (shielded && sym === 'XRGE') {
        // A shielded note is owned by a specific public key, so the recipient's
        // rouge1 must resolve to a pubkey (they must have transacted before);
        // raw pubkeys work directly.
        const recipientPk = await resolveRecipient(to, t);
        // Create a note owned by the recipient, shield it with our signature,
        // then hand them the note JSON — the only way they can spend it.
        const note = createShieldedNote(amt, recipientPk);
        const tx = createSignedShield(wallet, amt, note.commitment);
        const res = await rc.submitTx('/v2/shielded/shield', tx);
        if (!res.success) throw new Error(res.error ?? t('wsend_shield_failed'));
        await saveSentNote(note, wallet.publicKey);
        setSentNote(note as unknown as Record<string, unknown>);
        if (xrgeBalance !== null) setXrgeBalance(xrgeBalance - amt - fee);
      } else {
        // A plain transfer can go straight to a rouge1 address: the node keys
        // balances by canonical address, so the recipient sees it via their own
        // pubkey. No resolve step, so brand-new / never-seen rouge1 addresses
        // work too (a rouge1 is a hash of the pubkey and can't be reversed, which
        // is why resolving it only worked for already-seen keys). Pubkeys pass
        // through unchanged.
        const r = await rc.transfer(wallet, {
          to: to.trim(),
          amount: amt,
          fee,
          token: token.trim() || 'XRGE',
        });
        if (!r.success) {
          Alert.alert(t('wsend_transfer_failed_title'), r.error ?? t('wsend_unknown_error'));
          return;
        }
        Alert.alert(t('wsend_sent_title'), `${amt} ${sym}${t('wsend_submitted_to')}${network.label.toLowerCase()}.`);
        setTo('');
        setAmount('');
        if (sym === 'XRGE') {
          if (xrgeBalance !== null) setXrgeBalance(xrgeBalance - amt - fee);
        } else {
          setTokenBalances(prev => ({ ...prev, [sym]: (prev[sym] ?? 0) - amt }));
          if (xrgeBalance !== null) setXrgeBalance(xrgeBalance - fee);
        }
      }
    } catch (e) {
      Alert.alert(t('wsend_transfer_failed_title'), e instanceof Error ? e.message : t('wsend_error'));
    } finally {
      setBusy(false);
    }
  }

  const isAddr = to.trim().toLowerCase().startsWith('rouge1');
  const balDisplay = humanBalance !== null
    ? formatL1Human(sym, humanBalance)
    : '—';

  if (sentNote) {
    const noteJson = JSON.stringify(sentNote, null, 2);
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: 'center', marginBottom: spacing.lg }}>
            <View style={styles.successIcon}>
              <Ionicons name="shield-checkmark" size={32} color={colors.accent} />
            </View>
            <Text style={styles.successTitle}>{t('wsend_shielded_tx_sent')}</Text>
            <Text style={styles.successSub}>
              {t('wsend_recipient_needs_note')}
            </Text>
          </View>

          <Card style={styles.card}>
            <Text style={styles.fieldLabel}>{t('wsend_note_data')}</Text>
            <View style={styles.noteBox}>
              <Text style={styles.noteText} selectable>{noteJson}</Text>
            </View>
          </Card>

          <View style={styles.warningRow}>
            <Ionicons name="warning" size={14} color={colors.warning} />
            <Text style={styles.warningText}>
              {t('wsend_share_note')}
            </Text>
          </View>

          <Pressable
            onPress={async () => {
              await Clipboard.setStringAsync(noteJson);
              setNoteCopied(true);
              setTimeout(() => setNoteCopied(false), 2000);
            }}
            style={({ pressed }) => [styles.copyBtn, pressed && { opacity: 0.8 }]}
          >
            <Ionicons
              name={noteCopied ? 'checkmark-circle' : 'copy-outline'}
              size={16}
              color={noteCopied ? colors.success : colors.accent}
            />
            <Text style={[styles.copyText, noteCopied && { color: colors.success }]}>
              {noteCopied ? t('wsend_copied') : t('wsend_copy_note')}
            </Text>
          </Pressable>

          <Button
            title={t('wsend_done')}
            onPress={() => {
              setSentNote(null);
              setTo('');
              setAmount('');
              setShielded(false);
            }}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={headerHeight}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>

          {/* From */}
          <View style={styles.fromRow}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.fromAvatar} />
            ) : (
              <View style={[styles.fromAvatar, { backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' }]}>
                <Ionicons name="person" size={14} color={colors.textTertiary} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.fromLabel}>{t('wsend_from')}</Text>
              <Text style={styles.fromName} numberOfLines={1}>
                {displayName || (wallet?.publicKey ? wallet.publicKey.slice(0, 12) + '…' : t('wsend_you'))}
              </Text>
            </View>
          </View>

          {/* Balance banner */}
          <View style={styles.balanceBanner}>
            <Text style={styles.balanceLabel}>{t('wsend_available_balance')}</Text>
            <Text style={styles.balanceValue}>
              {balDisplay} <Text style={styles.balanceSym}>{token || 'XRGE'}</Text>
            </Text>
          </View>

          {/* Amount */}
          <Card style={styles.card}>
            <Text style={styles.fieldLabel}>{t('wsend_amount')}</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.textTertiary}
              style={styles.amountInput}
            />

            {/* Percent shortcuts */}
            <View style={styles.pctRow}>
              {[25, 50, 75].map((p) => (
                <Pressable
                  key={p}
                  onPress={() => setPercent(p)}
                  style={({ pressed }) => [styles.pctBtn, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.pctText}>{p}%</Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => setPercent(100)}
                style={({ pressed }) => [styles.pctBtn, styles.pctMax, pressed && { opacity: 0.7 }]}>
                <Text style={[styles.pctText, styles.pctMaxText]}>{t('wsend_max')}</Text>
              </Pressable>
            </View>

            <View style={styles.feeRow}>
              <Ionicons name="information-circle-outline" size={13} color={colors.textTertiary} />
              <Text style={styles.feeText}>{t('wsend_fee_label')}{formatNumber(fee, 4)} XRGE</Text>
            </View>
          </Card>

          {/* Recipient */}
          <Card style={styles.card}>
            <Text style={styles.fieldLabel}>{t('wsend_recipient')}</Text>
            <TextInput
              value={to}
              // Strip any whitespace/newlines a paste carries — a rouge1 address
              // (or raw pubkey) has none. Without this the pasted trailing "\n"
              // survives in the multiline field, leaving a dangling empty line
              // the user had to backspace off before sending.
              onChangeText={(v) => setTo(v.replace(/\s/g, ''))}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t('wsend_recipient_placeholder')}
              placeholderTextColor={colors.textTertiary}
              style={styles.recipientInput}
              multiline
            />
            {isAddr ? (
              <View style={styles.resolveTag}>
                <Ionicons name="checkmark-circle" size={13} color={colors.accent} />
                <Text style={styles.resolveText}>{t('wsend_will_resolve')}</Text>
              </View>
            ) : (
              <Text style={styles.hintText}>
                {t('wsend_paste_hint')}
              </Text>
            )}
          </Card>

          {/* Token picker */}
          <Card style={styles.card}>
            <Text style={styles.fieldLabel}>{t('wsend_token')}</Text>
            <Pressable
              onPress={() => setPickerOpen(true)}
              style={({ pressed }) => [styles.tokenSelector, pressed && { opacity: 0.8 }]}
            >
              <View style={styles.tokenSelectorLeft}>
                <TokenIcon symbol={sym} size={24} />
                <Text style={styles.tokenSelectorText}>{sym}</Text>
              </View>
              <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
            </Pressable>
          </Card>

          <Modal visible={pickerOpen} transparent animationType="fade">
            <Pressable style={styles.modalOverlay} onPress={() => setPickerOpen(false)}>
              <View style={styles.modalSheet}>
                <Text style={styles.modalTitle}>{t('wsend_select_token')}</Text>
                <FlatList
                  data={allTokens}
                  keyExtractor={(item) => item.sym}
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() => { setToken(item.sym); setPickerOpen(false); }}
                      style={({ pressed }) => [
                        styles.tokenOption,
                        item.sym === sym && styles.tokenOptionActive,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <View style={styles.tokenOptionLeft}>
                        <TokenIcon symbol={item.sym} size={28} />
                        <Text style={styles.tokenOptionSym}>{item.sym}</Text>
                      </View>
                      <Text style={styles.tokenOptionBal}>{item.bal}</Text>
                    </Pressable>
                  )}
                  ListEmptyComponent={
                    <Text style={styles.tokenOptionBal}>{t('wsend_no_tokens')}</Text>
                  }
                />
              </View>
            </Pressable>
          </Modal>

          {/* Shielded toggle */}
          {sym === 'XRGE' && (
            <Pressable
              onPress={() => setShielded(!shielded)}
              style={[styles.shieldToggle, shielded && styles.shieldToggleActive]}
            >
              <View style={[styles.toggleTrack, shielded && styles.toggleTrackActive]}>
                <View style={[styles.toggleThumb, shielded && styles.toggleThumbActive]} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="shield-checkmark" size={14} color={colors.accent} />
                  <Text style={styles.shieldLabel}>{t('wsend_send_shielded')}</Text>
                </View>
                <Text style={styles.shieldHint}>
                  {t('wsend_private_transfer_hint')}
                </Text>
              </View>
            </Pressable>
          )}

          <Button
            title={busy ? t('wsend_sending') : shielded && sym === 'XRGE' ? t('wsend_send_shielded') : `${t('wsend_send_prefix')}${token || 'XRGE'}`}
            loading={busy}
            onPress={onSend}
            disabled={!to.trim() || !amount.trim()}
          />

          <Text style={styles.footerHint}>
            {shielded && sym === 'XRGE'
              ? t('wsend_footer_shielded')
              : t('wsend_footer_signed')}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },

  fromRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: spacing.md,
    paddingHorizontal: 4,
  },
  fromAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  fromLabel: { color: colors.textTertiary, fontSize: 11 },
  fromName: { color: colors.text, fontSize: 14, fontWeight: '600' },

  balanceBanner: {
    alignItems: 'center',
    marginBottom: spacing.lg,
    paddingVertical: spacing.md,
  },
  balanceLabel: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  balanceValue: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    marginTop: 4,
    letterSpacing: -0.5,
  },
  balanceSym: { color: colors.accent, fontSize: 16, fontWeight: '700' },

  card: { marginBottom: spacing.md },

  fieldLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 8,
  },

  amountInput: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    backgroundColor: colors.input,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },

  pctRow: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  pctBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    marginHorizontal: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pctMax: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accentMid,
  },
  pctText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  pctMaxText: { color: colors.accent },

  feeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: 5,
  },
  feeText: { color: colors.textTertiary, fontSize: 11 },

  recipientInput: {
    fontSize: 13,
    fontFamily: 'SpaceMono',
    color: colors.text,
    backgroundColor: colors.input,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
  },
  resolveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
  },
  resolveText: { color: colors.accent, fontSize: 12 },
  hintText: { color: colors.textTertiary, fontSize: 12, marginTop: 6, lineHeight: 16 },

  tokenSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.input,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  tokenSelectorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tokenSelectorText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
    maxHeight: '50%',
  },
  modalTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  tokenOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    marginBottom: 2,
  },
  tokenOptionActive: {
    backgroundColor: 'rgba(31,224,197,0.08)',
  },
  tokenOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tokenOptionSym: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  tokenOptionBal: {
    color: colors.textSecondary,
    fontSize: 13,
  },

  shieldToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginBottom: spacing.md,
  },
  shieldToggleActive: {
    borderColor: 'rgba(31,224,197,0.4)',
    backgroundColor: 'rgba(31,224,197,0.05)',
  },
  toggleTrack: {
    width: 36,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
  },
  toggleTrackActive: { backgroundColor: colors.accent },
  toggleThumb: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
    marginLeft: 2,
  },
  toggleThumbActive: { marginLeft: 18 },
  shieldLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  shieldHint: { color: colors.textTertiary, fontSize: 10, marginTop: 2 },

  footerHint: {
    color: colors.textTertiary,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.sm,
  },

  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(31,224,197,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  successTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  successSub: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  noteBox: {
    backgroundColor: colors.input,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    maxHeight: 200,
  },
  noteText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontFamily: 'SpaceMono',
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(253,203,110,0.08)',
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginBottom: spacing.md,
  },
  warningText: {
    color: colors.warning,
    fontSize: 11,
    flex: 1,
    lineHeight: 16,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(31,224,197,0.3)',
    backgroundColor: 'rgba(31,224,197,0.06)',
    marginBottom: spacing.md,
  },
  copyText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
});
