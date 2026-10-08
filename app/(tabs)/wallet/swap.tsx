import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TokenIcon } from '@/components/wallet/TokenIcon';
import { colors, fontSize, radius, spacing } from '@/constants/theme';
import { formatNumber, formatL1Human, l1ToHuman, l1TokenDecimals } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { parseUnits, formatUnits, pickXrgeBalance, pickTokenBalances } from '@/lib/token-decimals';
import { rc } from '@/lib/rougechain';
import { useWalletStore } from '@/stores/wallet';
import type { Pool } from '@rougechain/sdk';

const SLIPPAGE_OPTIONS = [0.5, 1, 3];

function poolId(p: Pool): string {
  return String(p.pool_id ?? p.id ?? '');
}

function quoteOut(q: Record<string, unknown>): number {
  const v = q.amount_out ?? q.amountOut ?? q.out;
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && isFinite(n) ? n : 0;
}

export default function SwapScreen() {
  const { t } = useT();
  const wallet = useWalletStore((s) => s.wallet);

  const [pools, setPools] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(true);
  const [tokenIn, setTokenIn] = useState('XRGE');
  const [tokenOut, setTokenOut] = useState('');
  const [amountIn, setAmountIn] = useState('');
  const [quoted, setQuoted] = useState<number | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [slippage, setSlippage] = useState(1);
  const [swapping, setSwapping] = useState(false);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [pickerFor, setPickerFor] = useState<'in' | 'out' | null>(null);
  const quoteSeq = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ps = await rc.dex.getPools();
      const list = Array.isArray(ps) ? ps : [];
      setPools(list);
      // Default pair: XRGE → the other side of the first XRGE pool
      const xrgePool = list.find((p) => p.token_a === 'XRGE' || p.token_b === 'XRGE');
      if (xrgePool) {
        setTokenOut((prev) =>
          prev || String(xrgePool.token_a === 'XRGE' ? xrgePool.token_b : xrgePool.token_a),
        );
      } else if (list[0]) {
        setTokenIn(String(list[0].token_a ?? 'XRGE'));
        setTokenOut(String(list[0].token_b ?? ''));
      }
    } catch {
      setPools([]);
    } finally {
      setLoading(false);
    }
    if (wallet) {
      try {
        const b = await rc.getBalance(wallet.publicKey);
        // Prefer the node's exact *_raw integer fields (1.6.4+) when present.
        setBalances({ XRGE: pickXrgeBalance(b as any), ...pickTokenBalances(b as any) });
      } catch {
        /* balances stay empty */
      }
    }
  }, [wallet]);

  useEffect(() => {
    void load();
  }, [load]);

  /** All symbols that appear in any pool */
  const symbols = useMemo(() => {
    const set = new Set<string>();
    for (const p of pools) {
      if (p.token_a) set.add(String(p.token_a));
      if (p.token_b) set.add(String(p.token_b));
    }
    return Array.from(set).sort();
  }, [pools]);

  /** The pool serving the selected pair, if any */
  const activePool = useMemo(
    () =>
      pools.find(
        (p) =>
          (p.token_a === tokenIn && p.token_b === tokenOut) ||
          (p.token_a === tokenOut && p.token_b === tokenIn),
      ) ?? null,
    [pools, tokenIn, tokenOut],
  );

  // Debounced quote. The node's DEX works in raw base units, so the typed
  // (human) amount is converted with tokenIn's real decimals before quoting.
  useEffect(() => {
    let rawAmt: bigint | null = null;
    try {
      if (amountIn.trim()) rawAmt = parseUnits(amountIn, l1TokenDecimals(tokenIn));
    } catch {
      rawAmt = null;
    }
    if (!activePool || rawAmt === null || rawAmt <= 0n) {
      setQuoted(null);
      return;
    }
    const amt = Number(rawAmt);
    const seq = ++quoteSeq.current;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const q = await rc.dex.quote({
          poolId: poolId(activePool),
          tokenIn,
          tokenOut,
          amountIn: amt,
        });
        if (quoteSeq.current === seq) setQuoted(quoteOut(q as Record<string, unknown>));
      } catch {
        if (quoteSeq.current === seq) setQuoted(null);
      } finally {
        if (quoteSeq.current === seq) setQuoting(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [activePool, amountIn, tokenIn, tokenOut]);

  // `quoted` and the balances are raw base units. Keep min-received in raw units
  // (floored) for the swap call; derive human values only for display.
  const minOut = quoted !== null ? Math.floor(quoted * (1 - slippage / 100)) : null;
  const balIn = balances[tokenIn] ?? 0;
  const decimalsIn = l1TokenDecimals(tokenIn);
  // Typed amount (human) → exact raw base units; null when empty/invalid.
  let rawIn: bigint | null = null;
  try {
    if (amountIn.trim()) rawIn = parseUnits(amountIn, decimalsIn);
  } catch {
    rawIn = null;
  }
  const insufficient = rawIn !== null && rawIn > BigInt(Math.trunc(balIn));
  const humanIn = rawIn !== null ? l1ToHuman(tokenIn, Number(rawIn)) : 0;
  const humanOut = quoted !== null ? l1ToHuman(tokenOut, quoted) : 0;

  function flip() {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountIn('');
    setQuoted(null);
  }

  async function onSwap() {
    if (!wallet || !activePool || quoted === null || minOut === null || rawIn === null) return;
    if (rawIn <= 0n) return;
    setSwapping(true);
    try {
      const res = await rc.dex.swap(wallet, {
        tokenIn,
        tokenOut,
        amountIn: Number(rawIn),
        minAmountOut: minOut,
      });
      if (res.success) {
        Alert.alert(
          t('wswap_alert_submitted'),
          `${formatL1Human(tokenIn, humanIn)} ${tokenIn} → ~${formatL1Human(tokenOut, humanOut)} ${tokenOut}`,
        );
        setAmountIn('');
        setQuoted(null);
        void load();
      } else {
        Alert.alert(t('wswap_alert_failed'), res.error ?? t('wswap_unknown_error'));
      }
    } catch (e) {
      Alert.alert(t('wswap_alert_failed'), e instanceof Error ? e.message : t('wswap_network_error'));
    } finally {
      setSwapping(false);
    }
  }

  function TokenSelector({ side, symbol }: { side: 'in' | 'out'; symbol: string }) {
    const { t } = useT();
    return (
      <Pressable
        onPress={() => setPickerFor(pickerFor === side ? null : side)}
        style={({ pressed }) => [styles.tokenBtn, pressed && { opacity: 0.7 }]}>
        <TokenIcon symbol={symbol || '?'} size={22} />
        <Text style={styles.tokenBtnText}>{symbol || t('wswap_select')}</Text>
        <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
      </Pressable>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (pools.length === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="water-outline" size={40} color={colors.textTertiary} />
        <Text style={styles.emptyTitle}>{t('wswap_no_pools_title')}</Text>
        <Text style={styles.emptyText}>{t('wswap_no_pools_text')}</Text>
        <Button title={t('wswap_retry')} variant="secondary" onPress={load} style={{ marginTop: spacing.lg }} />
      </View>
    );
  }

  return (
    <KeyboardAwareScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      bottomOffset={spacing.lg}>
      {/* You pay */}
      <Card style={styles.swapCard}>
        <View style={styles.rowBetween}>
          <Text style={styles.label}>{t('wswap_you_pay')}</Text>
          <Pressable onPress={() => setAmountIn(formatUnits(BigInt(Math.trunc(balIn)), decimalsIn))}>
            <Text style={styles.balanceText}>
              {t('wswap_balance')} {formatL1Human(tokenIn, l1ToHuman(tokenIn, balIn))}{' '}
              <Text style={styles.maxText}>{t('wswap_max')}</Text>
            </Text>
          </Pressable>
        </View>
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.amountInput, insufficient && { color: colors.error }]}
            value={amountIn}
            onChangeText={setAmountIn}
            placeholder="0.0"
            placeholderTextColor={colors.textTertiary}
            keyboardType="decimal-pad"
          />
          <TokenSelector side="in" symbol={tokenIn} />
        </View>
      </Card>

      {/* Flip */}
      <View style={styles.flipWrap}>
        <Pressable onPress={flip} style={({ pressed }) => [styles.flipBtn, pressed && { opacity: 0.7 }]}>
          <Ionicons name="swap-vertical" size={18} color={colors.accent} />
        </Pressable>
      </View>

      {/* You receive */}
      <Card style={styles.swapCard}>
        <View style={styles.rowBetween}>
          <Text style={styles.label}>{t('wswap_you_receive')}</Text>
          {quoting ? <ActivityIndicator size="small" color={colors.accent} /> : null}
        </View>
        <View style={styles.inputRow}>
          <Text style={[styles.amountInput, { color: quoted !== null ? colors.text : colors.textTertiary }]}>
            {quoted !== null ? formatL1Human(tokenOut, humanOut) : '0.0'}
          </Text>
          <TokenSelector side="out" symbol={tokenOut} />
        </View>
      </Card>

      {/* Token picker */}
      {pickerFor !== null && (
        <Card style={styles.pickerCard}>
          {symbols.map((sym) => (
            <Pressable
              key={sym}
              onPress={() => {
                if (pickerFor === 'in') {
                  if (sym === tokenOut) flip();
                  else setTokenIn(sym);
                } else {
                  if (sym === tokenIn) flip();
                  else setTokenOut(sym);
                }
                setPickerFor(null);
                setQuoted(null);
              }}
              style={({ pressed }) => [styles.pickerRow, pressed && { opacity: 0.7 }]}>
              <TokenIcon symbol={sym} size={24} />
              <Text style={styles.pickerSym}>{sym}</Text>
              <Text style={styles.pickerBal}>{formatL1Human(sym, l1ToHuman(sym, balances[sym] ?? 0))}</Text>
            </Pressable>
          ))}
        </Card>
      )}

      {!activePool && tokenIn && tokenOut ? (
        <Text style={styles.warnText}>
          {t('wswap_no_direct_pool_1')}{tokenIn}/{tokenOut}{t('wswap_no_direct_pool_2')}
        </Text>
      ) : null}

      {/* Slippage */}
      <View style={styles.slipRow}>
        <Text style={styles.label}>{t('wswap_slippage')}</Text>
        <View style={styles.slipOptions}>
          {SLIPPAGE_OPTIONS.map((s) => (
            <Pressable
              key={s}
              onPress={() => setSlippage(s)}
              style={[styles.slipBtn, slippage === s && styles.slipBtnActive]}>
              <Text style={[styles.slipBtnText, slippage === s && styles.slipBtnTextActive]}>
                {s}%
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Details */}
      {quoted !== null && minOut !== null && rawIn !== null && rawIn > 0n ? (
        <Card style={styles.detailCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.detailLabel}>{t('wswap_rate')}</Text>
            <Text style={styles.detailValue}>
              1 {tokenIn} ≈ {formatNumber(humanIn > 0 ? humanOut / humanIn : 0, 6)} {tokenOut}
            </Text>
          </View>
          <View style={styles.rowBetween}>
            <Text style={styles.detailLabel}>{t('wswap_min_received')}</Text>
            <Text style={styles.detailValue}>
              {formatL1Human(tokenOut, l1ToHuman(tokenOut, minOut))} {tokenOut}
            </Text>
          </View>
          <View style={styles.rowBetween}>
            <Text style={styles.detailLabel}>{t('wswap_lp_fee')}</Text>
            <Text style={styles.detailValue}>0.3%</Text>
          </View>
        </Card>
      ) : null}

      <Button
        title={insufficient ? `${t('wswap_insufficient')} ${tokenIn}` : t('wswap_swap')}
        loading={swapping}
        disabled={!wallet || !activePool || quoted === null || rawIn === null || rawIn <= 0n || insufficient}
        onPress={onSwap}
        style={{ marginTop: spacing.lg }}
      />
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.bg,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginTop: spacing.md,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 19,
  },
  swapCard: { marginBottom: 0 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  balanceText: { color: colors.textTertiary, fontSize: fontSize.xs },
  maxText: { color: colors.accent, fontWeight: '700' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  amountInput: {
    flex: 1,
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    padding: 0,
  },
  tokenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  tokenBtnText: { color: colors.text, fontWeight: '700', fontSize: fontSize.sm },
  flipWrap: { alignItems: 'center', marginVertical: 6, zIndex: 2 },
  flipBtn: {
    backgroundColor: colors.chrome,
    borderWidth: 1,
    borderColor: colors.borderLight,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerCard: { marginTop: spacing.sm, paddingVertical: spacing.xs },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
  },
  pickerSym: { color: colors.text, fontWeight: '600', fontSize: fontSize.md, flex: 1 },
  pickerBal: { color: colors.textTertiary, fontSize: fontSize.sm },
  warnText: {
    color: colors.warning,
    fontSize: fontSize.xs,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  slipRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  slipOptions: { flexDirection: 'row', gap: spacing.xs },
  slipBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.full,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
  },
  slipBtnActive: { backgroundColor: colors.accentDim, borderColor: colors.accentMid },
  slipBtnText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },
  slipBtnTextActive: { color: colors.accent },
  detailCard: { marginTop: spacing.md, gap: spacing.sm },
  detailLabel: { color: colors.textTertiary, fontSize: fontSize.sm },
  detailValue: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
});
