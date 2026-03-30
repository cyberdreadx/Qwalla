import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PriceChart, type PricePoint } from '@/components/PriceChart';
import { Card } from '@/components/ui/Card';
import { TokenIcon } from '@/components/wallet/TokenIcon';
import { XrgeMark } from '@/components/wallet/XrgeMark';
import { TRANSFER_FEE } from '@/constants/config';
import { colors, fontSize, radius, spacing } from '@/constants/theme';
import { rc } from '@/lib/rougechain';
import { formatNumber, formatXrge } from '@/lib/format';
import { getShieldedBalance } from '@/lib/note-store';
import { useWalletStore } from '@/stores/wallet';
import { formatAddress } from '@rougechain/sdk';
import { nativePubkeyToAddress } from '@/lib/address';

const FALLBACK_TOTAL_SUPPLY = 36_000_000_000;
const CHROME_STORE_URL =
  'https://chromewebstore.google.com/detail/rougechain-wallet/ilkbgjgphhaolfdjkfefdfiifipmhakj';

type Tx = Record<string, unknown>;

export default function WalletHomeScreen() {
  const wallet = useWalletStore((s) => s.wallet);
  const displayName = useWalletStore((s) => s.displayName);
  const logout = useWalletStore((s) => s.logout);

  const [balance, setBalance] = useState<number | null>(null);
  const [shieldedBal, setShieldedBal] = useState<number>(0);
  const [tokens, setTokens] = useState<Record<string, number>>({});
  const [prices, setPrices] = useState<PricePoint[]>([]);
  const [poolLabel, setPoolLabel] = useState('XRGE');
  const [txs, setTxs] = useState<Tx[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [rougeAddr, setRougeAddr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [totalSupply, setTotalSupply] = useState<number>(FALLBACK_TOTAL_SUPPLY);
  const [circulatingSupply, setCirculatingSupply] = useState<number>(0);
  const [minting, setMinting] = useState(false);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [selectedTx, setSelectedTx] = useState<number | null>(null);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    Animated.timing(toastOpacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(
        () => setToast(null)
      );
    }, 3500);
  }

  const load = useCallback(async () => {
    if (!wallet) return;
    try {
      const b = await rc.getBalance(wallet.publicKey);
      setBalance(typeof b.balance === 'number' ? b.balance : Number(b.balance));
      const toks = (b as any).token_balances ?? (b as any).tokens;
      if (toks && typeof toks === 'object') {
        setTokens(toks as Record<string, number>);
      }
      try {
        const sb = await getShieldedBalance(wallet.publicKey);
        setShieldedBal(sb);
      } catch { /* shielded balance optional */ }

      try {
        const holdersData = (await rc.get('/token/XRGE/holders')) as {
          success?: boolean;
          total_supply?: number;
          circulating_supply?: number;
          holders?: { balance: number }[];
        };
        if (holdersData?.success) {
          if (holdersData.total_supply && holdersData.total_supply > 0) {
            setTotalSupply(holdersData.total_supply);
          }
          if (holdersData.holders && holdersData.holders.length > 0) {
            const holderSum = holdersData.holders.reduce((sum, h) => sum + h.balance, 0);
            if (holderSum > 0) setCirculatingSupply(holderSum);
          } else if (holdersData.circulating_supply && holdersData.circulating_supply > 0) {
            setCirculatingSupply(holdersData.circulating_supply);
          }
        }
      } catch {
        try {
          const statsRaw = (await rc.getStats()) as Record<string, unknown>;
          const supply = Number(
            statsRaw.circulatingSupply ?? statsRaw.circulating_supply ?? statsRaw.totalMinted ?? 0
          );
          if (supply > 0) setCirculatingSupply(supply);
        } catch {
          /* stats optional */
        }
      }

      const pools = (await rc.dex.getPools()) as {
        id?: string;
        token_a?: string;
        token_b?: string;
      }[];
      const xrgePool = pools.find(
        (p) =>
          p.token_a === 'XRGE' ||
          p.token_b === 'XRGE' ||
          (p.id && String(p.id).includes('XRGE'))
      );
      const poolId = xrgePool?.id ?? pools[0]?.id;
      if (poolId) {
        setPoolLabel(String(poolId));
        const hist = (await rc.dex.getPriceHistory(String(poolId))) as PricePoint[];
        setPrices(Array.isArray(hist) ? hist : []);
      } else {
        setPrices([]);
      }

      try {
        const raw = await rc.getTransactions({ limit: 200 });

        let rawArr: Record<string, unknown>[] = [];
        if (Array.isArray(raw)) {
          rawArr = raw as Record<string, unknown>[];
        } else if (raw && typeof raw === 'object') {
          const obj = raw as Record<string, unknown>;
          const found = obj.txs ?? obj.transactions ?? obj.data;
          if (Array.isArray(found)) rawArr = found as Record<string, unknown>[];
        }

        const flat: Tx[] = rawArr.map((entry) => {
          const inner = (entry.tx ?? {}) as Record<string, unknown>;
          const payload = (inner.payload ?? {}) as Record<string, unknown>;
          return {
            txId: entry.txId ?? entry.tx_id ?? entry.hash ?? entry.id,
            blockHeight: entry.blockHeight ?? entry.block_height,
            blockTime: entry.blockTime ?? entry.block_time,
            txType:
              inner.tx_type ?? inner.txType ?? inner.type ?? entry.type,
            from:
              inner.from_pub_key ??
              inner.fromPubKey ??
              inner.from ??
              inner.sender ??
              entry.from ??
              entry.sender,
            to:
              payload.to_pub_key_hex ??
              payload.toPubKeyHex ??
              payload.to ??
              payload.recipient ??
              inner.to ??
              entry.to,
            amount: payload.amount ?? payload.amount_in ?? inner.amount ?? entry.amount ?? 0,
            fee: payload.fee ?? inner.fee ?? entry.fee,
            token:
              payload.token_symbol ??
              payload.tokenSymbol ??
              payload.token ??
              inner.token ??
              'XRGE',
            tokenIn: payload.token_in ?? inner.token_in,
            tokenOut: payload.token_out ?? inner.token_out,
            faucet: payload.faucet,
            reason: payload.reason,
          };
        });

        const pk = wallet.publicKey.toLowerCase();
        const mine = flat.filter((t) => {
          const from = String(t.from ?? '').toLowerCase();
          const to = String(t.to ?? '').toLowerCase();
          return from === pk || to === pk;
        });

        setTxs(mine.length > 0 ? mine.slice(0, 25) : flat.slice(0, 25));
      } catch {
        setTxs([]);
      }
    } catch (e) {
      if (Platform.OS === 'web') console.error('Wallet load error', e);
      else Alert.alert('Network', e instanceof Error ? e.message : 'Failed to load wallet');
    }
  }, [wallet]);

  useEffect(() => {
    if (!wallet) return;
    try {
      setRougeAddr(nativePubkeyToAddress(wallet.publicKey));
    } catch {
      setRougeAddr(null);
    }
  }, [wallet]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  useEffect(() => {
    void load();
  }, [load]);

  async function onFaucet() {
    if (!wallet) return;
    setMinting(true);
    try {
      const result = await rc.faucet(wallet);
      if (!result.success) {
        showToast(result.error ?? 'Faucet failed', 'error');
        return;
      }
      showToast('Claimed XRGE! Balance updating…');
      await load();
      for (const ms of [800, 1600, 2400]) {
        await new Promise((r) => setTimeout(r, ms));
        await load();
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Faucet error', 'error');
    } finally {
      setMinting(false);
    }
  }

  async function copyAddr() {
    const line = rougeAddr ?? wallet?.publicKey;
    if (!line) return;
    await Clipboard.setStringAsync(line);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDisconnect() {
    if (Platform.OS === 'web') {
      if (window.confirm('Disconnect wallet? You can restore it with your recovery phrase.')) {
        void logout();
      }
    } else {
      Alert.alert('Disconnect wallet?', 'You can restore it with your recovery phrase.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => void logout() },
      ]);
    }
  }

  if (!wallet) return null;

  const balStr = balance !== null ? formatXrge(balance) : '—';
  const supplyPct =
    circulatingSupply > 0 ? ((circulatingSupply / totalSupply) * 100).toFixed(4) : '0';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {toast && (
        <Animated.View
          style={[
            styles.toast,
            toast.type === 'error' ? styles.toastError : styles.toastSuccess,
            { opacity: toastOpacity },
          ]}>
          <Ionicons
            name={toast.type === 'error' ? 'close-circle' : 'checkmark-circle'}
            size={18}
            color="#fff"
          />
          <Text style={styles.toastText}>{toast.message}</Text>
        </Animated.View>
      )}

      {/* Header */}
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <Image source={require('@/assets/images/koala-mascot.png')} style={styles.mascot} />
          <View>
            <Text style={styles.screenTitle}>QWALLA</Text>
            <Text style={styles.screenSub}>{displayName || 'Wallet'}</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <Pressable
            onPress={() => router.push('/(tabs)/settings')}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}>
            <Ionicons name="key-outline" size={18} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onRefresh}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}>
            {refreshing ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Ionicons name="refresh" size={20} color={colors.textSecondary} />
            )}
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }>
        {/* Balance card */}
        <LinearGradient
          colors={['#12151D', '#161B28', '#1A1F30']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}>
          <View style={styles.heroTop}>
            <XrgeMark size={48} />
            <View style={styles.heroInfo}>
              <View style={styles.pillRow}>
                <View style={styles.pill}>
                  <Text style={styles.pillLabel}>Testnet</Text>
                </View>
                <View style={[styles.pill, styles.pillAccent]}>
                  <Text style={styles.pillAccentLabel}>ML-DSA-65</Text>
                </View>
              </View>
              <View style={styles.balRow}>
                <Text style={styles.balNum}>{balStr}</Text>
                <Text style={styles.balSym}>XRGE</Text>
              </View>
              <Text style={styles.feeHint}>Transfer fee · {TRANSFER_FEE} XRGE</Text>
              {shieldedBal > 0 && (
                <View style={styles.shieldedRow}>
                  <Ionicons name="shield-checkmark" size={12} color={colors.accent} />
                  <Text style={styles.shieldedText}>
                    {formatNumber(shieldedBal)} XRGE shielded
                  </Text>
                </View>
              )}
            </View>
          </View>

          <Pressable onPress={copyAddr} style={styles.addrRow}>
            <Ionicons name="copy-outline" size={13} color={colors.textTertiary} />
            <Text style={styles.addrText} numberOfLines={1}>
              {rougeAddr
                ? formatAddress(rougeAddr, 14, 6)
                : `${wallet.publicKey.slice(0, 14)}…`}
            </Text>
            {copied ? <Text style={styles.copiedTag}>Copied</Text> : null}
          </Pressable>
        </LinearGradient>

        {/* Quick actions — matches reference layout */}
        <Text style={styles.section}>Quick Actions</Text>
        <View style={styles.actionGrid}>
          <Pressable
            onPress={() => router.push('/(tabs)/wallet/send')}
            style={({ pressed }) => [styles.actionCell, pressed && { opacity: 0.8 }]}>
            <View style={[styles.actionIcon, { backgroundColor: 'rgba(31,224,197,0.12)' }]}>
              <Ionicons name="arrow-up" size={18} color={colors.accent} />
            </View>
            <Text style={styles.actionLabel}>Send</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push('/(tabs)/wallet/receive')}
            style={({ pressed }) => [styles.actionCell, pressed && { opacity: 0.8 }]}>
            <View style={[styles.actionIcon, { backgroundColor: 'rgba(46,230,168,0.12)' }]}>
              <Ionicons name="arrow-down" size={18} color={colors.success} />
            </View>
            <Text style={styles.actionLabel}>Receive</Text>
          </Pressable>

          <Pressable
            onPress={onFaucet}
            disabled={minting}
            style={({ pressed }) => [styles.actionCell, pressed && { opacity: 0.8 }]}>
            <View style={[styles.actionIcon, { backgroundColor: 'rgba(108,92,231,0.12)' }]}>
              {minting ? (
                <ActivityIndicator size="small" color={colors.purple} />
              ) : (
                <Ionicons name="water" size={18} color={colors.purple} />
              )}
            </View>
            <Text style={styles.actionLabel}>Faucet</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push('/(tabs)/wallet/shield')}
            style={({ pressed }) => [styles.actionCell, pressed && { opacity: 0.8 }]}>
            <View style={[styles.actionIcon, { backgroundColor: 'rgba(31,224,197,0.12)' }]}>
              <Ionicons name="shield-checkmark" size={18} color={colors.accent} />
            </View>
            <Text style={styles.actionLabel}>Shield</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push('/(tabs)/wallet/create-token')}
            style={({ pressed }) => [styles.actionCell, pressed && { opacity: 0.8 }]}>
            <View style={[styles.actionIcon, { backgroundColor: 'rgba(31,224,197,0.12)' }]}>
              <Ionicons name="add" size={18} color={colors.accent} />
            </View>
            <Text style={styles.actionLabel}>Create</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push('/(tabs)/settings')}
            style={({ pressed }) => [styles.actionCell, pressed && { opacity: 0.8 }]}>
            <View style={[styles.actionIcon, { backgroundColor: 'rgba(253,203,110,0.12)' }]}>
              <Ionicons name="key" size={18} color={colors.warning} />
            </View>
            <Text style={styles.actionLabel}>Backup</Text>
          </Pressable>

          <Pressable
            onPress={handleDisconnect}
            style={({ pressed }) => [styles.actionCell, pressed && { opacity: 0.8 }]}>
            <View style={[styles.actionIcon, { backgroundColor: 'rgba(255,107,107,0.12)' }]}>
              <Ionicons name="log-out-outline" size={18} color={colors.error} />
            </View>
            <Text style={styles.actionLabel}>Disconnect</Text>
          </Pressable>
        </View>

        {/* XRGE Token Info — matches reference */}
        <Text style={[styles.section, { marginTop: spacing.lg }]}>XRGE Token Info</Text>
        <Card style={styles.infoCard}>
          <View style={styles.infoSubCard}>
            <Text style={styles.infoSubLabel}>Token Type</Text>
            <Text style={styles.infoSubValue}>Native Chain Token</Text>
            <Text style={styles.infoSubHint}>XRGE is the native currency of RougeChain</Text>
          </View>

          <View style={styles.infoGrid}>
            <View style={styles.infoGridCell}>
              <Text style={styles.infoStatLabel}>Name</Text>
              <Text style={styles.infoStatValue}>XRGE</Text>
            </View>
            <View style={styles.infoGridCell}>
              <Text style={styles.infoStatLabel}>Network</Text>
              <Text style={styles.infoStatValue}>Testnet</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoRowLabel}>Total Supply</Text>
            <Text style={styles.infoRowValue}>{formatNumber(totalSupply)}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoRowLabel}>Circulating</Text>
            <Text style={styles.infoRowValue}>{formatNumber(circulatingSupply)}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoRowLabel}>Remaining</Text>
            <Text style={[styles.infoRowValue, { color: colors.accent }]}>
              {formatNumber(totalSupply - circulatingSupply)}
            </Text>
          </View>

          <View style={styles.supplyBarBg}>
            <View
              style={[
                styles.supplyBarFill,
                { width: `${Math.min(100, Number(supplyPct))}%` },
              ]}
            />
          </View>
          <Text style={styles.supplyPct}>{supplyPct}% in circulation</Text>
        </Card>

        {/* Assets */}
        <Text style={[styles.section, { marginTop: spacing.lg }]}>Assets</Text>
        <Card>
          {Object.keys(tokens).length === 0 ? (
            <View style={styles.emptyTokens}>
              <Ionicons name="layers-outline" size={24} color={colors.textTertiary} />
              <Text style={styles.mutedText}>
                No tokens yet — fund the wallet or swap on-chain.
              </Text>
            </View>
          ) : (
            Object.entries(tokens).map(([sym, amt]) => {
              const raw = Number(amt);
              const isStable = sym === 'qUSDC';
              const display = isStable ? raw / 1_000_000 : raw;
              const isOpen = selectedToken === sym;
              return (
                <View key={sym}>
                  <Pressable
                    onPress={() => setSelectedToken(isOpen ? null : sym)}
                    style={({ pressed }) => [styles.tokenRow, pressed && { opacity: 0.7 }]}
                  >
                    <View style={styles.tokenLeft}>
                      <TokenIcon symbol={sym} size={28} />
                      <Text style={styles.tokenSym}>{sym}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.tokenAmt}>{formatNumber(display, isStable ? 2 : 4)}</Text>
                      <Ionicons
                        name={isOpen ? 'chevron-up' : 'chevron-down'}
                        size={14}
                        color={colors.textTertiary}
                      />
                    </View>
                  </Pressable>
                  {isOpen && (
                    <View style={styles.tokenDetail}>
                      <View style={styles.tokenDetailRow}>
                        <Text style={styles.tokenDetailLabel}>Symbol</Text>
                        <Text style={styles.tokenDetailValue}>{sym}</Text>
                      </View>
                      <View style={styles.tokenDetailRow}>
                        <Text style={styles.tokenDetailLabel}>Balance</Text>
                        <Text style={styles.tokenDetailValue}>
                          {formatNumber(display, isStable ? 2 : 4)} {sym}
                        </Text>
                      </View>
                      <View style={styles.tokenDetailRow}>
                        <Text style={styles.tokenDetailLabel}>Raw Units</Text>
                        <Text style={styles.tokenDetailValue}>{formatNumber(raw, 0)}</Text>
                      </View>
                      {isStable && (
                        <View style={styles.tokenDetailRow}>
                          <Text style={styles.tokenDetailLabel}>Decimals</Text>
                          <Text style={styles.tokenDetailValue}>6</Text>
                        </View>
                      )}
                      <View style={styles.tokenDetailRow}>
                        <Text style={styles.tokenDetailLabel}>Network</Text>
                        <Text style={styles.tokenDetailValue}>RougeChain Testnet</Text>
                      </View>
                      <Pressable
                        onPress={() => Linking.openURL(`https://rougechain.io/token/${sym}`)}
                        style={styles.tokenDetailLink}
                      >
                        <Ionicons name="open-outline" size={12} color={colors.accent} />
                        <Text style={styles.tokenDetailLinkText}>View on Explorer</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </Card>

        {/* Recent activity */}
        <Text style={[styles.section, { marginTop: spacing.lg }]}>Recent Activity</Text>
        <Card style={styles.txCard}>
          {txs.length === 0 ? (
            <View style={styles.emptyTokens}>
              <Ionicons name="receipt-outline" size={24} color={colors.textTertiary} />
              <Text style={styles.mutedText}>No recent transactions</Text>
            </View>
          ) : (
            txs.map((tx, i) => {
              const from = String(tx.from ?? '');
              const to = String(tx.to ?? '');
              const pk = wallet.publicKey.toLowerCase();
              const isSend = from.toLowerCase() === pk;
              const counterparty = isSend ? to : from;
              const rawAmt = Number(tx.amount ?? 0);
              const sym = String(tx.token ?? 'XRGE');
              const amt = sym === 'qUSDC' ? rawAmt / 1_000_000 : rawAmt;
              const txType = String(tx.txType ?? '');
              const txId = String(tx.txId ?? '');

              const isFaucet = txType.includes('faucet') || tx.faucet != null;
              const isSwap = txType === 'swap' || txType.includes('swap') || (tx.tokenIn != null && tx.tokenOut != null);
              const isDeploy = txType.includes('deploy') || txType.includes('create');

              let timeStr = '';
              const bt = tx.blockTime;
              if (bt && typeof bt === 'number') {
                try {
                  const d = new Date(bt > 1e12 ? bt : bt * 1000);
                  if (!isNaN(d.getTime())) {
                    const diffMin = Math.floor((Date.now() - d.getTime()) / 60_000);
                    if (diffMin < 1) timeStr = 'Just now';
                    else if (diffMin < 60) timeStr = `${diffMin}m ago`;
                    else if (diffMin < 1440) timeStr = `${Math.floor(diffMin / 60)}h ago`;
                    else
                      timeStr = d.toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      });
                  }
                } catch {
                  /* ignore */
                }
              }

              let label: string;
              let iconName: string;
              let iconColor: string;
              let iconBg: string;

              const isShield = txType === 'shield';
              const isUnshield = txType === 'unshield';

              if (isShield) {
                label = 'Shield';
                iconName = 'shield-checkmark';
                iconColor = colors.accent;
                iconBg = 'rgba(31,224,197,0.1)';
              } else if (isUnshield) {
                label = 'Unshield';
                iconName = 'shield-outline';
                iconColor = colors.success;
                iconBg = 'rgba(46,230,168,0.1)';
              } else if (isFaucet) {
                label = 'Faucet';
                iconName = 'water';
                iconColor = colors.purple;
                iconBg = 'rgba(108,92,231,0.1)';
              } else if (isDeploy) {
                label = 'Contract';
                iconName = 'code-slash';
                iconColor = colors.warning;
                iconBg = 'rgba(253,203,110,0.1)';
              } else if (isSwap) {
                const tIn = String(tx.tokenIn ?? '');
                const tOut = String(tx.tokenOut ?? '');
                label = tIn && tOut ? `Swap ${tIn} → ${tOut}` : 'Swap';
                iconName = 'swap-horizontal';
                iconColor = '#E9A820';
                iconBg = 'rgba(233,168,32,0.1)';
              } else if (isSend) {
                label = 'Sent';
                iconName = 'arrow-up-circle';
                iconColor = colors.error;
                iconBg = 'rgba(255,107,107,0.1)';
              } else {
                label = 'Received';
                iconName = 'arrow-down-circle';
                iconColor = colors.success;
                iconBg = 'rgba(46,230,168,0.1)';
              }

              const isTxOpen = selectedTx === i;
              const blockH = tx.blockHeight ? String(tx.blockHeight) : null;
              const feeVal = tx.fee != null ? Number(tx.fee) : null;

              return (
                <View key={`${txId || 'tx'}-${i}`}>
                  <Pressable
                    onPress={() => setSelectedTx(isTxOpen ? null : i)}
                    style={({ pressed }) => [
                      styles.txRow,
                      !isTxOpen && i < txs.length - 1 && styles.txRowBorder,
                      pressed && { opacity: 0.7 },
                    ]}>
                    <View style={[styles.txIcon, { backgroundColor: iconBg }]}>
                      <Ionicons
                        name={iconName as 'arrow-up-circle'}
                        size={20}
                        color={iconColor}
                      />
                    </View>
                    <View style={styles.txInfo}>
                      <Text style={styles.txLabel}>{label}</Text>
                      {counterparty ? (
                        <Text style={styles.txAddr} numberOfLines={1}>
                          {counterparty.length > 16
                            ? `${counterparty.slice(0, 10)}…${counterparty.slice(-4)}`
                            : counterparty}
                        </Text>
                      ) : txId ? (
                        <Text style={styles.txAddr} numberOfLines={1}>
                          {txId.slice(0, 14)}…
                        </Text>
                      ) : null}
                    </View>
                    <View style={styles.txRight}>
                      {amt > 0 ? (
                        <Text
                          style={[
                            styles.txAmount,
                            isSend && !isFaucet ? styles.txAmountSend : styles.txAmountRecv,
                          ]}>
                          {isSend && !isFaucet ? '−' : '+'}
                          {sym === 'qUSDC' ? formatNumber(amt, 2) : formatXrge(amt)} {sym}
                        </Text>
                      ) : (
                        <Text style={[styles.txAmount, { color: colors.textTertiary }]}>
                          {txType || '—'}
                        </Text>
                      )}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        {timeStr ? <Text style={styles.txTime}>{timeStr}</Text> : null}
                        <Ionicons
                          name={isTxOpen ? 'chevron-up' : 'chevron-down'}
                          size={12}
                          color={colors.textTertiary}
                        />
                      </View>
                    </View>
                  </Pressable>
                  {isTxOpen && (
                    <View style={styles.txDetail}>
                      <View style={styles.txDetailRow}>
                        <Text style={styles.txDetailLabel}>Type</Text>
                        <Text style={styles.txDetailValue}>{txType || label}</Text>
                      </View>
                      {amt > 0 && (
                        <View style={styles.txDetailRow}>
                          <Text style={styles.txDetailLabel}>Amount</Text>
                          <Text style={styles.txDetailValue}>
                            {sym === 'qUSDC' ? formatNumber(amt, 2) : formatXrge(amt)} {sym}
                          </Text>
                        </View>
                      )}
                      {feeVal != null && feeVal > 0 && (
                        <View style={styles.txDetailRow}>
                          <Text style={styles.txDetailLabel}>Fee</Text>
                          <Text style={styles.txDetailValue}>{formatXrge(feeVal)} XRGE</Text>
                        </View>
                      )}
                      {from ? (
                        <View style={styles.txDetailRow}>
                          <Text style={styles.txDetailLabel}>From</Text>
                          <Text style={styles.txDetailValue} numberOfLines={1}>
                            {from.length > 20 ? `${from.slice(0, 12)}…${from.slice(-6)}` : from}
                          </Text>
                        </View>
                      ) : null}
                      {to ? (
                        <View style={styles.txDetailRow}>
                          <Text style={styles.txDetailLabel}>To</Text>
                          <Text style={styles.txDetailValue} numberOfLines={1}>
                            {to.length > 20 ? `${to.slice(0, 12)}…${to.slice(-6)}` : to}
                          </Text>
                        </View>
                      ) : null}
                      {isSwap && tx.tokenIn && tx.tokenOut && (
                        <>
                          <View style={styles.txDetailRow}>
                            <Text style={styles.txDetailLabel}>Swap</Text>
                            <Text style={styles.txDetailValue}>
                              {String(tx.tokenIn)} → {String(tx.tokenOut)}
                            </Text>
                          </View>
                        </>
                      )}
                      {blockH && (
                        <View style={styles.txDetailRow}>
                          <Text style={styles.txDetailLabel}>Block</Text>
                          <Text style={styles.txDetailValue}>#{formatNumber(Number(blockH), 0)}</Text>
                        </View>
                      )}
                      {txId ? (
                        <View style={styles.txDetailRow}>
                          <Text style={styles.txDetailLabel}>Tx Hash</Text>
                          <Pressable
                            onPress={async () => {
                              await Clipboard.setStringAsync(txId);
                              showToast('Transaction hash copied');
                            }}>
                            <Text style={[styles.txDetailValue, { color: colors.accent }]} numberOfLines={1}>
                              {txId.slice(0, 16)}… <Ionicons name="copy-outline" size={10} color={colors.accent} />
                            </Text>
                          </Pressable>
                        </View>
                      ) : null}
                      <View style={styles.txDetailRow}>
                        <Text style={styles.txDetailLabel}>Network</Text>
                        <Text style={styles.txDetailValue}>RougeChain Testnet</Text>
                      </View>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </Card>

        {/* DEX */}
        <Text style={[styles.section, { marginTop: spacing.lg }]}>DEX Price</Text>
        <Card style={styles.chartCard}>
          <PriceChart points={prices} label={poolLabel} />
        </Card>

        {/* Security Status — matches reference */}
        <Text style={[styles.section, { marginTop: spacing.lg }]}>Security</Text>
        <Card style={styles.infoCard}>
          <View style={styles.secRow}>
            <Ionicons name="shield-checkmark" size={18} color={colors.accent} />
            <View style={styles.secInfo}>
              <Text style={styles.secTitle}>Signatures</Text>
              <Text style={styles.secDetail}>ML-DSA-65 (FIPS 204) — quantum-resistant</Text>
            </View>
          </View>
          <View style={styles.secRow}>
            <Ionicons name="lock-closed" size={18} color={colors.accent} />
            <View style={styles.secInfo}>
              <Text style={styles.secTitle}>Encryption</Text>
              <Text style={styles.secDetail}>ML-KEM-768 (FIPS 203) + AES-256-GCM</Text>
            </View>
          </View>
          <View style={styles.secRow}>
            <Ionicons name="finger-print" size={18} color={colors.accent} />
            <View style={styles.secInfo}>
              <Text style={styles.secTitle}>Key Storage</Text>
              <Text style={styles.secDetail}>
                {Platform.OS === 'web' ? 'Browser localStorage' : 'Device secure store'}
              </Text>
            </View>
          </View>
          <View style={[styles.secRow, { borderBottomWidth: 0 }]}>
            <Ionicons name="desktop-outline" size={18} color={colors.accent} />
            <View style={styles.secInfo}>
              <Text style={styles.secTitle}>Signing</Text>
              <Text style={styles.secDetail}>Client-side — keys never leave your device</Text>
            </View>
          </View>
        </Card>

        {/* Extension promo — matches reference */}
        <Pressable
          onPress={() => void Linking.openURL(CHROME_STORE_URL)}
          style={({ pressed }) => [styles.extPromo, pressed && { opacity: 0.85 }]}>
          <View style={styles.extIcon}>
            <Ionicons name="extension-puzzle" size={22} color={colors.accent} />
          </View>
          <View style={styles.extInfo}>
            <Text style={styles.extTitle}>RougeChain Wallet Extension</Text>
            <Text style={styles.extSub}>Chrome · Edge · Brave · Firefox · Arc · Opera</Text>
          </View>
          <Ionicons name="open-outline" size={16} color={colors.textTertiary} />
        </Pressable>

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  screenTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mascot: { width: 32, height: 32, borderRadius: 16 },
  screenSub: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  iconBtn: { padding: spacing.sm },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },

  toast: {
    position: 'absolute',
    top: 8,
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  toastSuccess: { backgroundColor: colors.success },
  toastError: { backgroundColor: colors.error },
  toastText: { color: '#fff', fontWeight: '600', fontSize: 14, flex: 1 },

  hero: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  heroInfo: { flex: 1 },
  pillRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  pillLabel: { color: colors.textTertiary, fontSize: 10, fontWeight: '700' },
  pillAccent: { backgroundColor: colors.accentDim },
  pillAccentLabel: { color: colors.accent, fontSize: 10, fontWeight: '700' },
  balRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  balNum: {
    color: colors.text,
    fontSize: fontSize.hero,
    fontWeight: '800',
    letterSpacing: -1,
  },
  balSym: { color: colors.accent, fontSize: fontSize.md, fontWeight: '700' },
  feeHint: { color: colors.textTertiary, fontSize: 11, marginTop: 4 },
  shieldedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  shieldedText: { color: colors.accent, fontSize: 11, fontWeight: '600' },
  addrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  addrText: {
    flex: 1,
    color: colors.textTertiary,
    fontSize: 12,
    fontFamily: 'SpaceMono',
  },
  copiedTag: { color: colors.accent, fontSize: 11, fontWeight: '600' },

  section: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },

  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: spacing.lg,
  },
  actionCell: {
    width: '31%',
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: 14,
    gap: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
  },

  infoCard: { marginBottom: spacing.md },
  infoSubCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  infoSubLabel: { color: colors.textTertiary, fontSize: 10, marginBottom: 2 },
  infoSubValue: { color: colors.text, fontSize: 12, fontWeight: '600' },
  infoSubHint: { color: colors.textTertiary, fontSize: 10, marginTop: 4 },
  infoGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: spacing.md,
  },
  infoGridCell: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  infoStatLabel: { color: colors.textTertiary, fontSize: 10 },
  infoStatValue: { color: colors.text, fontSize: 12, fontWeight: '600', marginTop: 2 },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  infoRowLabel: { color: colors.textTertiary, fontSize: 12 },
  infoRowValue: { color: colors.text, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  supplyBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surface,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  supplyBarFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  supplyPct: {
    color: colors.textTertiary,
    fontSize: 10,
    textAlign: 'center',
    marginTop: 4,
  },

  chartCard: { marginBottom: spacing.md, paddingVertical: spacing.sm },
  emptyTokens: { alignItems: 'center', paddingVertical: spacing.md, gap: spacing.sm },
  mutedText: {
    color: colors.textSecondary,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 19,
  },
  tokenRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tokenLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tokenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
    opacity: 0.7,
  },
  tokenSym: { color: colors.text, fontWeight: '700', fontSize: 15 },
  tokenAmt: { color: colors.textSecondary, fontWeight: '600', fontSize: 15 },
  tokenDetail: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: 6,
  },
  tokenDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tokenDetailLabel: { color: colors.textTertiary, fontSize: 11 },
  tokenDetailValue: { color: colors.text, fontSize: 11, fontWeight: '600', fontFamily: 'SpaceMono' },
  tokenDetailLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 4,
    paddingVertical: 8,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(31,224,197,0.08)',
  },
  tokenDetailLinkText: { color: colors.accent, fontSize: 11, fontWeight: '600' },

  txDetail: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: 6,
  },
  txDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  txDetailLabel: { color: colors.textTertiary, fontSize: 11 },
  txDetailValue: { color: colors.text, fontSize: 11, fontWeight: '600', fontFamily: 'SpaceMono', maxWidth: '60%' },

  txCard: { marginBottom: spacing.md },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: spacing.sm,
  },
  txRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  txIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txInfo: { flex: 1 },
  txLabel: { color: colors.text, fontWeight: '600', fontSize: 14 },
  txAddr: {
    color: colors.textTertiary,
    fontSize: 11,
    fontFamily: 'SpaceMono',
    marginTop: 2,
  },
  txRight: { alignItems: 'flex-end' },
  txAmount: { fontWeight: '700', fontSize: 14 },
  txAmountSend: { color: colors.error },
  txAmountRecv: { color: colors.success },
  txTime: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },

  secRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  secInfo: { flex: 1 },
  secTitle: { color: colors.text, fontSize: 13, fontWeight: '600' },
  secDetail: { color: colors.textTertiary, fontSize: 11, marginTop: 2, lineHeight: 16 },

  extPromo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    marginTop: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(31,224,197,0.2)',
  },
  extIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: 'rgba(31,224,197,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  extInfo: { flex: 1 },
  extTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
  extSub: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
});
