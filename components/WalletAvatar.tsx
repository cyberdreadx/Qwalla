import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/theme';
import { resolveWalletEntry } from '@/lib/wallet-directory';

/**
 * Renders a wallet's custom (directory) avatar consistently across the app.
 * Pass a known `uri` to skip the lookup; otherwise it resolves the avatar from
 * the shared wallet directory by `id`. Falls back to the contact's initials,
 * then a person icon.
 */
export function WalletAvatar({
  id,
  name,
  uri,
  size = 36,
}: {
  id?: string;
  name?: string;
  uri?: string;
  size?: number;
}) {
  const [avatar, setAvatar] = useState<string | undefined>(uri);

  useEffect(() => {
    if (uri) {
      setAvatar(uri);
      return;
    }
    if (!id) return;
    let cancelled = false;
    void resolveWalletEntry(id)
      .then((e) => {
        if (!cancelled && e?.avatar) setAvatar(e.avatar);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, uri]);

  const dim = { width: size, height: size, borderRadius: size / 2 };

  if (avatar) {
    return <Image source={{ uri: avatar }} style={[dim, styles.img]} />;
  }

  const initials = (name ?? '').trim().slice(0, 2).toUpperCase();
  return (
    <View style={[dim, styles.fallback]}>
      {initials ? (
        <Text style={[styles.initials, { fontSize: Math.max(10, size * 0.4) }]}>{initials}</Text>
      ) : (
        <Ionicons name="person" size={Math.max(12, size * 0.5)} color={colors.textTertiary} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  img: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  fallback: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  initials: { color: colors.textSecondary, fontWeight: '700' },
});
