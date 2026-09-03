import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { formatNumber } from '@/lib/format';
import { rc } from '@/lib/rougechain';
import { useWalletStore } from '@/stores/wallet';
import type { BridgeConfig, BridgeWithdrawal, XrgeBridgeConfig } from '@rougechain/sdk';

type BridgeToken = 'qETH' | 'qUSDC' | 'XRGE';
const TOKENS: BridgeToken[] = ['qETH', 'qUSDC', 'XRGE'];

function isEvmAddress(a: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(a.trim());
}

export default function BridgeScreen() {
  const wallet = useWalletStore((s) => s.wallet);

  const [config, setConfig] = useState<BridgeConfig | null>(null);
  const [xrgeConfig, setXrgeConfig] = useState<XrgeBridgeConfig | null>(null);
  const [withdrawals, setWithdrawals] = useState<BridgeWithdrawal[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [tab, setTab] = useState<'withdraw' | 'claim' | 'history'>('withdraw');
  const [token, setToken] = useState<BridgeToken>('qETH');
  const [amount, setAmount] = useState('');
  const [evmAddress, setEvmAddress] = useState('');
  const [evmTxHash, setEvmTxHash] = useState('');
  const [evmSignature, setEvmSignature] = useState('');
  const [busy, setBusy] = useState(false);

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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
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
            {(['withdraw', 'claim', 'history'] as const).map((t) => (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
                style={[styles.segmentBtn, tab === t && styles.segmentBtnActive]}>
                <Text style={[styles.segmentText, tab === t && styles.segmentTextActive]}>
                  {t === 'withdraw' ? 'Withdraw' : t === 'claim' ? 'Claim deposit' : 'History'}
                </Text>
              </Pressable>
            ))}
          </View>

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
});
