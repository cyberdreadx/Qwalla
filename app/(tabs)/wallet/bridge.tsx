import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { TokenIcon } from '@/components/wallet/TokenIcon';
import { colors, fontSize, radius, spacing } from '@/constants/theme';
import { getEvmAddress, XRGE_BASE } from '@/lib/base-assets';
import {
  estimateBaseSendFee,
  getBaseBalance,
  isEvmAddress,
  sendBaseAsset,
  USDC_BY_CHAIN,
} from '@/lib/base-send';
import { formatNumber } from '@/lib/format';
import { rc } from '@/lib/rougechain';
import { useWalletStore } from '@/stores/wallet';
import type { BridgeConfig, BridgeWithdrawal, XrgeBridgeConfig } from '@rougechain/sdk';

type BridgeToken = 'qETH' | 'qUSDC' | 'XRGE';
const TOKENS: BridgeToken[] = ['qETH', 'qUSDC', 'XRGE'];

export default function BridgeScreen() {
  const wallet = useWalletStore((s) => s.wallet);

  const [config, setConfig] = useState<BridgeConfig | null>(null);
  const [xrgeConfig, setXrgeConfig] = useState<XrgeBridgeConfig | null>(null);
  const [withdrawals, setWithdrawals] = useState<BridgeWithdrawal[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const mnemonic = useWalletStore((s) => s.mnemonic);
  const [tab, setTab] = useState<'deposit' | 'withdraw' | 'claim' | 'history'>('deposit');
  const [token, setToken] = useState<BridgeToken>('qETH');
  const [amount, setAmount] = useState('');
  const [evmAddress, setEvmAddress] = useState('');
  const [evmTxHash, setEvmTxHash] = useState('');
  const [evmSignature, setEvmSignature] = useState('');
  const [busy, setBusy] = useState(false);

  // Deposit tab (native Base → RougeChain): our own EVM address + Base balances.
  const myEvmAddress = getEvmAddress();
  const [baseBalance, setBaseBalance] = useState(0);
  const [ethBase, setEthBase] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [feeEth, setFeeEth] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [cfg, xCfg, wd, xwd, bal] = await Promise.all([
        rc.bridge.getConfig(),
        rc.bridge.getXrgeConfig(),
        rc.bridge.getWithdrawals().catch(() => []),
        rc.bridge.getXrgeWithdrawals().catch(() => []),
        wallet ? rc.getBalance(wallet.publicKey).catch(() => null) : Promise.resolve(null),
      ]);
      setConfig(cfg);
      setXrgeConfig(xCfg);
      setWithdrawals([...(wd ?? []), ...(xwd ?? [])]);
      if (bal) {
        const toks = (bal.token_balances ?? bal.tokens ?? {}) as Record<string, number>;
        setBalances({ XRGE: bal.balance ?? 0, ...toks });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [wallet]);

  useEffect(() => {
    void load();
  }, [load]);

  const isXrge = token === 'XRGE';
  const enabled = isXrge ? xrgeConfig?.enabled === true : config?.enabled === true;
  const chainId = (isXrge ? xrgeConfig?.chainId : config?.chainId) ?? 84532;
  const chainName = chainId === 84532 ? 'Base Sepolia' : chainId === 8453 ? 'Base' : `chain ${chainId}`;
  const bal = balances[token] ?? 0;
  const amt = Number(amount);

  // ── Deposit (native Base → RougeChain) derived values ──────────────────────
  const depositSymbol = token === 'qETH' ? 'ETH' : token === 'qUSDC' ? 'USDC' : 'XRGE';
  const depositDecimals = token === 'qUSDC' ? 6 : 18;
  // ETH is native (no token address); USDC + XRGE are ERC-20 transfers.
  const depositTokenAddress =
    token === 'qETH'
      ? null
      : token === 'qUSDC'
        ? USDC_BY_CHAIN[chainId]
        : xrgeConfig?.tokenAddress || XRGE_BASE;
  // qETH/qUSDC land in the shared custody address; XRGE goes to its vault.
  const depositTarget = isXrge ? xrgeConfig?.vaultAddress : config?.custodyAddress;
  // Gas is always paid in ETH; for an ETH deposit the amount competes with it.
  const ethNeeded = (token === 'qETH' ? amt : 0) + (feeEth ?? 0);
  const gasShort = feeEth != null && ethNeeded > ethBase;

  // Load the selected asset's Base balance (+ ETH for the gas guard) for deposits.
  useEffect(() => {
    if (tab !== 'deposit' || !myEvmAddress) return;
    let cancelled = false;
    void (async () => {
      const [sel, eth] = await Promise.all([
        getBaseBalance({ address: myEvmAddress, chainId, tokenAddress: depositTokenAddress, decimals: depositDecimals }),
        token === 'qETH'
          ? Promise.resolve(0)
          : getBaseBalance({ address: myEvmAddress, chainId }),
      ]);
      if (cancelled) return;
      setBaseBalance(sel);
      setEthBase(token === 'qETH' ? sel : eth);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, token, chainId, myEvmAddress]);

  async function onWithdraw() {
    if (!wallet || !(amt > 0)) return;
    if (!isEvmAddress(evmAddress)) {
      Alert.alert('Invalid address', 'Enter a valid 0x… EVM address.');
      return;
    }
    if (amt > bal) {
      Alert.alert('Insufficient balance', `You have ${formatNumber(bal, 6)} ${token}.`);
      return;
    }
    setBusy(true);
    try {
      const res = isXrge
        ? await rc.bridge.withdrawXrge(wallet, { amount: amt, evmAddress })
        : await rc.bridge.withdraw(wallet, { amount: amt, evmAddress, tokenSymbol: token });
      if (res.success) {
        Alert.alert(
          'Withdrawal submitted',
          `${formatNumber(amt, 6)} ${token} → ${evmAddress.slice(0, 10)}… on ${chainName}. ` +
            'Track it in the History tab.',
        );
        setAmount('');
        void load();
        setTab('history');
      } else {
        Alert.alert('Withdrawal failed', res.error ?? 'Unknown error');
      }
    } catch (e) {
      Alert.alert('Withdrawal failed', e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  async function onClaim() {
    if (!wallet) return;
    if (!evmTxHash.trim()) {
      Alert.alert('Missing tx hash', 'Paste the deposit transaction hash from the EVM chain.');
      return;
    }
    if (!isEvmAddress(evmAddress)) {
      Alert.alert('Invalid address', 'Enter the 0x… address you deposited from.');
      return;
    }
    if (isXrge && !(amt > 0)) {
      Alert.alert('Missing amount', 'Enter the deposited XRGE amount.');
      return;
    }
    setBusy(true);
    try {
      const res = isXrge
        ? await rc.bridge.claimXrge({
            evmTxHash: evmTxHash.trim(),
            evmAddress: evmAddress.trim(),
            amount: amt,
            recipientPubkey: wallet.publicKey,
          })
        : await rc.bridge.claim({
            evmTxHash: evmTxHash.trim(),
            evmAddress: evmAddress.trim(),
            evmSignature: evmSignature.trim() || undefined,
            recipientPubkey: wallet.publicKey,
            token: token === 'qETH' ? 'ETH' : 'USDC',
          });
      if (res.success) {
        Alert.alert('Claim submitted', `Your ${token} will arrive after confirmation.`);
        setEvmTxHash('');
        setEvmSignature('');
        void load();
      } else {
        Alert.alert('Claim failed', res.error ?? 'Unknown error');
      }
    } catch (e) {
      Alert.alert('Claim failed', e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  // Step 1: validate the deposit, estimate gas, open the confirm sheet.
  async function onReviewDeposit() {
    if (!myEvmAddress || !mnemonic) {
      Alert.alert('Wallet locked', 'Unlock your wallet to deposit from Base.');
      return;
    }
    if (!depositTarget) {
      Alert.alert('Bridge unavailable', `No ${depositSymbol} deposit address configured on ${chainName}.`);
      return;
    }
    if (token === 'qUSDC' && !depositTokenAddress) {
      Alert.alert('Unsupported', `USDC isn't configured on ${chainName}.`);
      return;
    }
    if (!(amt > 0)) {
      Alert.alert('Check amount', 'Enter a positive amount.');
      return;
    }
    if (amt > baseBalance) {
      Alert.alert('Insufficient balance', `You have ${formatNumber(baseBalance, 6)} ${depositSymbol} on ${chainName}.`);
      return;
    }
    setFeeEth(null);
    setConfirmOpen(true);
    setEstimating(true);
    try {
      const est = await estimateBaseSendFee({
        from: myEvmAddress,
        chainId,
        to: depositTarget,
        amount,
        tokenAddress: depositTokenAddress,
        decimals: depositDecimals,
      });
      setFeeEth(est.feeEth);
    } catch {
      setFeeEth(null);
    } finally {
      setEstimating(false);
    }
  }

  // Step 2: sign + broadcast the Base deposit, then auto-claim on RougeChain.
  async function onConfirmDeposit() {
    if (!myEvmAddress || !mnemonic || !wallet || !depositTarget) return;
    setBusy(true);
    try {
      const hash = await sendBaseAsset({
        mnemonic,
        chainId,
        to: depositTarget,
        amount,
        tokenAddress: depositTokenAddress,
        decimals: depositDecimals,
      });

      // Auto-claim: bind the deposit tx to our RougeChain account.
      let claimErr: string | null = null;
      try {
        const res = isXrge
          ? await rc.bridge.claimXrge({
              evmTxHash: hash,
              evmAddress: myEvmAddress,
              amount: amt,
              recipientPubkey: wallet.publicKey,
            })
          : await rc.bridge.claim({
              evmTxHash: hash,
              evmAddress: myEvmAddress,
              evmSignature: undefined,
              recipientPubkey: wallet.publicKey,
              token: token === 'qETH' ? 'ETH' : 'USDC',
            });
        if (!res.success) claimErr = res.error ?? 'Claim not accepted yet';
      } catch (e) {
        claimErr = e instanceof Error ? e.message : 'Claim error';
      }

      setConfirmOpen(false);
      setAmount('');
      if (claimErr) {
        // Deposit landed but the claim needs a retry (e.g. tx not yet confirmed).
        // Pre-fill the Claim tab so the user can finish in a tap.
        setEvmTxHash(hash);
        setEvmAddress(myEvmAddress);
        setTab('claim');
        Alert.alert(
          'Deposit sent — claim pending',
          `Your ${depositSymbol} deposit is on ${chainName} (tx ${hash.slice(0, 12)}…), but the claim didn't go through yet:\n\n${claimErr}\n\nIt's pre-filled in the Claim tab — try again once the tx confirms.`,
        );
      } else {
        void load();
        setTab('history');
        Alert.alert('Deposit submitted', `${depositSymbol} deposited on ${chainName} and claimed to RougeChain. It'll arrive after confirmation.`);
      }
    } catch (e) {
      Alert.alert('Deposit failed', e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <>
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={colors.accent}
        />
      }>
      {/* Token selector */}
      <View style={styles.tokenRow}>
        {TOKENS.map((t) => (
          <Pressable
            key={t}
            onPress={() => setToken(t)}
            style={[styles.tokenChip, token === t && styles.tokenChipActive]}>
            <TokenIcon symbol={t} size={18} />
            <Text style={[styles.tokenChipText, token === t && styles.tokenChipTextActive]}>
              {t}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Status */}
      <Card style={styles.statusCard}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: enabled ? colors.success : colors.error }]} />
          <Text style={styles.statusText}>
            {token} bridge {enabled ? 'online' : 'offline'} · {chainName}
          </Text>
        </View>
        <Text style={styles.balanceLine}>
          Balance: {formatNumber(bal, 6)} {token}
        </Text>
      </Card>

      {!enabled ? (
        <Card style={styles.offlineCard}>
          <Ionicons name="cloud-offline-outline" size={28} color={colors.textTertiary} />
          <Text style={styles.offlineText}>
            The {token} bridge isn't available on this network right now.
          </Text>
        </Card>
      ) : (
        <>
          {/* Tabs */}
          <View style={styles.segment}>
            {(['deposit', 'withdraw', 'claim', 'history'] as const).map((t) => (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
                style={[styles.segmentBtn, tab === t && styles.segmentBtnActive]}>
                <Text style={[styles.segmentText, tab === t && styles.segmentTextActive]}>
                  {t === 'deposit'
                    ? 'Deposit'
                    : t === 'withdraw'
                      ? 'Withdraw'
                      : t === 'claim'
                        ? 'Claim'
                        : 'History'}
                </Text>
              </Pressable>
            ))}
          </View>

          {tab === 'deposit' && (
            <Card style={styles.formCard}>
              <Text style={styles.formHint}>
                Send {depositSymbol} from your Base wallet into RougeChain. Qwalla signs the {chainName}{' '}
                deposit and claims it automatically — no copy-paste.
              </Text>
              {!myEvmAddress ? (
                <View style={styles.depoLocked}>
                  <Ionicons name="lock-closed-outline" size={22} color={colors.textTertiary} />
                  <Text style={styles.offlineText}>Unlock your wallet to deposit from Base.</Text>
                </View>
              ) : (
                <>
                  <View style={styles.depoBalRow}>
                    <Text style={styles.depoBalLabel}>Base balance</Text>
                    <Text style={styles.depoBalVal}>
                      {formatNumber(baseBalance, 6)} {depositSymbol}
                    </Text>
                  </View>
                  <Field
                    label={`Amount (${depositSymbol})`}
                    value={amount}
                    onChangeText={setAmount}
                    placeholder="0.0"
                    keyboardType="decimal-pad"
                  />
                  <Text style={styles.depoFrom} numberOfLines={1}>
                    From {myEvmAddress.slice(0, 10)}…{myEvmAddress.slice(-6)} on {chainName}
                  </Text>
                  <Button
                    title={`Review ${depositSymbol} deposit`}
                    disabled={!depositTarget || !(amt > 0)}
                    onPress={onReviewDeposit}
                  />
                  {!depositTarget && (
                    <Text style={styles.depoWarn}>
                      No {depositSymbol} deposit address configured on {chainName}.
                    </Text>
                  )}
                </>
              )}
            </Card>
          )}

          {tab === 'withdraw' && (
            <Card style={styles.formCard}>
              <Text style={styles.formHint}>
                Send {token} from RougeChain to your wallet on {chainName}.
              </Text>
              <Field
                label={`Amount (${token})`}
                value={amount}
                onChangeText={setAmount}
                placeholder="0.0"
                keyboardType="decimal-pad"
              />
              <Field
                label="Destination EVM address"
                value={evmAddress}
                onChangeText={setEvmAddress}
                placeholder="0x…"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Button
                title={`Withdraw to ${chainName}`}
                loading={busy}
                disabled={!wallet || !(amt > 0) || !evmAddress}
                onPress={onWithdraw}
              />
            </Card>
          )}

          {tab === 'claim' && (
            <Card style={styles.formCard}>
              <Text style={styles.formHint}>
                Already deposited on {chainName}? Paste the transaction to claim your {token} here.
              </Text>
              <Field
                label="EVM deposit tx hash"
                value={evmTxHash}
                onChangeText={setEvmTxHash}
                placeholder="0x…"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Field
                label="Your EVM address (sender)"
                value={evmAddress}
                onChangeText={setEvmAddress}
                placeholder="0x…"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {isXrge ? (
                <Field
                  label="Deposited amount (XRGE)"
                  value={amount}
                  onChangeText={setAmount}
                  placeholder="0.0"
                  keyboardType="decimal-pad"
                />
              ) : (
                <Field
                  label="EVM signature (if required)"
                  value={evmSignature}
                  onChangeText={setEvmSignature}
                  placeholder="0x… (optional)"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              )}
              <Button
                title={`Claim ${token}`}
                loading={busy}
                disabled={!wallet || !evmTxHash || !evmAddress}
                onPress={onClaim}
              />
            </Card>
          )}

          {tab === 'history' && (
            <View style={{ marginTop: spacing.md }}>
              {withdrawals.length === 0 ? (
                <Card>
                  <Text style={styles.emptyText}>No pending withdrawals.</Text>
                </Card>
              ) : (
                withdrawals.map((w, i) => (
                  <Card key={String(w.txId ?? i)} style={styles.histCard}>
                    <View style={styles.histIcon}>
                      <Ionicons name="arrow-up" size={14} color={colors.warning} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.histAmount}>
                        {formatNumber(Number(w.amount) || 0, 6)}{' '}
                        {String((w as Record<string, unknown>).tokenSymbol ?? (w as Record<string, unknown>).token ?? '')}
                      </Text>
                      <Text style={styles.histAddr} numberOfLines={1}>
                        → {String(w.evmAddress ?? '')}
                      </Text>
                    </View>
                    <Text style={styles.histStatus}>{String(w.status ?? 'pending')}</Text>
                  </Card>
                ))
              )}
            </View>
          )}
        </>
      )}
    </ScrollView>

    {/* Deposit confirmation sheet */}
    <Modal visible={confirmOpen} transparent animationType="slide">
      <Pressable style={styles.modalOverlay} onPress={() => !busy && setConfirmOpen(false)}>
        <Pressable style={styles.confirmSheet} onPress={() => {}}>
          <Text style={styles.confirmTitle}>Confirm deposit</Text>

          <View style={styles.confirmAmountWrap}>
            <TokenIcon symbol={token} size={36} />
            <Text style={styles.confirmAmount}>
              {amount} <Text style={styles.confirmAmountSym}>{depositSymbol}</Text>
            </Text>
          </View>

          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>To</Text>
            <Text style={styles.confirmValMono}>
              {(depositTarget ?? '').slice(0, 10)}…{(depositTarget ?? '').slice(-6)}
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
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Then</Text>
            <Text style={styles.confirmVal}>Auto-claim to RougeChain</Text>
          </View>

          {gasShort && (
            <View style={styles.warnRow}>
              <Ionicons name="warning" size={14} color={colors.warning} />
              <Text style={styles.warnText}>
                {token === 'qETH'
                  ? `Amount + fee exceeds your ${formatNumber(ethBase, 6)} ETH.`
                  : `You need ~${formatNumber(feeEth ?? 0, 6)} ETH for gas but have ${formatNumber(ethBase, 6)} ETH.`}
              </Text>
            </View>
          )}

          <Button
            title={busy ? 'Depositing…' : gasShort ? 'Insufficient ETH for gas' : `Deposit ${depositSymbol}`}
            loading={busy}
            onPress={onConfirmDeposit}
            disabled={busy || estimating || gasShort}
          />
          <Pressable onPress={() => !busy && setConfirmOpen(false)} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  tokenRow: { flexDirection: 'row', gap: spacing.xs },
  tokenChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  tokenChipActive: { backgroundColor: colors.accentDim, borderColor: colors.accentMid },
  tokenChipText: { color: colors.textSecondary, fontWeight: '600', fontSize: fontSize.sm },
  tokenChipTextActive: { color: colors.accent },
  statusCard: { marginTop: spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  balanceLine: { color: colors.textTertiary, fontSize: fontSize.xs, marginTop: 6 },
  offlineCard: {
    marginTop: spacing.md,
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  offlineText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.input,
    borderRadius: radius.md,
    padding: 3,
    marginTop: spacing.md,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  segmentBtnActive: { backgroundColor: colors.surface },
  segmentText: { color: colors.textSecondary, fontWeight: '600', fontSize: fontSize.xs },
  segmentTextActive: { color: colors.accent },
  formCard: { marginTop: spacing.md },
  formHint: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    lineHeight: 17,
    marginBottom: spacing.md,
  },
  emptyText: { color: colors.textTertiary, fontSize: fontSize.sm },
  histCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingVertical: 12,
  },
  histIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(253,203,110,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  histAmount: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  histAddr: { color: colors.textTertiary, fontSize: fontSize.xs, marginTop: 2 },
  histStatus: { color: colors.warning, fontSize: fontSize.xs, fontWeight: '600' },

  // Deposit tab
  depoLocked: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  depoBalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  depoBalLabel: { color: colors.textTertiary, fontSize: fontSize.xs },
  depoBalVal: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  depoFrom: { color: colors.textTertiary, fontSize: fontSize.xs, marginBottom: spacing.md, fontFamily: 'SpaceMono' },
  depoWarn: { color: colors.warning, fontSize: fontSize.xs, marginTop: spacing.sm, textAlign: 'center' },

  // Confirmation sheet
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  confirmSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  confirmTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: spacing.md, textAlign: 'center' },
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
