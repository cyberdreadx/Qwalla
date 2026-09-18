import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing, radius, fontSize } from '@/constants/theme';
import {
  fetchCryptoNews,
  fetchMarkets,
  timeAgo,
  formatPrice,
  type NewsItem,
  type CoinMarket,
} from '@/lib/crypto-news';

function Sparkline({ data, up }: { data: number[]; up: boolean }) {
  const W = 104;
  const H = 34;
  if (!data || data.length < 2) return <View style={{ width: W, height: H }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = W / (data.length - 1);
  const points = data
    .map((v, i) => `${(i * step).toFixed(1)},${(H - ((v - min) / range) * H).toFixed(1)}`)
    .join(' ');
  return (
    <Svg width={W} height={H}>
      <Polyline
        points={points}
        fill="none"
        stroke={up ? colors.success : colors.error}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Crypto news + market feed for the browser home. Tapping a story opens it in
 *  the WebView browser via `onOpen`. Free, no-key data (RSS + CoinGecko). */
export default function CryptoNewsFeed({ onOpen }: { onOpen: (url: string) => void }) {
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [markets, setMarkets] = useState<CoinMarket[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [n, m] = await Promise.all([fetchCryptoNews(), fetchMarkets()]);
    setNews(n);
    setMarkets(m);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.wrap}>
      {markets.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Markets</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.marketRow}
          >
            {markets.map((c) => {
              const up = c.change24h >= 0;
              return (
                <View key={c.id} style={styles.coinCard}>
                  <View style={styles.coinTop}>
                    <Image source={{ uri: c.image }} style={styles.coinIcon} />
                    <Text style={styles.coinSym}>{c.symbol}</Text>
                  </View>
                  <Sparkline data={c.sparkline} up={up} />
                  <Text style={styles.coinPrice}>{formatPrice(c.price)}</Text>
                  <Text style={[styles.coinChg, { color: up ? colors.success : colors.error }]}>
                    {up ? '▲' : '▼'} {Math.abs(c.change24h).toFixed(2)}%
                  </Text>
                </View>
              );
            })}
          </ScrollView>
        </>
      )}

      <View style={styles.newsHead}>
        <Text style={styles.sectionTitle}>Latest news</Text>
        <TouchableOpacity onPress={load} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="refresh" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {loading && !news ? (
        <ActivityIndicator color={colors.accent} style={{ paddingVertical: spacing.xl }} />
      ) : news && news.length > 0 ? (
        news.map((n) => (
          <TouchableOpacity
            key={n.id}
            style={styles.newsCard}
            activeOpacity={0.7}
            onPress={() => onOpen(n.url)}
          >
            {n.imageUrl ? (
              <Image source={{ uri: n.imageUrl }} style={styles.newsImg} />
            ) : (
              <View style={[styles.newsImg, styles.newsImgPlaceholder]}>
                <Ionicons name="newspaper-outline" size={20} color={colors.textTertiary} />
              </View>
            )}
            <View style={styles.newsBody}>
              <Text style={styles.newsTitle} numberOfLines={3}>
                {n.title}
              </Text>
              <Text style={styles.newsMeta}>
                {n.source}
                {n.publishedAt ? ` · ${timeAgo(n.publishedAt)}` : ''}
              </Text>
            </View>
          </TouchableOpacity>
        ))
      ) : (
        <TouchableOpacity style={styles.retry} onPress={load}>
          <Text style={styles.empty}>Couldn&apos;t load news. Tap to retry.</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    alignSelf: 'stretch',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  marketRow: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
    paddingRight: spacing.md,
  },
  coinCard: {
    width: 128,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: 6,
  },
  coinTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  coinIcon: { width: 20, height: 20, borderRadius: 10 },
  coinSym: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  coinPrice: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  coinChg: { fontSize: fontSize.xs, fontWeight: '600' },

  newsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  newsCard: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  newsImg: {
    width: 92,
    height: 68,
    borderRadius: radius.sm,
    backgroundColor: colors.input,
  },
  newsImgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  newsBody: { flex: 1, justifyContent: 'center', gap: 6 },
  newsTitle: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
    lineHeight: 19,
  },
  newsMeta: { color: colors.textTertiary, fontSize: fontSize.xs },
  empty: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center' },
  retry: { paddingVertical: spacing.xl },
});
