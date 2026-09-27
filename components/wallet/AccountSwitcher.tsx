import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { WalletAvatar } from '@/components/WalletAvatar';
import { colors, radius, spacing } from '@/constants/theme';
import { useT } from '@/lib/i18n';
import { nativePubkeyToAddress } from '@qwalla/core/wallet';
import { useWalletStore } from '@/stores/wallet';

function shortAddr(publicKey: string): string {
  try {
    const a = nativePubkeyToAddress(publicKey);
    return `${a.slice(0, 12)}…${a.slice(-4)}`;
  } catch {
    return `${publicKey.slice(0, 10)}…`;
  }
}

/**
 * Account switcher sheet: list all accounts (tap to switch), remove one, or add
 * another. Switching is instant — all accounts are already decrypted in memory.
 */
export function AccountSwitcher({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useT();
  const accounts = useWalletStore((s) => s.accounts);
  const activeId = useWalletStore((s) => s.activeId);
  const hasPassword = useWalletStore((s) => s.hasPassword);
  const switchAccount = useWalletStore((s) => s.switchAccount);
  const removeAccount = useWalletStore((s) => s.removeAccount);

  const onAdd = () => {
    onClose();
    if (!hasPassword) {
      Alert.alert(t('w_acct_password_title'), t('w_acct_password_msg'));
      return;
    }
    router.push('/(tabs)/wallet/add-account' as Href);
  };

  const confirmRemove = (id: string, name: string) => {
    const doRemove = () => void removeAccount(id);
    if (Platform.OS === 'web') {
      if (window.confirm(t('w_acct_remove_msg').replace('{name}', name))) doRemove();
      return;
    }
    Alert.alert(t('w_acct_remove_title'), t('w_acct_remove_msg').replace('{name}', name), [
      { text: t('w_cancel'), style: 'cancel' },
      { text: t('w_acct_remove'), style: 'destructive', onPress: doRemove },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>{t('w_acct_title')}</Text>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {accounts.map((a) => {
              const isActive = a.publicKey === activeId;
              return (
                <View key={a.publicKey} style={styles.row}>
                  <Pressable
                    style={styles.rowMain}
                    onPress={() => {
                      if (!isActive) void switchAccount(a.publicKey);
                      onClose();
                    }}>
                    {a.avatarUrl ? (
                      <Image source={{ uri: a.avatarUrl }} style={styles.avatarImg} />
                    ) : (
                      <WalletAvatar id={a.publicKey} name={a.displayName} size={40} />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name} numberOfLines={1}>
                        {a.displayName || t('w_acct_unnamed')}
                      </Text>
                      <Text style={styles.addr} numberOfLines={1}>
                        {shortAddr(a.publicKey)}
                      </Text>
                    </View>
                    {isActive ? (
                      <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
                    ) : (
                      <View style={styles.dot} />
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => confirmRemove(a.publicKey, a.displayName || t('w_acct_unnamed'))}
                    hitSlop={8}
                    style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.6 }]}>
                    <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={onAdd}
            style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}>
            <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
            <Text style={styles.addText}>{t('w_acct_add')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.chrome,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '80%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.md },
  title: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: spacing.sm },
  list: { maxHeight: 380 },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 12 },
  avatarImg: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface },
  name: { color: colors.text, fontSize: 15, fontWeight: '700' },
  addr: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border },
  removeBtn: { padding: 8, marginLeft: 4 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: spacing.md,
    paddingVertical: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
});
