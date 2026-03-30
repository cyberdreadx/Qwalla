import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/theme';
import { ROUGECHAIN_API } from '@/constants/config';

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
};

let metadataCache: Record<string, string | null> = {};
let fetchPromise: Promise<void> | null = null;

function fetchMetadata(): Promise<void> {
  if (fetchPromise) return fetchPromise;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  fetchPromise = fetch(`${ROUGECHAIN_API}/tokens`, {
    headers: { Accept: 'application/json' },
    signal: controller.signal,
  })
    .then((r) => r.json())
    .then((data: any) => {
      const tokens = Array.isArray(data) ? data : data?.tokens ?? [];
      for (const t of tokens) {
        if (t.symbol && t.image) metadataCache[t.symbol] = t.image;
      }
    })
    .catch(() => {})
    .finally(() => clearTimeout(timer));
  return fetchPromise;
}

interface Props {
  symbol: string;
  size?: number;
}

export function TokenIcon({ symbol, size = 32 }: Props) {
  const [imageUrl, setImageUrl] = useState<string | null>(
    metadataCache[symbol] ?? null
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (BUILTIN_LOGOS[symbol] || imageUrl) return;
    if (metadataCache[symbol] !== undefined) {
      setImageUrl(metadataCache[symbol]);
      return;
    }
    fetchMetadata().then(() => {
      setImageUrl(metadataCache[symbol] ?? null);
    });
  }, [symbol, imageUrl]);

  if (BUILTIN_LOGOS[symbol]) {
    return (
      <Image
        source={BUILTIN_LOGOS[symbol]}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        resizeMode="cover"
      />
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
