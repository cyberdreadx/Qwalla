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
import { colors, fontSize, radius, spacing } from '@/constants/theme';
import { getSuggestedFee } from '@/lib/fees';
import { formatNumber } from '@/lib/format';
import { rc } from '@/lib/rougechain';
import { useWalletStore } from '@/stores/wallet';
import { formatAddress, type Validator } from '@rougechain/sdk';

const MIN_VALIDATOR_STAKE = 10_000;

export default function StakeScreen() {
  const wallet = useWalletStore((s) => s.wallet);

  const [validators, setValidators] = useState<Validator[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [myStake, setMyStake] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mode, setMode] = useState<'stake' | 'unstake'>('stake');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [vals, bal] = await Promise.all([
        rc.getValidators().catch(() => [] as Validator[]),
        wallet ? rc.getBalance(wallet.publicKey).catch(() => null) : Promise.resolve(null),
      ]);
      const list = Array.isArray(vals) ? vals : [];
      setValidators(list);
      if (bal) setBalance(bal.balance ?? 0);
      if (wallet) {
        const mine = list.find(
          (v) => v.public_key === wallet.publicKey || v.address === wallet.publicKey,
        );
        setMyStake(typeof mine?.stake === 'number' ? mine.stake : 0);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [wallet]);

  useEffect(() => {
    void load();
  }, [load]);

  const amt = Number(amount);
  const valid =
    amt > 0 && (mode === 'stake' ? amt <= balance : amt <= myStake);

  async function onSubmit() {
    if (!wallet || !valid) return;
    const isStake = mode === 'stake';
    if (isStake && myStake + amt < MIN_VALIDATOR_STAKE) {
      Alert.alert(
        'Below validator minimum',
        `Validators need at least ${formatNumber(MIN_VALIDATOR_STAKE)} XRGE staked. ` +
          `You can still stake now and add more later — continue?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Stake anyway', onPress: () => void doSubmit() },
        ],
      );
      return;
    }
    await doSubmit();
  }

  async function doSubmit() {
    if (!wallet) return;
    setBusy(true);
    try {
      const fee = await getSuggestedFee();
      const res =
        mode === 'stake'
          ? await rc.stake(wallet, { amount: amt, fee })
          : await rc.unstake(wallet, { amount: amt, fee });
      if (res.success) {
        Alert.alert(
          mode === 'stake' ? 'Stake submitted' : 'Unstake submitted',
          `${formatNumber(amt)} XRGE`,
        );
        setAmount('');
        void load();
      } else {
        Alert.alert('Failed', res.error ?? 'Unknown error');
      }
    } catch (e) {
      Alert.alert('Failed', e instanceof Error ? e.message : 'Network error');
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

  const totalStaked = validators.reduce(
    (sum, v) => sum + (typeof v.stake === 'number' ? v.stake : 0),
    0,
  );

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
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
      {/* My position */}
      <Card style={styles.heroCard}>
        <Text style={styles.heroLabel}>Your stake</Text>
        <Text style={styles.heroValue}>
          {formatNumber(myStake)} <Text style={styles.heroSym}>XRGE</Text>
        </Text>
        <View style={styles.heroMetaRow}>
          <Text style={styles.heroMeta}>Available: {formatNumber(balance, 4)} XRGE</Text>
          {myStake >= MIN_VALIDATOR_STAKE ? (
            <View style={styles.validatorPill}>
              <Ionicons name="shield-checkmark" size={11} color={colors.success} />
              <Text style={styles.validatorPillText}>Validator eligible</Text>
            </View>
          ) : null}
        </View>
      </Card>

      {/* Stake / Unstake toggle */}
      <View style={styles.segment}>
        {(['stake', 'unstake'] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => setMode(m)}
            style={[styles.segmentBtn, mode === m && styles.segmentBtnActive]}>
            <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>
              {m === 'stake' ? 'Stake' : 'Unstake'}
            </Text>
          </Pressable>
        ))}
      </View>

      <Card style={styles.formCard}>
        <Field
          label={mode === 'stake' ? 'Amount to stake (XRGE)' : 'Amount to unstake (XRGE)'}
          value={amount}
          onChangeText={setAmount}
          placeholder="0.0"
          keyboardType="decimal-pad"
        />
        <View style={styles.quickRow}>
          {[0.25, 0.5, 1].map((f) => {
            const base = mode === 'stake' ? balance : myStake;
            return (
              <Pressable
                key={f}
                onPress={() => setAmount(String(Math.floor(base * f * 10000) / 10000))}
                style={styles.quickBtn}>
                <Text style={styles.quickBtnText}>{f === 1 ? 'MAX' : `${f * 100}%`}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hint}>
          Minimum validator stake is {formatNumber(MIN_VALIDATOR_STAKE)} XRGE. Staked tokens secure
          the network and earn block rewards.
        </Text>
        <Button
          title={mode === 'stake' ? 'Stake XRGE' : 'Unstake XRGE'}
          loading={busy}
          disabled={!valid}
          onPress={onSubmit}
        />
      </Card>

      {/* Validators */}
      <Text style={styles.section}>
        Validators · {validators.length} · {formatNumber(totalStaked)} XRGE staked
      </Text>
      {validators.length === 0 ? (
        <Card>
          <Text style={styles.emptyText}>No validators on this network yet.</Text>
        </Card>
      ) : (
        validators
          .slice()
          .sort((a, b) => (Number(b.stake) || 0) - (Number(a.stake) || 0))
          .map((v, i) => {
            const pk = String(v.public_key ?? v.address ?? '');
            const isMe = wallet && pk === wallet.publicKey;
            const share = totalStaked > 0 ? ((Number(v.stake) || 0) / totalStaked) * 100 : 0;
            return (
              <Card key={pk || i} style={styles.valCard}>
                <View style={styles.valRank}>
                  <Text style={styles.valRankText}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.valKey} numberOfLines={1}>
                    {isMe ? 'You' : formatAddress(pk, 10, 6)}
                  </Text>
                  <Text style={styles.valShare}>{share.toFixed(1)}% of stake</Text>
                </View>
                <Text style={styles.valStake}>{formatNumber(Number(v.stake) || 0)} XRGE</Text>
              </Card>
            );
          })
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
  heroCard: { alignItems: 'flex-start' },
  heroLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  heroValue: {
    color: colors.text,
    fontSize: fontSize.hero,
    fontWeight: '800',
    marginTop: 4,
  },
  heroSym: { fontSize: fontSize.lg, color: colors.textSecondary, fontWeight: '700' },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  heroMeta: { color: colors.textTertiary, fontSize: fontSize.xs },
  validatorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(46,230,168,0.12)',
    borderRadius: radius.full,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  validatorPillText: { color: colors.success, fontSize: 10, fontWeight: '700' },
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
  segmentText: { color: colors.textSecondary, fontWeight: '600', fontSize: fontSize.sm },
  segmentTextActive: { color: colors.accent },
  formCard: { marginTop: spacing.md },
  quickRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md },
  quickBtn: {
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  quickBtnText: { color: colors.accent, fontSize: fontSize.xs, fontWeight: '700' },
  hint: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    lineHeight: 17,
    marginBottom: spacing.md,
  },
  section: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  emptyText: { color: colors.textTertiary, fontSize: fontSize.sm },
  valCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingVertical: 12,
  },
  valRank: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valRankText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '700' },
  valKey: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  valShare: { color: colors.textTertiary, fontSize: fontSize.xs, marginTop: 2 },
  valStake: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
});
