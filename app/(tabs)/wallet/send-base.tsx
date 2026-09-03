import { Ionicons } from '@expo/vector-icons';
import { useHeaderHeight } from '@react-navigation/elements';
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

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TokenIcon } from '@/components/wallet/TokenIcon';
import { colors, radius, spacing } from '@/constants/theme';
import { fetchBaseAssets, type BaseAsset } from '@/lib/base-assets';
import { estimateBaseSendFee, isEvmAddress, sendBaseAsset } from '@/lib/base-send';
import { deriveEvmAccount } from '@/lib/evm-wallet';
import { formatNumber } from '@/lib/format';
import { rc } from '@/lib/rougechain';
import { useNetworkStore } from '@/stores/network';
import { useWalletStore } from '@/stores/wallet';

export default function SendBaseScreen() {
  const headerHeight = useHeaderHeight();
  const mnemonic = useWalletStore((s) => s.mnemonic);
  const evmChainId = useNetworkStore((s) => s.network.evmChainId);
  const chainName = evmChainId === 8453 ? 'Base' : 'Base Sepolia';

  const [address, setAddress] = useState<string | null>(null);
  const [assets, setAssets] = useState<BaseAsset[]>([]);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [symbol, setSymbol] = useState('ETH');
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [feeEth, setFeeEth] = useState<number | null>(null);

  const ethBalance = assets.find((a) => a.symbol === 'ETH')?.balance ?? 0;

  // Derive the EVM address and load current balances for the selected chain.
  useEffect(() => {
    if (!mnemonic) {
      setAddress(null);
      return;
    }
    let cancelled = false;
    try {
      const acct = deriveEvmAccount(mnemonic);
      setAddress(acct.address);
      void (async () => {
        let xrgeToken: string | undefined;
        try {
          const cfg = (await rc.bridge.getXrgeConfig()) as { tokenAddress?: string };
          xrgeToken = cfg?.tokenAddress;
        } catch {
          /* still show ETH */
        }
        const list = await fetchBaseAssets({ address: acct.address, xrgeToken, chainId: evmChainId });
        if (!cancelled) setAssets(list);
      })();
    } catch {
      setAddress(null);
    }
    return () => {
      cancelled = true;
    };
  }, [mnemonic, evmChainId]);

  const selected = assets.find((a) => a.symbol === symbol) ?? assets[0];
  const balance = selected?.balance ?? 0;
  const tokenAddress = selected?.tokenAddress ?? null;

  function setPercent(pct: number) {
    // Leave a little ETH for gas when sending the max of the native asset.
    const usable = symbol === 'ETH' ? Math.max(0, balance - 0.0002) : balance;
    if (usable <= 0) return;
    const val = (usable * pct) / 100;
    setAmount(val % 1 === 0 ? String(val) : val.toFixed(6));
  }

  // Step 1: validate inputs, estimate the gas fee, then open the confirm sheet.
  async function onReview() {
    if (!mnemonic) {
      Alert.alert('Wallet locked', 'Unlock your wallet to send.');
      return;
    }
    const amt = Number(amount);
    if (!isEvmAddress(to)) {
      Alert.alert('Check recipient', 'Enter a valid 0x… Base address.');
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      Alert.alert('Check amount', 'Enter a positive amount.');
      return;
    }
    if (amt > balance) {
      Alert.alert('Insufficient balance', `You have ${formatNumber(balance, 6)} ${symbol}.`);
      return;
    }
    setFeeEth(null);
    setConfirmOpen(true);
    setEstimating(true);
    try {
      const est = await estimateBaseSendFee({
        from: address!,
        chainId: evmChainId,
        to,
        amount,
        tokenAddress,
      });
      setFeeEth(est.feeEth);
    } catch {
      // Estimation can fail (e.g. transfer would revert); leave fee unknown and
      // let the confirm sheet surface it rather than blocking outright.
      setFeeEth(null);
    } finally {
      setEstimating(false);
    }
  }

  // Step 2: broadcast after the user confirms.
  async function onConfirm() {
    if (!mnemonic) return;
    const amt = Number(amount);
    setBusy(true);
    try {
      const hash = await sendBaseAsset({
        mnemonic,
        chainId: evmChainId,
        to,
        amount,
        tokenAddress,
      });
      setConfirmOpen(false);
      Alert.alert('Sent', `${amt} ${symbol} submitted on ${chainName}.\n\nTx: ${hash.slice(0, 14)}…`);
      setTo('');
      setAmount('');
    } catch (e) {
      Alert.alert('Send failed', e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  const validAddr = isEvmAddress(to);
  // Gas is always paid in ETH. For an ETH send the amount competes with the fee.
  const amt = Number(amount) || 0;
  const ethNeeded = (symbol === 'ETH' ? amt : 0) + (feeEth ?? 0);
  const gasShort = feeEth != null && ethNeeded > ethBalance;

  if (!address) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.emptyWrap}>
          <Ionicons name="lock-closed-outline" size={28} color={colors.textTertiary} />
          <Text style={styles.emptyText}>Unlock your wallet to send on {chainName}.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={headerHeight}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>

          {/* From */}
          <View style={styles.fromRow}>
            <View style={[styles.fromAvatar, { justifyContent: 'center', alignItems: 'center' }]}>
              <Ionicons name="cube-outline" size={14} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fromLabel}>From · {chainName}</Text>
              <Text style={styles.fromName} numberOfLines={1}>
                {address.slice(0, 6)}…{address.slice(-4)}
              </Text>
            </View>
          </View>

          {/* Balance banner */}
          <View style={styles.balanceBanner}>
            <Text style={styles.balanceLabel}>Available balance</Text>
            <Text style={styles.balanceValue}>
              {formatNumber(balance, 6)} <Text style={styles.balanceSym}>{symbol}</Text>
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
              <Text style={styles.feeText}>Network gas paid in ETH, estimated at send time</Text>
            </View>
          </Card>

          {/* Recipient */}
          <Card style={styles.card}>
            <Text style={styles.fieldLabel}>Recipient</Text>
            <TextInput
              value={to}
              onChangeText={setTo}
              autoCapitalize="none"
              placeholder="0x… Base address"
              placeholderTextColor={colors.textTertiary}
              style={styles.recipientInput}
              multiline
            />
            {to.trim().length > 0 && (
              validAddr ? (
                <View style={styles.resolveTag}>
                  <Ionicons name="checkmark-circle" size={13} color={colors.accent} />
                  <Text style={styles.resolveText}>Valid {chainName} address</Text>
                </View>
              ) : (
                <Text style={styles.errText}>Not a valid 0x… address</Text>
              )
            )}
          </Card>

          {/* Token picker */}
          <Card style={styles.card}>
            <Text style={styles.fieldLabel}>Token</Text>
            <Pressable
              onPress={() => setPickerOpen(true)}
              style={({ pressed }) => [styles.tokenSelector, pressed && { opacity: 0.8 }]}>
              <View style={styles.tokenSelectorLeft}>
                <TokenIcon symbol={symbol === 'ETH' ? 'qETH' : symbol} size={24} />
                <Text style={styles.tokenSelectorText}>{symbol}</Text>
              </View>
              <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
            </Pressable>
          </Card>

          <Modal visible={pickerOpen} transparent animationType="fade">
            <Pressable style={styles.modalOverlay} onPress={() => setPickerOpen(false)}>
              <View style={styles.modalSheet}>
                <Text style={styles.modalTitle}>Select Token</Text>
                <FlatList
                  data={assets}
                  keyExtractor={(item) => item.symbol}
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() => {
                        setSymbol(item.symbol);
                        setPickerOpen(false);
                      }}
                      style={({ pressed }) => [
                        styles.tokenOption,
                        item.symbol === symbol && styles.tokenOptionActive,
                        pressed && { opacity: 0.7 },
                      ]}>
                      <View style={styles.tokenOptionLeft}>
                        <TokenIcon symbol={item.symbol === 'ETH' ? 'qETH' : item.symbol} size={28} />
                        <Text style={styles.tokenOptionSym}>{item.symbol}</Text>
                      </View>
                      <Text style={styles.tokenOptionBal}>{formatNumber(item.balance, 4)}</Text>
                    </Pressable>
                  )}
                  ListEmptyComponent={<Text style={styles.tokenOptionBal}>No assets found</Text>}
                />
              </View>
            </Pressable>
          </Modal>

          <Button
            title={`Review ${symbol} send`}
            onPress={onReview}
            disabled={!validAddr || !amount.trim()}
          />

          <Text style={styles.footerHint}>
            Sent on {chainName} · signed with your Base key (secp256k1)
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Confirmation sheet */}
      <Modal visible={confirmOpen} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => !busy && setConfirmOpen(false)}>
          <Pressable style={styles.confirmSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Confirm send</Text>

            <View style={styles.confirmAmountWrap}>
              <TokenIcon symbol={symbol === 'ETH' ? 'qETH' : symbol} size={36} />
              <Text style={styles.confirmAmount}>
                {amount} <Text style={styles.confirmAmountSym}>{symbol}</Text>
              </Text>
            </View>

            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>To</Text>
              <Text style={styles.confirmValMono}>
                {to.trim().slice(0, 10)}…{to.trim().slice(-8)}
              </Text>
            </View>
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Network</Text>
              <Text style={styles.confirmVal}>{chainName}</Text>
            </View>
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Est. network fee</Text>
              <Text style={styles.confirmVal}>
                {estimating ? 'Estimating…' : feeEth != null ? `~${formatNumber(feeEth, 6)} ETH` : 'Unavailable'}
              </Text>
            </View>

            {gasShort && (
              <View style={styles.warnRow}>
                <Ionicons name="warning" size={14} color={colors.warning} />
                <Text style={styles.warnText}>
                  {symbol === 'ETH'
                    ? `Amount + fee exceeds your ${formatNumber(ethBalance, 6)} ETH.`
                    : `You need ~${formatNumber(feeEth ?? 0, 6)} ETH for gas but have ${formatNumber(ethBalance, 6)} ETH.`}
                </Text>
              </View>
            )}

            <Button
              title={busy ? 'Sending…' : gasShort ? 'Insufficient ETH for gas' : `Send ${symbol}`}
              loading={busy}
              onPress={onConfirm}
              disabled={busy || estimating || gasShort}
            />
            <Pressable onPress={() => !busy && setConfirmOpen(false)} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  emptyText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },

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
    backgroundColor: colors.surface,
  },
  fromLabel: { color: colors.textTertiary, fontSize: 11 },
  fromName: { color: colors.text, fontSize: 14, fontWeight: '600', fontFamily: 'SpaceMono' },

  balanceBanner: { alignItems: 'center', marginBottom: spacing.lg, paddingVertical: spacing.md },
  balanceLabel: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  balanceValue: { color: colors.text, fontSize: 28, fontWeight: '800', marginTop: 4, letterSpacing: -0.5 },
  balanceSym: { color: colors.accent, fontSize: 16, fontWeight: '700' },

  card: { marginBottom: spacing.md },

  fieldLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.3, marginBottom: 8 },

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

  pctRow: { flexDirection: 'row', marginTop: spacing.sm },
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
  pctMax: { backgroundColor: colors.accentDim, borderColor: colors.accentMid },
  pctText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  pctMaxText: { color: colors.accent },

  feeRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, gap: 5 },
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
  resolveTag: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  resolveText: { color: colors.accent, fontSize: 12 },
  errText: { color: colors.warning, fontSize: 12, marginTop: 6 },

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
  tokenSelectorLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tokenSelectorText: { fontSize: 15, fontWeight: '700', color: colors.text },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
    maxHeight: '50%',
  },
  modalTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: spacing.md, textAlign: 'center' },
  tokenOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    marginBottom: 2,
  },
  tokenOptionActive: { backgroundColor: 'rgba(31,224,197,0.08)' },
  tokenOptionLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tokenOptionSym: { color: colors.text, fontSize: 15, fontWeight: '600' },
  tokenOptionBal: { color: colors.textSecondary, fontSize: 13 },

  footerHint: { color: colors.textTertiary, fontSize: 11, textAlign: 'center', marginTop: spacing.sm },

  confirmSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  confirmAmountWrap: { alignItems: 'center', gap: 8, marginBottom: spacing.lg },
  confirmAmount: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  confirmAmountSym: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  confirmLabel: { color: colors.textTertiary, fontSize: 13 },
  confirmVal: { color: colors.text, fontSize: 13, fontWeight: '600' },
  confirmValMono: { color: colors.text, fontSize: 12, fontFamily: 'SpaceMono' },
  warnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(253,203,110,0.08)',
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  warnText: { color: colors.warning, fontSize: 11, flex: 1, lineHeight: 16 },
  cancelBtn: { alignItems: 'center', paddingVertical: 12, marginTop: spacing.xs },
  cancelText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
});
