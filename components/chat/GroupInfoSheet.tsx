import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Wallet } from '@rougechain/sdk';

import { colors, radius, spacing } from '@/constants/theme';
import {
  addConversationParticipants,
  canAddParticipants,
  canRenameConversation,
  renameConversation,
} from '@/lib/messenger-api';
import { rc } from '@/lib/rougechain';
import { WalletAvatar } from '@/components/WalletAvatar';

type DirWallet = Record<string, unknown>;

/** Every id-ish key a participant might be matched on across node shapes. */
function walletKeys(w: DirWallet): string[] {
  return [
    w.id,
    w.publicKey,
    w.signingPublicKey,
    w.signing_public_key,
    w.encryptionPublicKey,
    w.encryption_public_key,
  ].filter((k): k is string => typeof k === 'string' && k.length > 0);
}

function nameOf(w: DirWallet): string {
  return String(w.displayName ?? w.display_name ?? '') || 'Anonymous';
}

function signingKeyOf(w: DirWallet): string {
  return String(w.publicKey ?? w.signingPublicKey ?? w.signing_public_key ?? '');
}

type Props = {
  visible: boolean;
  onClose: () => void;
  wallet: Wallet;
  conversationId: string;
  myPublicKey: string;
  /** Called after a successful rename / add so the parent can refresh. */
  onChanged?: () => void;
};

export function GroupInfoSheet({ visible, onClose, wallet, conversationId, myPublicKey, onChanged }: Props) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [directory, setDirectory] = useState<DirWallet[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const renameSupported = canRenameConversation();
  const addSupported = canAddParticipants();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [convosRaw, walletsRaw] = await Promise.all([
        rc.messenger.getConversations(wallet),
        rc.messenger.getWallets(),
      ]);
      const convos = (Array.isArray(convosRaw) ? convosRaw : []) as DirWallet[];
      const wallets = (Array.isArray(walletsRaw) ? walletsRaw : []) as DirWallet[];

      const convo = convos.find(
        (c) => String(c.conversationId ?? c.conversation_id ?? c.id ?? '') === String(conversationId),
      );
      const ids = ((convo?.participantIds ?? convo?.participant_ids ?? []) as string[]) ?? [];
      const storedName = String(convo?.name ?? convo?.group_name ?? convo?.groupName ?? '');

      setMemberIds(ids);
      setName(storedName);
      setDirectory(wallets);
    } catch {
      setError('Could not load group info.');
    } finally {
      setLoading(false);
    }
  }, [wallet, conversationId]);

  useEffect(() => {
    if (visible) {
      setShowAdd(false);
      setSelected(new Set());
      void load();
    }
  }, [visible, load]);

  /** Resolve a participant id to a display name via the directory. */
  const memberName = useCallback(
    (pid: string): string => {
      const w = directory.find((d) => walletKeys(d).includes(pid));
      if (w) return nameOf(w);
      return `${pid.slice(0, 10)}…`;
    },
    [directory],
  );

  const isMember = useCallback(
    (w: DirWallet): boolean => {
      const keys = walletKeys(w);
      return memberIds.some((id) => keys.includes(id));
    },
    [memberIds],
  );

  const candidates = directory.filter((w) => {
    const sk = signingKeyOf(w);
    return sk && sk !== myPublicKey && !isMember(w);
  });

  async function handleRename() {
    const next = name.trim();
    if (!next || renaming) return;
    setRenaming(true);
    setError(null);
    try {
      const res = await renameConversation(wallet, conversationId, next);
      if (res && res.success === false) {
        setError(res.error ?? 'Rename failed.');
        return;
      }
      onChanged?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rename failed.');
    } finally {
      setRenaming(false);
    }
  }

  function toggle(pk: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pk)) next.delete(pk);
      else next.add(pk);
      return next;
    });
  }

  async function handleAdd() {
    if (selected.size === 0 || adding) return;
    setAdding(true);
    setError(null);
    try {
      const res = await addConversationParticipants(wallet, conversationId, [...selected]);
      if (res && res.success === false) {
        setError(res.error ?? 'Could not add members.');
        return;
      }
      onChanged?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add members.');
    } finally {
      setAdding(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <Ionicons name="people" size={20} color={colors.accent} />
            <Text style={styles.title}>{showAdd ? 'Add members' : 'Group info'}</Text>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textTertiary} />
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator color={colors.accent} style={{ paddingVertical: 32 }} />
          ) : showAdd ? (
            <>
              {!addSupported && (
                <Text style={styles.note}>Adding members isn’t available in this app version yet.</Text>
              )}
              <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
                {candidates.length === 0 ? (
                  <Text style={styles.empty}>No one else in the directory to add.</Text>
                ) : (
                  candidates.map((w) => {
                    const sk = signingKeyOf(w);
                    const sel = selected.has(sk);
                    return (
                      <Pressable key={sk} style={styles.row} onPress={() => toggle(sk)}>
                        <View style={[styles.checkbox, sel && styles.checkboxActive]}>
                          {sel && <Ionicons name="checkmark" size={15} color={colors.bg} />}
                        </View>
                        <WalletAvatar id={sk} name={nameOf(w)} size={28} />
                        <Text style={styles.rowName}>{nameOf(w)}</Text>
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
              {error && <Text style={styles.error}>{error}</Text>}
              <View style={styles.actions}>
                <Pressable style={styles.secondaryBtn} onPress={() => setShowAdd(false)}>
                  <Text style={styles.secondaryText}>Back</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryBtn, (selected.size === 0 || adding || !addSupported) && styles.btnDisabled]}
                  onPress={handleAdd}
                  disabled={selected.size === 0 || adding || !addSupported}>
                  <Text style={styles.primaryText}>{adding ? 'Adding…' : `Add (${selected.size})`}</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.label}>Group name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Group name"
                placeholderTextColor={colors.textTertiary}
                editable={renameSupported}
              />
              {!renameSupported && (
                <Text style={styles.note}>Renaming isn’t available in this app version yet.</Text>
              )}

              <Text style={[styles.label, { marginTop: spacing.md }]}>
                Members ({memberIds.length})
              </Text>
              <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
                {memberIds.map((pid) => (
                  <View key={pid} style={styles.memberRow}>
                    <WalletAvatar id={pid} name={memberName(pid)} size={28} />
                    <Text style={styles.rowName}>
                      {pid === myPublicKey ? 'You' : memberName(pid)}
                    </Text>
                  </View>
                ))}
              </ScrollView>

              {error && <Text style={styles.error}>{error}</Text>}

              <View style={styles.actions}>
                <Pressable
                  style={[styles.secondaryBtn, !addSupported && styles.btnDisabled]}
                  onPress={() => { setError(null); setShowAdd(true); }}
                  disabled={!addSupported}>
                  <Ionicons name="person-add-outline" size={16} color={colors.accent} />
                  <Text style={styles.secondaryText}>Add members</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryBtn, (!renameSupported || renaming || !name.trim()) && styles.btnDisabled]}
                  onPress={handleRename}
                  disabled={!renameSupported || renaming || !name.trim()}>
                  <Text style={styles.primaryText}>{renaming ? 'Saving…' : 'Save name'}</Text>
                </Pressable>
              </View>
            </>
          )}
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
    maxHeight: '80%',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.md },
  title: { color: colors.text, fontSize: 18, fontWeight: '700', flex: 1 },
  closeBtn: { padding: 2 },
  label: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.input,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
  },
  note: { color: colors.warning, fontSize: 12, marginTop: spacing.sm },
  scroll: { maxHeight: 220, marginTop: spacing.xs },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 8,
  },
  memberAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowName: { color: colors.text, fontSize: 15, fontWeight: '500', flex: 1 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.textTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  empty: { color: colors.textSecondary, paddingVertical: spacing.lg, textAlign: 'center' },
  error: { color: colors.error, fontSize: 13, marginTop: spacing.sm },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: colors.bg, fontWeight: '700', fontSize: 15 },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: { color: colors.accent, fontWeight: '600', fontSize: 14 },
  btnDisabled: { opacity: 0.4 },
});
