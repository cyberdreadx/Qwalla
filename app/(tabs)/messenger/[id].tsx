import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import EmojiPicker from 'rn-emoji-keyboard';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GifPicker } from '@/components/chat/GifPicker';
import { StickerPicker } from '@/components/chat/StickerPicker';
import { colors, radius, spacing } from '@/constants/theme';
import type { Sticker } from '@/constants/stickers';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { bytesToHex, hexToBytes } from '@rougechain/sdk';
import { ROUGECHAIN_API } from '@/constants/config';
import { decryptMessage, encryptMessage } from '@/lib/encryption';
import { fetchMessengerMessages } from '@/lib/messenger-api';
import { rc } from '@/lib/rougechain';
import { useWalletStore } from '@/stores/wallet';

type Msg = {
  id?: string;
  sender?: string;
  sender_public_key?: string;
  senderPublicKey?: string;
  sender_wallet_id?: string;
  senderWalletId?: string;
  encrypted_content?: string;
  encryptedContent?: string;
  encrypted?: string;
  content?: string;
  timestamp?: number;
  created_at?: string;
  createdAt?: string;
  read_at?: string;
  readAt?: string;
};

type Panel = 'none' | 'emoji' | 'gif' | 'sticker';

const EMOJI_ONLY_RE = /^[\p{Emoji}\p{Emoji_Component}\s]{1,12}$/u;
const GIF_RE = /^https?:\/\/.*\.(gif|webp)/i;
const STICKER_RE = /^\[sticker:(.+?)\](.+)$/;

function classifyContent(text: string): 'emoji-only' | 'gif' | 'sticker' | 'text' {
  if (GIF_RE.test(text)) return 'gif';
  if (STICKER_RE.test(text)) return 'sticker';
  if (EMOJI_ONLY_RE.test(text.trim())) return 'emoji-only';
  return 'text';
}

export default function ChatScreen() {
  const { id: conversationId, peer: peerParam } = useLocalSearchParams<{ id: string; peer?: string }>();
  const wallet = useWalletStore((s) => s.wallet);
  const encPub = useWalletStore((s) => s.encPublicKey);
  const encPriv = useWalletStore((s) => s.encPrivateKey);
  const myAvatarUrl = useWalletStore((s) => s.avatarUrl);

  const [peerEncPub, setPeerEncPub] = useState<string | null>(null);
  const peerEncPubRef = useRef<string | null>(null);
  const [peerName, setPeerName] = useState<string>('');
  const [peerAvatarUrl, setPeerAvatarUrl] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [selfDestruct, setSelfDestruct] = useState(false);
  const [panel, setPanel] = useState<Panel>('none');

  const peerSigning = (peerParam as string) || '';

  const resolvePeerEnc = useCallback(async (): Promise<string | null> => {
    if (!peerSigning) return null;
    try {
      const wallets = await rc.messenger.getWallets();
      const list = (Array.isArray(wallets) ? wallets : []) as Record<string, unknown>[];
      const m = list.find((w) => {
        const keys = [w.publicKey, w.signingPublicKey, w.signing_public_key, w.id, w.encryptionPublicKey, w.encryption_public_key];
        return keys.some((k) => k === peerSigning);
      });
      if (m) {
        const name = (m.displayName ?? m.display_name) as string | undefined;
        if (name) setPeerName(name);

        const enc = (m.encryptionPublicKey ?? m.encryption_public_key ?? m.encPublicKey) as string | undefined;
        if (enc) {
          setPeerEncPub(enc);
          peerEncPubRef.current = enc;
        }

        try {
          const nfts = await rc.nft.getByOwner(peerSigning);
          const arr = Array.isArray(nfts) ? (nfts as Record<string, unknown>[]) : [];
          if (arr.length > 0) {
            const img = (arr[0].image ?? arr[0].metadataUri ?? arr[0].metadata_uri) as string | undefined;
            if (img) setPeerAvatarUrl(img);
          }
        } catch { /* NFT lookup optional */ }

        if (enc) return enc;
      }
    } catch (e) {
      console.error('[Qwalla] resolvePeerEnc error:', e);
    }
    return null;
  }, [peerSigning]);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!wallet || !conversationId) return;
    if (!silent) setLoading(true);
    try {
      let rows: Record<string, unknown>[] = [];
      try {
        rows = await fetchMessengerMessages(String(conversationId), wallet.publicKey);
      } catch {
        const fallback = await rc.messenger.getMessages(String(conversationId));
        rows = Array.isArray(fallback) ? (fallback as Record<string, unknown>[]) : [];
      }
      setMessages(rows as Msg[]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [wallet, conversationId]);

  useEffect(() => {
    void resolvePeerEnc();
  }, [resolvePeerEnc]);

  useEffect(() => {
    void load();
    pollingRef.current = setInterval(() => void load(true), 4000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [load]);

  function senderOf(m: Msg): string {
    return String(m.senderWalletId ?? m.sender_wallet_id ?? m.sender ?? m.sender_public_key ?? m.senderPublicKey ?? '');
  }

  function cipherOf(m: Msg): string {
    return String(m.encrypted_content ?? m.encryptedContent ?? m.encrypted ?? m.content ?? '');
  }

  function timeOf(m: Msg): string {
    const raw = m.createdAt ?? m.created_at ?? (m.timestamp ? new Date(m.timestamp).toISOString() : '');
    if (!raw) return '';
    try {
      const d = new Date(raw);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function statusOf(m: Msg, mine: boolean): 'sent' | 'delivered' | 'read' {
    if (!mine) return 'read';
    if (m.readAt ?? m.read_at) return 'read';
    return 'delivered';
  }

  function displayBody(m: Msg): string {
    if (!wallet || !encPriv) return cipherOf(m).slice(0, 80) + '…';
    const isSender = senderOf(m).toLowerCase() === wallet.publicKey.toLowerCase();
    try {
      return decryptMessage(cipherOf(m), encPriv, isSender);
    } catch {
      return '[Unable to decrypt]';
    }
  }

  async function sendContent(content: string) {
    setSendError(null);

    if (!wallet || !encPub || !encPriv || !conversationId) {
      const missing = [!wallet && 'wallet', !encPub && 'encPub', !encPriv && 'encPriv', !conversationId && 'conversationId'].filter(Boolean).join(', ');
      console.error('[Qwalla send] missing:', missing);
      setSendError(`Missing: ${missing}`);
      return;
    }
    if (!content.trim()) return;

    let peerKey = peerEncPubRef.current;
    if (!peerKey) {
      peerKey = await resolvePeerEnc();
      if (!peerKey) {
        setSendError('Could not resolve contact encryption key. Try reopening the chat.');
        return;
      }
    }

    setSending(true);
    try {
      const encryptedPackage = encryptMessage(content, peerKey, encPub);

      const sigBytes = ml_dsa65.sign(
        new TextEncoder().encode(encryptedPackage),
        hexToBytes(wallet.privateKey)
      );
      const signature = bytesToHex(sigBytes);

      const res = await rc.messenger.sendMessage(
        String(conversationId),
        wallet.publicKey,
        encryptedPackage,
        {
          signature,
          selfDestruct,
          destructAfterSeconds: selfDestruct ? 30 : undefined,
        }
      );

      if (!res.success) {
        setSendError(res.error ?? 'Send failed');
        return;
      }

      await load(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      console.error('[Qwalla send]', e);
      setSendError(msg);
    } finally {
      setSending(false);
    }
  }

  async function sendText() {
    const body = text.trim();
    if (!body) return;
    setText('');
    setPanel('none');
    await sendContent(body);
  }

  async function sendGif(url: string) {
    setPanel('none');
    await sendContent(url);
  }

  async function sendSticker(sticker: Sticker) {
    setPanel('none');
    await sendContent(`[sticker:${sticker.label}]${sticker.emoji}`);
  }

  function togglePanel(target: Panel) {
    setPanel((p) => (p === target ? 'none' : target));
  }

  function renderMeta(time: string, mine: boolean, status: 'sent' | 'delivered' | 'read') {
    if (!time && !mine) return null;
    const icon = status === 'read' ? 'checkmark-done' : status === 'delivered' ? 'checkmark-done-outline' : 'checkmark-outline';
    const iconColor = status === 'read' ? colors.accent : mine ? 'rgba(0,0,0,0.4)' : colors.textTertiary;
    return (
      <View style={[styles.meta, mine ? styles.metaMine : styles.metaTheirs]}>
        {time ? <Text style={[styles.metaTime, mine && styles.metaTimeMine]}>{time}</Text> : null}
        {mine && <Ionicons name={icon as 'checkmark'} size={14} color={iconColor} />}
      </View>
    );
  }

  function renderBubble(body: string, mine: boolean, time: string, status: 'sent' | 'delivered' | 'read') {
    const kind = classifyContent(body);

    if (kind === 'gif') {
      return (
        <View>
          <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, styles.gifBubble]}>
            <Image source={{ uri: body }} style={styles.gifImage} resizeMode="cover" />
          </View>
          {renderMeta(time, mine, status)}
        </View>
      );
    }

    if (kind === 'sticker') {
      const match = STICKER_RE.exec(body);
      const emoji = match?.[2] ?? body;
      return (
        <View>
          <View style={[styles.stickerBubble, mine ? styles.bubbleMineAlign : styles.bubbleTheirsAlign]}>
            <Text style={styles.stickerText}>{emoji}</Text>
          </View>
          {renderMeta(time, mine, status)}
        </View>
      );
    }

    if (kind === 'emoji-only') {
      return (
        <View>
          <View style={[styles.emojiBubble, mine ? styles.bubbleMineAlign : styles.bubbleTheirsAlign]}>
            <Text style={styles.emojiText}>{body}</Text>
          </View>
          {renderMeta(time, mine, status)}
        </View>
      );
    }

    return (
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{body}</Text>
        {(time || mine) && (
          <View style={styles.metaInline}>
            {time ? <Text style={[styles.metaTime, mine && styles.metaTimeMine]}>{time}</Text> : null}
            {mine && (
              <Ionicons
                name={status === 'read' ? 'checkmark-done' : 'checkmark-done-outline' as 'checkmark'}
                size={14}
                color={status === 'read' ? (mine ? 'rgba(0,200,150,0.8)' : colors.accent) : 'rgba(0,0,0,0.4)'}
              />
            )}
          </View>
        )}
      </View>
    );
  }

  async function deleteConversation() {
    if (Platform.OS === 'web') {
      if (!window.confirm('Delete this conversation?')) return;
    } else {
      const confirmed = await new Promise<boolean>((resolve) =>
        Alert.alert('Delete conversation', 'This will remove the conversation. Continue?', [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
        ])
      );
      if (!confirmed) return;
    }
    try {
      await fetch(
        `${ROUGECHAIN_API}/messenger/conversations/${encodeURIComponent(String(conversationId))}`,
        { method: 'DELETE' }
      );
    } catch { /* best effort */ }
    router.back();
  }

  function blockUser() {
    const doBlock = () => {
      try {
        const key = 'qwalla_blocked_wallets';
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
        const list: string[] = raw ? JSON.parse(raw) : [];
        if (!list.includes(peerSigning)) list.push(peerSigning);
        if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(list));
      } catch { /* best effort */ }
      router.back();
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Block this contact? You will no longer receive messages from them.')) doBlock();
    } else {
      Alert.alert('Block user', 'Block this contact? You will no longer receive messages from them.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Block', style: 'destructive', onPress: doBlock },
      ]);
    }
  }

  if (!wallet) return null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Action header */}
      <View style={styles.chatHeader}>
        <View style={styles.headerLeft}>
          {peerAvatarUrl ? (
            <Image source={{ uri: peerAvatarUrl }} style={styles.peerAvatarImg} />
          ) : (
            <View style={styles.peerAvatar}>
              <Ionicons name="person" size={16} color={colors.textTertiary} />
            </View>
          )}
          <View>
            <Text style={styles.peerName} numberOfLines={1}>
              {peerName || peerSigning.slice(0, 12) + '…'}
            </Text>
            <View style={styles.encRow}>
              <Ionicons name="lock-closed" size={10} color={colors.accent} />
              <Text style={styles.headerLabel}>ML-KEM-768 + ML-DSA-65</Text>
            </View>
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={deleteConversation} hitSlop={8} style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}>
            <Ionicons name="trash-outline" size={20} color={colors.error} />
          </Pressable>
          <Pressable onPress={blockUser} hitSlop={8} style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}>
            <Ionicons name="ban-outline" size={20} color={colors.warning} />
          </Pressable>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={88}>
        <FlatList
          data={messages}
          keyExtractor={(m) => String(m.id ?? Math.random())}
          inverted
          contentContainerStyle={styles.list}
          onRefresh={() => void load()}
          refreshing={loading}
          renderItem={({ item }) => {
            const mine = senderOf(item) === wallet.publicKey;
            const time = timeOf(item);
            const status = statusOf(item, mine);
            return (
              <View style={Platform.OS === 'web' ? styles.invertedCell : undefined}>
                {renderBubble(displayBody(item), mine, time, status)}
              </View>
            );
          }}
        />

        {/* Self-destruct toggle */}
        <View style={styles.sdRow}>
          <View style={styles.sdLeft}>
            <Ionicons name="timer-outline" size={16} color={colors.textTertiary} />
            <Text style={styles.sdLabel}>Self-destruct</Text>
          </View>
          <Switch
            value={selfDestruct}
            onValueChange={setSelfDestruct}
            trackColor={{ false: colors.surface, true: colors.accentDim }}
            thumbColor={selfDestruct ? colors.accent : colors.textTertiary}
          />
        </View>
        {selfDestruct && (
          <Text style={styles.sdHint}>Deletes 30s after the recipient opens it.</Text>
        )}

        {sendError && (
          <Pressable onPress={() => setSendError(null)} style={styles.errorBanner}>
            <Ionicons name="warning" size={14} color="#fff" />
            <Text style={styles.errorText}>{sendError}</Text>
            <Ionicons name="close" size={14} color="#fff" />
          </Pressable>
        )}

        {/* Input bar */}
        <View style={styles.inputRow}>
          <Pressable
            onPress={() => togglePanel('sticker')}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
            hitSlop={8}>
            <Ionicons
              name="happy-outline"
              size={24}
              color={panel === 'sticker' ? colors.accent : colors.textTertiary}
            />
          </Pressable>
          <TextInput
            style={styles.input}
            placeholder="Message…"
            placeholderTextColor={colors.textTertiary}
            value={text}
            onChangeText={setText}
            multiline
            onFocus={() => setPanel('none')}
          />
          <Pressable
            onPress={() => togglePanel('gif')}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
            hitSlop={8}>
            <Text style={[styles.gifLabel, panel === 'gif' && { color: colors.accent }]}>GIF</Text>
          </Pressable>
          <Pressable
            onPress={() => togglePanel('emoji')}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
            hitSlop={8}>
            <Ionicons
              name="globe-outline"
              size={22}
              color={panel === 'emoji' ? colors.accent : colors.textTertiary}
            />
          </Pressable>
          <Pressable
            onPress={sendText}
            disabled={sending}
            style={({ pressed }) => [styles.sendBtn, (pressed || sending) && { opacity: 0.7 }]}>
            {sending ? (
              <ActivityIndicator size="small" color={colors.bg} />
            ) : (
              <Ionicons name="send" size={20} color={colors.bg} />
            )}
          </Pressable>
        </View>

        {/* Panels */}
        {panel === 'gif' && <GifPicker onSelect={sendGif} />}
        {panel === 'sticker' && <StickerPicker onSelect={sendSticker} />}
      </KeyboardAvoidingView>

      <EmojiPicker
        onEmojiSelected={(e) => setText((t) => t + e.emoji)}
        open={panel === 'emoji'}
        onClose={() => setPanel('none')}
        theme={{
          backdrop: colors.bg + 'CC',
          knob: colors.textTertiary,
          container: colors.chrome,
          header: colors.text,
          skinTonesContainer: colors.surface,
          category: {
            icon: colors.textTertiary,
            iconActive: colors.accent,
            container: colors.chrome,
            containerActive: colors.accentDim,
          },
          search: {
            text: colors.text,
            placeholder: colors.textTertiary,
            icon: colors.textTertiary,
            background: colors.input,
          },
          emoji: { selected: colors.accentDim },
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  list: { padding: spacing.md, gap: spacing.xs },
  invertedCell: { transform: [{ scaleY: -1 }] },

  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.chrome,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  peerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  peerAvatarImg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  peerName: { color: colors.text, fontSize: 15, fontWeight: '600', maxWidth: 200 },
  encRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  headerLabel: { color: colors.accent, fontSize: 10, fontWeight: '500' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerBtn: { padding: 4 },

  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    marginBottom: 4,
  },
  bubbleMine: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent,
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
  },
  bubbleMineAlign: { alignSelf: 'flex-end', marginBottom: 4 },
  bubbleTheirsAlign: { alignSelf: 'flex-start', marginBottom: 4 },
  bubbleText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  bubbleTextMine: { color: colors.bg },

  meta: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2, marginBottom: 4, paddingHorizontal: 2 },
  metaMine: { alignSelf: 'flex-end' },
  metaTheirs: { alignSelf: 'flex-start' },
  metaInline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3, marginTop: 4 },
  metaTime: { color: colors.textTertiary, fontSize: 11 },
  metaTimeMine: { color: 'rgba(0,0,0,0.45)' },

  gifBubble: { padding: 3, overflow: 'hidden' },
  gifImage: { width: 200, height: 150, borderRadius: 14 },

  stickerBubble: { marginBottom: 4 },
  stickerText: { fontSize: 48 },

  emojiBubble: { marginBottom: 4 },
  emojiText: { fontSize: 42 },

  sdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  sdLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sdLabel: { color: colors.textSecondary, fontSize: 13 },
  sdHint: {
    color: colors.warning,
    fontSize: 12,
    paddingHorizontal: spacing.md,
    paddingBottom: 4,
  },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: spacing.sm,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.error,
    borderRadius: radius.sm,
  },
  errorText: { flex: 1, color: '#fff', fontSize: 12, fontWeight: '500' },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.sm,
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.chrome,
  },
  iconBtn: { padding: 6, justifyContent: 'center', alignItems: 'center' },
  gifLabel: {
    color: colors.textTertiary,
    fontSize: 13,
    fontWeight: '800',
    borderWidth: 1.5,
    borderColor: colors.textTertiary,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    backgroundColor: colors.input,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
