import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/constants/theme';
import { rc } from '@/lib/rougechain';
import { WalletAvatar } from '@/components/WalletAvatar';
import { useWalletStore } from '@/stores/wallet';
import { nativePubkeyToAddress } from '@/lib/address';
import { useT } from '@/lib/i18n';

type RegWallet = {
  publicKey?: string;
  signingPublicKey?: string;
  signing_public_key?: string;
  displayName?: string;
  display_name?: string;
};

function getPk(w: RegWallet): string {
  return w.publicKey ?? w.signingPublicKey ?? w.signing_public_key ?? '';
}

function getName(w: RegWallet): string {
  return w.displayName ?? w.display_name ?? '';
}

export default function NewGroupScreen() {
  const { t } = useT();
  const wallet = useWalletStore((s) => s.wallet);
  const [contacts, setContacts] = useState<RegWallet[]>([]);
  const [addrMap, setAddrMap] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const w = await rc.messenger.getWallets();
        const list = (Array.isArray(w) ? w : []) as RegWallet[];
        setContacts(list.filter((c) => getPk(c) !== wallet?.publicKey));

        const map: Record<string, string> = {};
        await Promise.all(
          list.map(async (c) => {
            const pk = getPk(c);
            if (!pk) return;
            try { map[pk] = nativePubkeyToAddress(pk); } catch { /* skip */ }
          })
        );
        setAddrMap(map);
      } catch {
        setContacts([]);
      }
    })();
  }, []);

  function toggle(pk: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pk)) next.delete(pk);
      else next.add(pk);
      return next;
    });
  }

  async function createGroup() {
    if (!wallet) return;
    if (selected.size < 2) {
      Alert.alert(t('mgrp_select_members_title'), t('mgrp_select_members_msg'));
      return;
    }
    setCreating(true);
    try {
      const participants = [wallet.publicKey, ...selected];
      const trimmedName = groupName.trim();
      const result = await rc.messenger.createConversation(wallet, participants, {
        isGroup: true,
        name: trimmedName || undefined,
      });
      if (!result.success) {
        Alert.alert(t('mgrp_failed_title'), result.error ?? t('mgrp_could_not_create'));
        return;
      }
      const raw = result.data as Record<string, unknown> | undefined;
      const convo = (raw?.conversation ?? raw) as Record<string, unknown> | undefined;
      const cid =
        (convo?.id as string) ??
        (convo?.conversation_id as string) ??
        (convo?.conversationId as string) ??
        (raw?.conversation_id as string) ??
        (raw?.conversationId as string) ??
        (raw?.id as string) ??
        '';
      if (!cid) {
        Alert.alert(t('mgrp_group_created_title'), t('mgrp_no_convo_id_msg'));
        router.back();
        return;
      }
      router.replace({
        pathname: '/(tabs)/messenger/[id]',
        params: { id: cid },
      });
    } catch (e) {
      Alert.alert(t('mgrp_error_title'), e instanceof Error ? e.message : t('mgrp_failed'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.nameSection}>
        <TextInput
          style={styles.nameInput}
          placeholder={t('mgrp_group_name_placeholder')}
          placeholderTextColor={colors.textTertiary}
          value={groupName}
          onChangeText={setGroupName}
        />
      </View>

      <Text style={styles.sectionTitle}>
        {t('mgrp_add_members').replace('{count}', String(selected.size))}
      </Text>

      <FlatList
        data={contacts}
        keyExtractor={(c) => getPk(c) || Math.random().toString()}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>{t('mgrp_no_contacts')}</Text>
        }
        renderItem={({ item }) => {
          const pk = getPk(item);
          const isSelected = selected.has(pk);
          const addr = addrMap[pk];
          const displayName = getName(item) || t('mgrp_anonymous');
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
              onPress={() => toggle(pk)}>
              <View style={[styles.checkbox, isSelected && styles.checkboxActive]}>
                {isSelected && <Ionicons name="checkmark" size={16} color={colors.bg} />}
              </View>
              <WalletAvatar id={pk} name={displayName} size={36} />
              <View style={styles.rowInfo}>
                <Text style={styles.name}>{displayName}</Text>
                <Text style={styles.addr} numberOfLines={1}>
                  {addr ? `${addr.slice(0, 14)}…${addr.slice(-6)}` : `${pk.slice(0, 16)}…`}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />

      <View style={styles.footer}>
        <Pressable
          style={[styles.createBtn, (selected.size < 2 || creating) && styles.createBtnDisabled]}
          onPress={createGroup}
          disabled={selected.size < 2 || creating}>
          <Ionicons name="people" size={20} color={colors.bg} />
          <Text style={styles.createLabel}>
            {creating ? t('mgrp_creating') : t('mgrp_create_group').replace('{count}', String(selected.size + 1))}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  nameSection: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  nameInput: {
    backgroundColor: colors.input,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  list: { paddingHorizontal: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.textTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  rowInfo: { flex: 1 },
  name: { color: colors.text, fontWeight: '600', fontSize: 15 },
  addr: { color: colors.accent, fontSize: 12, marginTop: 2, fontFamily: 'SpaceMono', opacity: 0.7 },
  empty: { color: colors.textSecondary, padding: spacing.lg, textAlign: 'center' },
  footer: {
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
  },
  createBtnDisabled: { opacity: 0.4 },
  createLabel: { color: colors.bg, fontWeight: '700', fontSize: 16 },
});
