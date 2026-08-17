import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { TokenIcon } from '@/components/wallet/TokenIcon';
import { colors, fontSize, radius, spacing } from '@/constants/theme';
import { fetchBaseAssets, getEvmAddress, type BaseAsset } from '@/lib/base-assets';
import { formatNumber } from '@/lib/format';
import { rc } from '@/lib/rougechain';
import { useWalletStore } from '@/stores/wallet';

/**
 * Native Base (L2) balances on the wallet home: ETH + XRGE with USD values
 * (priced via DexScreener). Rendered only when the wallet has a seed to derive
 * an EVM address from. Read-only — funding/bridging happens on the bridge page.
 */
export function BaseAssets() {
  const mnemonic = useWalletStore((s) => s.mnemonic);
  const [address, setAddress] = useState<string | null>(null);
  const [assets, setAssets] = useState<BaseAsset[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (addr: string) => {
    setLoading(true);
    try {
      let xrgeToken: string | undefined;
      let chainId: number | undefined;
      try {
        const cfg = (await rc.bridge.getXrgeConfig()) as { tokenAddress?: string; chainId?: number };
        xrgeToken = cfg?.tokenAddress;
        chainId = cfg?.chainId;
      } catch {
        /* bridge config unavailable — still show ETH */
      }
      return await fetchBaseAssets({ address: addr, xrgeToken, chainId });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const addr = getEvmAddress();
    setAddress(addr);
    if (!addr) return;
    let cancelled = false;
    void load(addr).then((list) => {
      if (!cancelled) setAssets(list);
    });
    return () => {
      cancelled = true;
    };
  }, [mnemonic, load]);

  if (!address) return null;

  const totalUsd = (assets ?? []).reduce((sum, a) => sum + (a.usd ?? 0), 0);
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;

  const copyAddress = async () => {
    await Clipboard.setStringAsync(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <View style={styles.sectionRow}>
        <Text style={styles.section}>Base</Text>
        {totalUsd > 0 && <Text style={styles.total}>${formatNumber(totalUsd, 2)}</Text>}
      </View>
      <Card>
        {loading && !assets ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          (assets ?? []).map((a) => (
            <View key={a.symbol} style={styles.row}>
              <View style={styles.left}>
                <TokenIcon symbol={a.symbol === 'ETH' ? 'qETH' : a.symbol} size={28} />
                <View>
                  <Text style={styles.sym}>{a.symbol}</Text>
                  <Text style={styles.muted}>
                    {a.priceUsd != null ? `$${formatNumber(a.priceUsd, a.priceUsd < 1 ? 6 : 2)}` : '—'}
                  </Text>
                </View>
              </View>
              <View style={styles.right}>
                <Text style={styles.amt}>{formatNumber(a.balance, 4)}</Text>
                <Text style={styles.muted}>{a.usd != null ? `$${formatNumber(a.usd, 2)}` : '—'}</Text>
              </View>
            </View>
          ))
        )}

        <Pressable onPress={copyAddress} style={({ pressed }) => [styles.addrChip, pressed && { opacity: 0.7 }]}>
          <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={13} color={colors.textTertiary} />
          <Text style={styles.addrText}>{copied ? 'Copied' : short}</Text>
          <Text style={styles.addrHint}>· fund on Base</Text>
        </Pressable>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  section: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '700' },
  total: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  center: { paddingVertical: spacing.lg, alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sym: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  right: { alignItems: 'flex-end' },
  amt: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  muted: { color: colors.textTertiary, fontSize: fontSize.xs, marginTop: 1 },
  addrChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.input,
  },
  addrText: { color: colors.textSecondary, fontSize: fontSize.xs, fontFamily: 'SpaceMono' },
  addrHint: { color: colors.textTertiary, fontSize: fontSize.xs },
});
