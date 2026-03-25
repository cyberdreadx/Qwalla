import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TRANSFER_FEE } from '@/constants/config';
import { colors, radius, spacing } from '@/constants/theme';
import { rc } from '@/lib/rougechain';
import { useWalletStore } from '@/stores/wallet';
import { isRougeAddress } from '@rougechain/sdk';

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
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [token, setToken] = useState('XRGE');
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!wallet) return;
    void rc
      .getBalance(wallet.publicKey)
      .then((b) => setBalance(typeof b.balance === 'number' ? b.balance : Number(b.balance)))
      .catch(() => {});
  }, [wallet]);

  const available = balance !== null ? Math.max(0, balance - TRANSFER_FEE) : 0;

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
    if (balance !== null && amt + TRANSFER_FEE > balance) {
      Alert.alert('Insufficient balance', `You need ${amt + TRANSFER_FEE} but have ${balance}.`);
      return;
    }
    setBusy(true);
    try {
      const recipientPk = await resolveRecipient(to);
      const r = await rc.transfer(wallet, {
        to: recipientPk,
        amount: amt,
        fee: TRANSFER_FEE,
        token: token.trim() || 'XRGE',
      });
      if (!r.success) {
        Alert.alert('Transfer failed', r.error ?? 'Unknown error');
        return;
      }
      Alert.alert('Sent', 'Transaction submitted to testnet.');
      setTo('');
      setAmount('');
      if (balance !== null) setBalance(balance - amt - TRANSFER_FEE);
    } catch (e) {
      Alert.alert('Transfer failed', e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  const isAddr = to.trim().toLowerCase().startsWith('rouge1');
  const balDisplay =
    balance !== null ? balance.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—';

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
              <Text style={styles.feeText}>Fee: {TRANSFER_FEE} XRGE</Text>
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

          {/* Token */}
          <Card style={styles.card}>
            <Text style={styles.fieldLabel}>Token</Text>
            <TextInput
              value={token}
              onChangeText={setToken}
              autoCapitalize="characters"
              placeholder="XRGE"
              placeholderTextColor={colors.textTertiary}
              style={styles.tokenInput}
            />
          </Card>

          <Button
            title={busy ? 'Sending…' : `Send ${token || 'XRGE'}`}
            loading={busy}
            onPress={onSend}
            disabled={!to.trim() || !amount.trim()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },

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

  tokenInput: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    backgroundColor: colors.input,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
