import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';

import { Card } from '@/components/ui/Card';
import { colors, radius, spacing } from '@/constants/theme';
import { useWalletStore } from '@/stores/wallet';
import { pubkeyToAddress } from '@rougechain/sdk';

export default function ReceiveScreen() {
  const wallet = useWalletStore((s) => s.wallet);
  const [copied, setCopied] = useState(false);
  const [rougeAddr, setRougeAddr] = useState<string | null>(null);

  useEffect(() => {
    if (!wallet) return;
    void pubkeyToAddress(wallet.publicKey)
      .then((a) => setRougeAddr(a))
      .catch(() => {});
  }, [wallet]);

  const qrValue = rougeAddr ?? wallet?.publicKey?.slice(0, 200) ?? '';

  async function copy() {
    if (!wallet) return;
    await Clipboard.setStringAsync(rougeAddr ?? wallet.publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!wallet) return null;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.pad}>
        <Card style={styles.qrCard}>
          <View style={styles.qrInner}>
            {qrValue ? (
              <QRCode value={qrValue} size={200} backgroundColor="#FFFFFF" color="#000000" />
            ) : null}
          </View>
          {rougeAddr ? (
            <Text style={styles.qrHint}>Encodes your rouge1… address</Text>
          ) : (
            <Text style={styles.qrHint}>Encodes a truncated public key</Text>
          )}
        </Card>

        {rougeAddr ? (
          <>
            <Text style={styles.label}>Address</Text>
            <Text selectable style={styles.addr}>{rougeAddr}</Text>
          </>
        ) : null}

        <Text style={styles.label}>Full public key</Text>
        <Text selectable style={styles.pk}>{wallet.publicKey}</Text>

        <Pressable
          onPress={copy}
          style={({ pressed }) => [styles.copyBtn, pressed && { opacity: 0.8 }]}>
          <Ionicons
            name={copied ? 'checkmark-circle' : 'copy-outline'}
            size={18}
            color={copied ? colors.success : colors.accent}
          />
          <Text style={[styles.copyText, copied && { color: colors.success }]}>
            {copied ? 'Copied' : 'Copy address'}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: spacing.lg },
  qrCard: { alignItems: 'center', marginBottom: spacing.lg },
  qrInner: { padding: spacing.md, backgroundColor: '#FFFFFF', borderRadius: radius.sm },
  qrHint: { color: colors.textTertiary, fontSize: 11, marginTop: spacing.sm },
  label: {
    color: colors.textSecondary,
    marginBottom: 4,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  addr: {
    color: colors.accent,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.md,
    fontFamily: 'SpaceMono',
  },
  pk: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 16,
    marginBottom: spacing.lg,
    fontFamily: 'SpaceMono',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  copyText: { color: colors.accent, fontWeight: '600', fontSize: 14 },
});
