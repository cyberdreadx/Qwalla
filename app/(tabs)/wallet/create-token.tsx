import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { colors, radius, spacing } from '@/constants/theme';
import { rc } from '@/lib/rougechain';
import { useWalletStore } from '@/stores/wallet';

export default function CreateTokenScreen() {
  const wallet = useWalletStore((s) => s.wallet);
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [supply, setSupply] = useState('');
  const [image, setImage] = useState('');
  const [busy, setBusy] = useState(false);

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

  async function onCreate() {
    if (!wallet) return;
    const sym = symbol.trim().toUpperCase();
    const nm = name.trim();
    const amt = Number(supply.trim());
    if (!sym || !nm || !Number.isFinite(amt) || amt <= 0) {
      showToast('Fill in name, symbol, and a positive supply', 'error');
      return;
    }
    setBusy(true);
    try {
      const r = await rc.createToken(wallet, {
        name: nm,
        symbol: sym,
        totalSupply: amt,
        image: image.trim() || undefined,
      });
      if (!r.success) {
        showToast(r.error ?? 'Token creation failed', 'error');
        return;
      }
      showToast(`${sym} created!`);
      setTimeout(() => router.back(), 1500);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={88}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Text style={styles.heading}>Create Token</Text>
          <Text style={styles.hint}>
            Deploy a custom token on RougeChain. Costs 100 XRGE.
          </Text>

          <Card style={styles.card}>
            <Field label="Token Name" value={name} onChangeText={setName} placeholder="My Token" />
            <Field
              label="Symbol"
              value={symbol}
              onChangeText={(t) => setSymbol(t.toUpperCase())}
              placeholder="MTK"
              autoCapitalize="characters"
            />
            <Field
              label="Total Supply"
              value={supply}
              onChangeText={setSupply}
              placeholder="1000000"
              keyboardType="number-pad"
            />
            <Field
              label="Image URL (optional)"
              value={image}
              onChangeText={setImage}
              placeholder="https://example.com/logo.png"
              autoCapitalize="none"
            />
          </Card>

          <View style={styles.feeNote}>
            <Ionicons name="information-circle-outline" size={14} color={colors.textTertiary} />
            <Text style={styles.feeText}>Creation fee: 100 XRGE</Text>
          </View>

          <Button
            title={busy ? 'Creating…' : 'Create Token'}
            loading={busy}
            onPress={onCreate}
            disabled={!name.trim() || !symbol.trim() || !supply.trim()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, position: 'relative' as const },
  flex: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  heading: { color: colors.text, fontSize: 24, fontWeight: '800', marginBottom: spacing.xs },
  hint: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  card: { marginBottom: spacing.md },
  feeNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.lg,
  },
  feeText: { color: colors.textTertiary, fontSize: 12 },
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
});
