import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as Clipboard from 'expo-clipboard';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TokenIcon } from '@/components/wallet/TokenIcon';
import { TRANSFER_FEE } from '@/constants/config';
import { colors, radius, spacing } from '@/constants/theme';
import { getSuggestedFee } from '@/lib/fees';
import { formatNumber, formatXrge } from '@/lib/format';
import { rc } from '@/lib/rougechain';
import { saveSentNote } from '@/lib/note-store';
import { useNetworkStore } from '@/stores/network';
import { useWalletStore } from '@/stores/wallet';
import { createShieldedNote, createSignedShield, isRougeAddress } from '@rougechain/sdk';
import { Image } from 'react-native';

async function resolveRecipient(input: string): Promise<string> {
  const trimmed = input.trim();
  if (!isRougeAddress(trimmed)) return trimmed;

  const resolved = await rc.resolveAddress(trimmed);
  if (!resolved?.publicKey) {
    throw new Error(`Could not resolve "${trimmed}" — address not found on-chain.`);
  }
  return resolved.publicKey;
}

export default function SendScreen() {
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
  const isSixDec = sym === 'qUSDC' || sym === 'qETH';
  const rawBalance = sym === 'XRGE' ? xrgeBalance : (tokenBalances[sym] ?? null);
  const humanBalance = rawBalance !== null ? (isSixDec ? rawBalance / 1_000_000 : rawBalance) : null;
  const balance = humanBalance;
  const available = sym === 'XRGE'
    ? (xrgeBalance !== null ? Math.max(0, xrgeBalance - fee) : 0)
    : (humanBalance ?? 0);

  const allTokens: { sym: string; bal: string }[] = [
    { sym: 'XRGE', bal: xrgeBalance !== null ? formatXrge(xrgeBalance) : '0' },
    ...Object.entries(tokenBalances).map(([s, raw]) => {
      const is6 = s === 'qUSDC' || s === 'qETH';
      const display = is6 ? raw / 1_000_000 : raw;
      return { sym: s, bal: formatNumber(display, is6 ? 2 : 4) };
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
      Alert.alert('Check fields', 'Enter a recipient and a positive amount.');
      return;
    }
    if (sym === 'XRGE') {
      if (xrgeBalance !== null && amt + fee > xrgeBalance) {
        Alert.alert('Insufficient balance', `You need ${amt + fee} XRGE but have ${xrgeBalance}.`);
        return;
      }
    } else {
      const tokenBal = tokenBalances[sym] ?? 0;
      if (amt > tokenBal) {
        Alert.alert('Insufficient balance', `You need ${amt} ${sym} but have ${tokenBal}.`);
        return;
      }
      if (xrgeBalance !== null && xrgeBalance < fee) {
        Alert.alert('Insufficient XRGE', `Need at least ${fee} XRGE for the transfer fee.`);
        return;
      }
    }
    setBusy(true);
    try {
      const recipientPk = await resolveRecipient(to);

      if (shielded && sym === 'XRGE') {
        // Create a note owned by the recipient, shield it with our signature,
        // then hand them the note JSON — the only way they can spend it.
        const note = createShieldedNote(amt, recipientPk);
        const tx = createSignedShield(wallet, amt, note.commitment);
        const res = await rc.submitTx('/v2/shielded/shield', tx);
        if (!res.success) throw new Error(res.error ?? 'Shield failed');
        await saveSentNote(note, wallet.publicKey);
        setSentNote(note as unknown as Record<string, unknown>);
        if (xrgeBalance !== null) setXrgeBalance(xrgeBalance - amt - fee);
      } else {
        const r = await rc.transfer(wallet, {
          to: recipientPk,
          amount: amt,
          fee,
          token: token.trim() || 'XRGE',
        });
        if (!r.success) {
          Alert.alert('Transfer failed', r.error ?? 'Unknown error');
          return;
        }
        Alert.alert('Sent', `${amt} ${sym} submitted to ${network.label.toLowerCase()}.`);
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
      Alert.alert('Transfer failed', e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  const isAddr = to.trim().toLowerCase().startsWith('rouge1');
  const balDisplay = humanBalance !== null
    ? formatNumber(humanBalance, isSixDec ? 2 : 4)
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
            <Text style={styles.successTitle}>Shielded Transaction Sent</Text>
            <Text style={styles.successSub}>
              The recipient needs this note to unshield the tokens
            </Text>
          </View>

          <Card style={styles.card}>
            <Text style={styles.fieldLabel}>Note Data</Text>
            <View style={styles.noteBox}>
              <Text style={styles.noteText} selectable>{noteJson}</Text>
            </View>
          </Card>

          <View style={styles.warningRow}>
            <Ionicons name="warning" size={14} color={colors.warning} />
            <Text style={styles.warningText}>
              Share this note with the recipient — it's the only way to claim the tokens
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
              {noteCopied ? 'Copied!' : 'Copy Note'}
            </Text>
          </Pressable>

          <Button
            title="Done"
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
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={88}>
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
              <Text style={styles.fromLabel}>From</Text>
              <Text style={styles.fromName} numberOfLines={1}>
                {displayName || (wallet?.publicKey ? wallet.publicKey.slice(0, 12) + '…' : 'You')}
              </Text>
            </View>
          </View>

          {/* Balance banner */}
          <View style={styles.balanceBanner}>
            <Text style={styles.balanceLabel}>Available balance</Text>
            <Text style={styles.balanceValue}>
              {balDisplay} <Text style={styles.balanceSym}>{token || 'XRGE'}</Text>
            </Text>
          </View>

          {/* Amount */}
          <Card style={styles.card}>
            <Text style={styles.fieldLabel}>Amount</Text>
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
                <Text style={[styles.pctText, styles.pctMaxText]}>MAX</Text>
              </Pressable>
            </View>

            <View style={styles.feeRow}>
              <Ionicons name="information-circle-outline" size={13} color={colors.textTertiary} />
              <Text style={styles.feeText}>Fee: {formatNumber(fee, 4)} XRGE</Text>
            </View>
          </Card>

          {/* Recipient */}
          <Card style={styles.card}>
            <Text style={styles.fieldLabel}>Recipient</Text>
            <TextInput
              value={to}
              onChangeText={setTo}
              autoCapitalize="none"
              placeholder="rouge1… address or public key"
              placeholderTextColor={colors.textTertiary}
              style={styles.recipientInput}
              multiline
            />
            {isAddr ? (
              <View style={styles.resolveTag}>
                <Ionicons name="checkmark-circle" size={13} color={colors.accent} />
                <Text style={styles.resolveText}>Will resolve from directory</Text>
              </View>
            ) : (
              <Text style={styles.hintText}>
                Paste a rouge1… address or raw ML-DSA-65 public key
              </Text>
            )}
          </Card>

          {/* Token picker */}
          <Card style={styles.card}>
            <Text style={styles.fieldLabel}>Token</Text>
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
                <Text style={styles.modalTitle}>Select Token</Text>
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
                    <Text style={styles.tokenOptionBal}>No tokens found</Text>
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
                  <Text style={styles.shieldLabel}>Send Shielded</Text>
                </View>
                <Text style={styles.shieldHint}>
                  Private transfer — recipient imports note to unshield
                </Text>
              </View>
            </Pressable>
          )}

          <Button
            title={busy ? 'Sending…' : shielded && sym === 'XRGE' ? 'Send Shielded' : `Send ${token || 'XRGE'}`}
            loading={busy}
            onPress={onSend}
            disabled={!to.trim() || !amount.trim()}
          />

          <Text style={styles.footerHint}>
            {shielded && sym === 'XRGE'
              ? 'Transaction will be shielded with zk-STARK proof'
              : 'Transaction signed with ML-DSA-65'}
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
