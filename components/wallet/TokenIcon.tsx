import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';

import { colors } from '@/constants/theme';
import { getActiveNetwork } from '@/lib/rougechain';

const xrgeLogo = require('@/assets/images/xrge-logo.png');
const qethLogo = require('@/assets/images/qeth-logo.png');
const qusdcLogo = require('@/assets/images/qusdc-logo.png');

const BUILTIN_LOGOS: Record<string, ReturnType<typeof require>> = {
  XRGE: xrgeLogo,
  qETH: qethLogo,
  qUSDC: qusdcLogo,
};

const TOKEN_COLORS: Record<string, string> = {
  XRGE: colors.accent,
  qETH: '#627EEA',
  qUSDC: '#2EE6A8',
  qBTC: '#F7931A',
};

const REFETCH_INTERVAL = 60_000;

// Token image metadata, cached PER NETWORK API. Custom-token logos live on the
// active chain, so this must query the active network — a previous version hit a
// hardcoded testnet URL, so mainnet logos never resolved and every custom token
// fell back to its symbol's first letter.
const metadataByNet: Record<string, Record<string, string | null>> = {};
const fetchPromiseByNet: Record<string, Promise<void> | undefined> = {};
const lastFetchByNet: Record<string, number> = {};

function fetchMetadata(api: string): Promise<void> {
  const now = Date.now();
  const existing = fetchPromiseByNet[api];
  if (existing && now - (lastFetchByNet[api] ?? 0) < REFETCH_INTERVAL) return existing;
  lastFetchByNet[api] = now;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const p = fetch(`${api}/tokens`, {
    headers: { Accept: 'application/json' },
    signal: controller.signal,
  })
    .then((r) => r.json())
    .then((data: any) => {
      const tokens = Array.isArray(data) ? data : data?.tokens ?? [];
      const cache = (metadataByNet[api] ??= {});
      for (const t of tokens) {
        if (t.symbol) cache[t.symbol] = t.image || null;
      }
    })
    .catch(() => {
      fetchPromiseByNet[api] = undefined;
    })
    .finally(() => clearTimeout(timer));
  fetchPromiseByNet[api] = p;
  return p;
}

interface Props {
  symbol: string;
  size?: number;
}

export function TokenIcon({ symbol, size = 32 }: Props) {
  const api = getActiveNetwork().api;
  const [imageUrl, setImageUrl] = useState<string | null>(
    metadataByNet[api]?.[symbol] ?? null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (BUILTIN_LOGOS[symbol]) return;
    const cached = metadataByNet[api]?.[symbol];
    if (cached !== undefined) {
      setImageUrl(cached);
      setFailed(false);
      return;
    }
    fetchMetadata(api).then(() => {
      setImageUrl(metadataByNet[api]?.[symbol] ?? null);
      setFailed(false);
    });
  }, [symbol, api]);

  if (BUILTIN_LOGOS[symbol]) {
    return (
      <Image
        source={BUILTIN_LOGOS[symbol]}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        resizeMode="cover"
      />
    );
  }

  // qBTC: inline Bitcoin ₿ mark (orange), rendered as vector so it's crisp at any size.
  if (symbol && symbol.toUpperCase() === 'QBTC') {
    return (
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Circle cx={50} cy={50} r={50} fill="#F7931A" />
        <SvgText
          x={50}
          y={72}
          fontSize={64}
          fontWeight="bold"
          fill="#FFFFFF"
          textAnchor="middle"
        >
          ₿
        </SvgText>
      </Svg>
    );
  }

  if (imageUrl && !failed) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        resizeMode="cover"
        onError={() => setFailed(true)}
      />
    );
  }

  const bg = TOKEN_COLORS[symbol] ?? colors.textTertiary;
  const letter = symbol === 'qUSDC' ? '$' : symbol.charAt(0).toUpperCase();

  return (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg + '30' },
      ]}
    >
      <Text style={[styles.letter, { fontSize: size * 0.4, color: bg }]}>{letter}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    fontWeight: '700',
  },
});
