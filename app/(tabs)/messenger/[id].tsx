import { Ionicons } from '@expo/vector-icons';
import { useHeaderHeight } from '@react-navigation/elements';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import EmojiPicker from 'rn-emoji-keyboard';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GifPicker } from '@/components/chat/GifPicker';
import { GroupInfoSheet } from '@/components/chat/GroupInfoSheet';
import { StickerPicker } from '@/components/chat/StickerPicker';
import { colors, radius, spacing } from '@/constants/theme';
import type { Sticker } from '@/constants/stickers';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { bytesToHex, hexToBytes } from '@rougechain/sdk';
import { decryptAny, encryptMailV2, encryptMessage } from '@qwalla/core/pq';
import { useT } from '@/lib/i18n';
import { base64Bytes, compressImageToLimit } from '@/lib/image-compress';
import { blockWallet, getBlockedWallets } from '@qwalla/core/wallet';
import { useMutedConversations } from '@/stores/muted-conversations';
import { computeSafetyNumber } from '@qwalla/core/pq';
import { conversationAvatarOf, fetchMessengerMessages } from '@/lib/messenger-api';
import { readCache, writeCache } from '@/lib/message-cache';
import { rc } from '@/lib/rougechain';
import { rougeWs } from '@/lib/ws';
import { useNotificationStore } from '@/stores/notifications';
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
  is_read?: boolean;
  spoiler?: boolean;
  selfDestruct?: boolean;
  self_destruct?: boolean;
  destruct_after_seconds?: number;
  destructAfterSeconds?: number;
  signature?: string;
  contentSignature?: string;
  _sigValid?: boolean | null;
  // Decrypted, envelope-parsed fields (populated in load()).
  _body?: string;
  _replyTo?: string;
};

type Panel = 'none' | 'emoji' | 'gif' | 'sticker';

/**
 * App-level plaintext envelope (encrypted before sending). Adds reply-to and
 * reactions on top of the raw body without any node schema change:
 *   - k:'msg' → a normal message; b=body, r=replyTo message id (optional)
 *   - k:'rx'  → a reaction; t=target message id, e=emoji
 * A non-envelope string (legacy / other clients) is treated as a plain body.
 */
type Envelope =
  | { kind: 'msg'; body: string; replyTo?: string }
  | { kind: 'rx'; target: string; emoji: string };

function buildMsgEnvelope(body: string, replyTo?: string): string {
  return JSON.stringify(replyTo ? { v: 1, k: 'msg', b: body, r: replyTo } : { v: 1, k: 'msg', b: body });
}

function buildRxEnvelope(target: string, emoji: string): string {
  return JSON.stringify({ v: 1, k: 'rx', t: target, e: emoji });
}

function parseEnvelope(raw: string): Envelope {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o && o.v === 1 && o.k === 'msg' && typeof o.b === 'string') {
      return { kind: 'msg', body: o.b, replyTo: typeof o.r === 'string' ? o.r : undefined };
    }
    if (o && o.v === 1 && o.k === 'rx' && typeof o.t === 'string' && typeof o.e === 'string') {
      return { kind: 'rx', target: o.t, emoji: o.e };
    }
  } catch {
    /* not an envelope — legacy plain body (text / gif url / data URI) */
  }
  return { kind: 'msg', body: raw };
}

// Per-message derived state (decrypt + PQ signature-verify result), keyed by
// message id + cipher, so an already-processed message is never re-decrypted or
// re-verified on a later load.
type DerivedEntry = {
  cipher: string;
  sigValid: boolean | null;
  kind: 'msg' | 'rx';
  body?: string;
  replyTo?: string;
  target?: string;
  emoji?: string;
};

// What we persist per conversation (encrypted at rest): renderable message rows
// plus reaction rows (reactions aren't rendered as bubbles but must be replayed
// and skipped from re-decrypt on refresh).
type ConvoCache = {
  messages: Msg[];
  reactions: { id: string; target: string; emoji: string; mine: boolean; cipher: string }[];
};

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

const EMOJI_ONLY_RE = /^[\p{Emoji}\p{Emoji_Component}\s]{1,12}$/u;
const GIF_RE = /^https?:\/\/.*\.(gif|webp)/i;
const IMAGE_RE = /^(https?:\/\/.*\.(gif|webp|jpg|jpeg|png|bmp|svg)|data:image\/[^;]+;base64,)/i;
const STICKER_RE = /^\[sticker:(.+?)\](.+)$/;

function classifyContent(text: string): 'emoji-only' | 'image' | 'gif' | 'sticker' | 'text' {
  if (GIF_RE.test(text)) return 'gif';
  if (IMAGE_RE.test(text.trim())) return 'image';
  if (STICKER_RE.test(text)) return 'sticker';
  if (EMOJI_ONLY_RE.test(text.trim())) return 'emoji-only';
  return 'text';
}

/** Epoch millis for ordering messages; 0 when no timestamp is known. */
function msgEpoch(m: Msg): number {
  const raw = m.createdAt ?? m.created_at;
  if (raw) {
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) return t;
  }
  return m.timestamp ?? 0;
}

/** The ciphertext used as the cache-match key for a message row. */
function rowCipher(m: Msg): string {
  return String(m.encrypted_content ?? m.encryptedContent ?? m.encrypted ?? '');
}

type ChatViewProps = {
  conversationId: string;
  peer?: string;
  /** Called by the header back button, delete, and block — deselects on
   *  desktop master-detail, or pops the route on mobile. */
  onClose: () => void;
};

export function ChatView({ conversationId, peer, onClose }: ChatViewProps) {
  const { t } = useT();
  const headerHeight = useHeaderHeight();
  const muted = useMutedConversations((s) => (conversationId ? s.muted[conversationId] === true : false));
  const toggleMute = useMutedConversations((s) => s.toggle);
  const wallet = useWalletStore((s) => s.wallet);
  const encPub = useWalletStore((s) => s.encPublicKey);
  const encPriv = useWalletStore((s) => s.encPrivateKey);
  const myAvatarUrl = useWalletStore((s) => s.avatarUrl);
  const clearUnreadChats = useNotificationStore((s) => s.clearUnreadChats);

  const [peerEncPub, setPeerEncPub] = useState<string | null>(null);
  const peerEncPubRef = useRef<string | null>(null);
  // Encryption public keys of every other conversation member (groups). Empty
  // for a fresh 1:1 chat, where sendContent falls back to the single peer key.
  const recipientEncKeysRef = useRef<string[]>([]);
  const blockedRef = useRef<Set<string>>(new Set());
  const [peerName, setPeerName] = useState<string>('');
  const [peerAvatarUrl, setPeerAvatarUrl] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [selfDestruct, setSelfDestruct] = useState(false);
  const [spoiler, setSpoiler] = useState(false);
  // Reveals the Spoiler / Self-destruct toggles (kept hidden by default).
  const [showOptions, setShowOptions] = useState(false);
  // Natural width/height ratio per image uri, so inline images render at their
  // real aspect instead of a fixed 4:3 box that crops the photo.
  const [imgRatios, setImgRatios] = useState<Record<string, number>>({});
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<Panel>('none');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [attachPreview, setAttachPreview] = useState<{ uri: string; base64: string } | null>(null);
  // messageId -> aggregated reactions (deduped per reactor is best-effort)
  const [reactions, setReactions] = useState<Record<string, { emoji: string; mine: boolean }[]>>({});
  const [replyingTo, setReplyingTo] = useState<Msg | null>(null);
  const [actionMsg, setActionMsg] = useState<Msg | null>(null);
  const [showVerify, setShowVerify] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  // Group metadata (name/isGroup/members/avatar) for the header + group-info sheet.
  const [convoMeta, setConvoMeta] = useState<{ isGroup: boolean; name: string; participantIds: string[]; avatar?: string | null } | null>(null);

  const peerSigning = peer || '';

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

        // Prefer a directory (profile) avatar; fall back to an NFT lookup.
        const dirAvatar = (m.avatarUrl ?? m.avatar_url ?? m.avatar) as string | undefined;
        if (dirAvatar) {
          setPeerAvatarUrl(dirAvatar);
        } else {
          try {
            const nfts = await rc.nft.getByOwner(peerSigning);
            const arr = Array.isArray(nfts) ? (nfts as Record<string, unknown>[]) : [];
            if (arr.length > 0) {
              const img = (arr[0].image ?? arr[0].metadataUri ?? arr[0].metadata_uri) as string | undefined;
              if (img) setPeerAvatarUrl(img);
            }
          } catch { /* NFT lookup optional */ }
        }

        if (enc) return enc;
      }
    } catch (e) {
      console.error('[Qwalla] resolvePeerEnc error:', e);
    }
    return null;
  }, [peerSigning]);

  /**
   * Resolve the encryption public keys of all other members of this
   * conversation (needed so group messages can be encrypted for everyone).
   * Looks up each participant in the messenger directory regardless of whether
   * the conversation stores signing keys, encryption keys, or wallet UUIDs.
   */
  const resolveRecipients = useCallback(async () => {
    if (!wallet || !conversationId) return;
    try {
      const [walletsRaw, convosRaw] = await Promise.all([
        rc.messenger.getWallets(),
        rc.messenger.getConversations(wallet),
      ]);
      const wallets = (Array.isArray(walletsRaw) ? walletsRaw : []) as Record<string, unknown>[];
      const convos = (Array.isArray(convosRaw) ? convosRaw : []) as Record<string, unknown>[];

      const encOf = (pk: string): string | undefined => {
        const w = wallets.find((x) =>
          [x.id, x.publicKey, x.signingPublicKey, x.signing_public_key, x.encryptionPublicKey, x.encryption_public_key]
            .some((k) => k === pk),
        );
        return (w?.encryptionPublicKey ?? w?.encryption_public_key) as string | undefined;
      };

      const convo = convos.find(
        (c) => String(c.conversationId ?? c.conversation_id ?? c.id ?? '') === String(conversationId),
      );
      const partIds = ((convo?.participantIds ?? convo?.participant_ids ?? []) as string[]) ?? [];
      const me = wallet.publicKey.toLowerCase();
      const others = partIds.filter((pid) => pid && pid.toLowerCase() !== me);

      const encKeys: string[] = [];
      for (const pid of others) {
        const e = encOf(pid);
        if (e && !encKeys.includes(e)) encKeys.push(e);
      }
      recipientEncKeysRef.current = encKeys;

      const storedName = String(convo?.name ?? convo?.group_name ?? convo?.groupName ?? '');
      const isGroup = Boolean(convo?.isGroup ?? convo?.is_group) || others.length > 1;
      const groupAvatar = conversationAvatarOf(convo as Record<string, unknown>);
      setConvoMeta((prev) => ({
        isGroup,
        name: storedName,
        participantIds: partIds,
        // Keep a locally-picked avatar if the node doesn't return one yet.
        avatar: groupAvatar ?? prev?.avatar ?? null,
      }));
    } catch {
      /* leave recipients empty — the 1:1 peer-key fallback still works */
    }
  }, [wallet, conversationId]);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Decrypt + PQ-verify results keyed by message id, so a refresh only does
  // crypto work for genuinely new messages. Seeded from the encrypted on-disk
  // cache when the conversation opens.
  const derivedRef = useRef<Record<string, DerivedEntry>>({});

  const load = useCallback(async (silent = false) => {
    if (!wallet || !conversationId) return;
    if (!silent) setLoading(true);
    try {
      const rows = (await fetchMessengerMessages(wallet, String(conversationId))) as Msg[];
      const now = Date.now();
      const prevDerived = derivedRef.current;
      const nextDerived: Record<string, DerivedEntry> = {};
      const filtered: Msg[] = [];
      const reactionRows: ConvoCache['reactions'] = [];
      const reactionsMap: Record<string, { emoji: string; mine: boolean }[]> = {};

      for (const m of rows) {
        const isSd = m.selfDestruct || m.self_destruct;
        const readAt = m.readAt ?? m.read_at;
        const ttl = (m.destructAfterSeconds ?? m.destruct_after_seconds ?? 30) * 1000;
        const sender = String(m.senderWalletId ?? m.sender_wallet_id ?? m.sender ?? m.sender_public_key ?? m.senderPublicKey ?? '');
        const isMine = sender.toLowerCase() === wallet.publicKey.toLowerCase();

        // Hide messages from blocked contacts (matched on the signing key).
        const senderSigning = String(m.sender_public_key ?? m.senderPublicKey ?? m.sender ?? '');
        if (!isMine && senderSigning && blockedRef.current.has(senderSigning)) {
          continue;
        }

        if (isSd && readAt) {
          const expiry = new Date(readAt).getTime() + ttl;
          if (now > expiry) continue;
        }

        // Mark any unread incoming message read — drives read receipts and
        // clears the server-side unread_count that feeds the chat-list badge.
        // (For self-destruct messages this also starts their TTL, as before.)
        const alreadyRead = !!readAt || m.is_read === true;
        if (!isMine && !alreadyRead && m.id) {
          try {
            await rc.messenger.markRead(wallet, m.id, String(conversationId));
          } catch { /* best-effort */ }
        }

        const cipher = rowCipher(m);
        const id = String(m.id ?? '');

        // Reuse the prior decrypt + signature-verify when the same id still
        // carries the same ciphertext; only new/changed rows do crypto work.
        let entry = id ? prevDerived[id] : undefined;
        if (!entry || entry.cipher !== cipher) {
          const sig = m.signature ?? m.contentSignature;
          const signerKey = String(m.sender_public_key ?? m.senderPublicKey ?? m.sender ?? '');
          let sigValid: boolean | null;
          if (sig && cipher && signerKey) {
            try {
              sigValid = ml_dsa65.verify(
                hexToBytes(sig),
                new TextEncoder().encode(cipher),
                hexToBytes(signerKey),
              );
            } catch { sigValid = false; }
          } else {
            sigValid = null;
          }

          let env: Envelope = { kind: 'msg', body: '' };
          if (encPriv && encPub) {
            try {
              env = parseEnvelope(decryptAny(cipher, encPriv, encPub, isMine));
            } catch {
              env = { kind: 'msg', body: t('mid_unable_decrypt') };
            }
          }
          entry = env.kind === 'rx'
            ? { cipher, sigValid, kind: 'rx', target: env.target, emoji: env.emoji }
            : { cipher, sigValid, kind: 'msg', body: env.body, replyTo: env.replyTo };
        }
        if (id) nextDerived[id] = entry;

        // Reactions fold into a map keyed by their target and are never rendered
        // as their own bubble.
        if (entry.kind === 'rx') {
          const target = entry.target ?? '';
          const emoji = entry.emoji ?? '';
          (reactionsMap[target] ??= []).push({ emoji, mine: isMine });
          if (id) reactionRows.push({ id, target, emoji, mine: isMine, cipher });
          continue;
        }
        m._sigValid = entry.sigValid;
        m._body = entry.body;
        m._replyTo = entry.replyTo;
        filtered.push(m);
      }

      // Newest first: the FlatList is `inverted`, so data[0] renders at the
      // bottom — this puts the most recent message at the bottom of the chat.
      filtered.sort((a, b) => msgEpoch(b) - msgEpoch(a));
      derivedRef.current = nextDerived;
      setReactions(reactionsMap);
      setMessages(filtered);
      // Persist the encrypted cache for an instant next open. Self-destruct
      // messages are ephemeral by design and are never written to disk.
      void writeCache(wallet.publicKey, `c_${String(conversationId)}`, {
        messages: filtered.filter((m) => !(m.selfDestruct || m.self_destruct)),
        reactions: reactionRows,
      } satisfies ConvoCache);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [wallet, conversationId, encPriv, encPub, t]);

  // Instant open: paint the encrypted on-disk cache before the network load
  // resolves, and seed the derived-state map so the refresh skips re-work.
  useEffect(() => {
    let cancelled = false;
    derivedRef.current = {};
    void (async () => {
      if (!wallet || !conversationId) return;
      const cache = await readCache<ConvoCache>(wallet.publicKey, `c_${String(conversationId)}`);
      if (cancelled || !cache) return;

      const derived: Record<string, DerivedEntry> = {};
      for (const m of cache.messages) {
        const id = String(m.id ?? '');
        if (id) {
          derived[id] = {
            cipher: rowCipher(m),
            sigValid: m._sigValid ?? null,
            kind: 'msg',
            body: m._body,
            replyTo: m._replyTo,
          };
        }
      }
      const reactionsMap: Record<string, { emoji: string; mine: boolean }[]> = {};
      for (const r of cache.reactions) {
        derived[r.id] = { cipher: r.cipher, sigValid: null, kind: 'rx', target: r.target, emoji: r.emoji };
        (reactionsMap[r.target] ??= []).push({ emoji: r.emoji, mine: r.mine });
      }

      if (cancelled) return;
      if (Object.keys(derivedRef.current).length === 0) derivedRef.current = derived;
      // Don't clobber a network load that already won the race.
      setMessages((prev) => (prev.length ? prev : cache.messages));
      setReactions((prev) => (Object.keys(prev).length ? prev : reactionsMap));
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet, conversationId]);

  useEffect(() => {
    void resolvePeerEnc();
    void resolveRecipients();
    void getBlockedWallets().then((l) => {
      blockedRef.current = new Set(l);
    });
  }, [resolvePeerEnc, resolveRecipients]);

  // Viewing a conversation counts as reading it — clear the global unread-chats
  // badge whenever its messages render or update (initial load, poll, realtime).
  useEffect(() => {
    clearUnreadChats();
  }, [messages, clearUnreadChats]);

  useEffect(() => {
    void load();

    // Realtime: refresh the moment the node broadcasts a new message for this
    // conversation. rougeWs is shared app-wide and connect()/subscribe() are
    // idempotent, so we only unsubscribe on unmount (never disconnect).
    rougeWs.connect();
    const unsub = rougeWs.subscribe((event) => {
      if (event.type !== 'new_message') return;
      if (String(event.conversation_id ?? '') === String(conversationId)) {
        void load(true);
      }
    });

    // Fallback poll in case the socket is suspended (backgrounded / unreachable)
    // — far slower than the old 4s loop since the socket does the heavy lifting.
    pollingRef.current = setInterval(() => void load(true), 15000);
    return () => {
      unsub();
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [load, conversationId]);

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
    if (m._body !== undefined) return m._body;
    if (!wallet || !encPriv || !encPub) return cipherOf(m).slice(0, 80) + '…';
    const isSender = senderOf(m).toLowerCase() === wallet.publicKey.toLowerCase();
    try {
      const env = parseEnvelope(decryptAny(cipherOf(m), encPriv, encPub, isSender));
      return env.kind === 'msg' ? env.body : '';
    } catch {
      return t('mid_unable_decrypt');
    }
  }

  async function sendContent(content: string, opts?: { replyTo?: string; reaction?: { target: string; emoji: string } }) {
    setSendError(null);

    if (!wallet || !encPub || !encPriv || !conversationId) {
      const missing = [!wallet && 'wallet', !encPub && 'encPub', !encPriv && 'encPriv', !conversationId && 'conversationId'].filter(Boolean).join(', ');
      console.error('[Qwalla send] missing:', missing);
      setSendError(t('mid_error_missing').replace('{x}', missing));
      return;
    }
    const isReaction = !!opts?.reaction;
    if (!isReaction && !content.trim()) return;

    // Prefer the full group recipient set; fall back to the single peer key for
    // a 1:1 chat opened before the conversation record is available.
    let recipients = recipientEncKeysRef.current;
    if (recipients.length === 0) {
      let peerKey = peerEncPubRef.current;
      if (!peerKey) peerKey = await resolvePeerEnc();
      recipients = peerKey ? [peerKey] : [];
    }
    if (recipients.length === 0) {
      setSendError(t('mid_error_resolve_keys'));
      return;
    }

    setSending(true);
    try {
      // Wrap the body in the app envelope (carries reply-to / reaction), then
      // encrypt. Groups (2+ recipients) use the per-recipient wrapped-CEK (v2)
      // format so every member can decrypt; 1:1 keeps the dual-copy format.
      const plaintext = isReaction
        ? buildRxEnvelope(opts!.reaction!.target, opts!.reaction!.emoji)
        : buildMsgEnvelope(content, opts?.replyTo);

      const encryptedPackage =
        recipients.length > 1
          ? encryptMailV2(plaintext, recipients, encPub)
          : encryptMessage(plaintext, recipients[0], encPub);

      const sigBytes = ml_dsa65.sign(
        new TextEncoder().encode(encryptedPackage),
        hexToBytes(wallet.privateKey),
      );
      const contentSignature = bytesToHex(sigBytes);

      const res = await rc.messenger.sendMessage(
        wallet,
        String(conversationId),
        encryptedPackage,
        {
          contentSignature,
          selfDestruct: isReaction ? false : selfDestruct,
          destructAfterSeconds: !isReaction && selfDestruct ? 30 : undefined,
          spoiler: isReaction ? false : spoiler,
          messageType: isReaction ? 'reaction' : undefined,
        }
      );

      if (!res.success) {
        setSendError(res.error ?? t('mid_error_send_failed'));
        return;
      }

      await load(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('mid_error_unknown');
      console.error('[Qwalla send]', e);
      setSendError(msg);
    } finally {
      setSending(false);
    }
  }

  async function sendText() {
    const body = text.trim();
    if (!body) return;
    const replyTo = replyingTo?.id;
    setText('');
    setPanel('none');
    setSpoiler(false);
    setShowOptions(false);
    setReplyingTo(null);
    await sendContent(body, { replyTo });
  }

  async function sendReaction(target: string, emoji: string) {
    setActionMsg(null);
    if (!target) return;
    // Optimistic: show the reaction immediately; load(true) reconciles.
    setReactions((prev) => {
      const list = prev[target] ? [...prev[target]] : [];
      list.push({ emoji, mine: true });
      return { ...prev, [target]: list };
    });
    await sendContent('', { reaction: { target, emoji } });
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

  function goSendCrypto() {
    setShowOptions(false);
    if (!peerSigning) return;
    // The peer prop is the recipient's wallet public key; the Send screen
    // accepts a pubkey and the user confirms the amount there (no auto-send).
    router.push({ pathname: '/(tabs)/wallet/send', params: { to: peerSigning } });
  }

  async function pickImage(fromCamera = false) {
    setPanel('none');
    setShowOptions(false);
    if (fromCamera) {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('mid_perm_needed_title'), t('mid_perm_camera_msg'));
        return;
      }
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('mid_perm_needed_title'), t('mid_perm_needed_msg'));
        return;
      }
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.7,
          base64: true,
          allowsEditing: false,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.7,
          base64: true,
          allowsEditing: false,
        });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (!asset.base64) return;
    // The node caps a message at 2 MB of encryptedContent, and the encryption
    // inflates the image a lot: it's base64-inlined into the plaintext (~1.37x),
    // a 1:1 message is encrypted twice (recipient + self copy), and each copy is
    // hex-encoded (2x) — so encryptedContent ≈ 5.5x the *decoded* image size.
    // A ~320 KB image therefore lands near ~1.75 MB, safely under the cap. Always
    // re-encode a too-big photo (wrapped so a decode failure on an odd format
    // surfaces cleanly instead of silently dropping the send).
    const SEND_IMAGE_MAX_BYTES = 320 * 1024;
    let base64 = asset.base64;
    let mimeType = asset.mimeType || 'image/jpeg';
    let uri = asset.uri;
    if (base64Bytes(base64) > SEND_IMAGE_MAX_BYTES) {
      let fitted: Awaited<ReturnType<typeof compressImageToLimit>> = null;
      try {
        fitted = await compressImageToLimit(asset.uri, SEND_IMAGE_MAX_BYTES, asset.width);
      } catch {
        fitted = null;
      }
      if (!fitted) {
        Alert.alert(t('mid_img_too_large_title'), t('mid_img_too_large_msg'));
        return;
      }
      base64 = fitted.base64;
      mimeType = fitted.mimeType;
      uri = fitted.uri;
    }
    const dataUri = `data:${mimeType};base64,${base64}`;
    setAttachPreview({ uri, base64: dataUri });
  }

  async function sendAttachment() {
    if (!attachPreview) return;
    const dataUri = attachPreview.base64;
    setAttachPreview(null);
    await sendContent(dataUri);
  }

  function cancelAttachment() {
    setAttachPreview(null);
  }

  function isSpoilerMsg(m: Msg): boolean {
    return !!(m.spoiler);
  }

  function revealSpoiler(id: string) {
    setRevealedIds(prev => new Set(prev).add(id));
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

    if (kind === 'gif' || kind === 'image') {
      // Render at the image's real aspect ratio (capped) so the whole photo is
      // visible in the bubble; tap still opens the full-screen lightbox.
      const IMG_W = 240;
      const IMG_MAX_H = 340;
      const ratio = imgRatios[body];
      const imgDims = ratio
        ? { width: IMG_W, height: Math.min(Math.round(IMG_W / ratio), IMG_MAX_H) }
        : { width: IMG_W, height: 180 };
      return (
        <View>
          <Pressable
            onPress={() => setLightboxUrl(body)}
            style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, styles.gifBubble]}>
            <Image
              source={{ uri: body }}
              style={[styles.gifImage, imgDims]}
              resizeMode="cover"
              onLoad={(e) => {
                const src = e.nativeEvent?.source;
                if (src?.width && src?.height && !imgRatios[body]) {
                  setImgRatios((p) => ({ ...p, [body]: src.width / src.height }));
                }
              }}
            />
          </Pressable>
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
    if (!wallet) return;
    if (Platform.OS === 'web') {
      if (!window.confirm(t('mid_delete_confirm_web'))) return;
    } else {
      const confirmed = await new Promise<boolean>((resolve) =>
        Alert.alert(t('mid_delete_title'), t('mid_delete_msg'), [
          { text: t('mid_cancel'), style: 'cancel', onPress: () => resolve(false) },
          { text: t('mid_delete'), style: 'destructive', onPress: () => resolve(true) },
        ])
      );
      if (!confirmed) return;
    }
    try {
      await rc.messenger.deleteConversation(wallet, String(conversationId));
    } catch { /* best effort */ }
    onClose();
  }

  function blockUser() {
    const doBlock = () => {
      blockedRef.current.add(peerSigning);
      void blockWallet(peerSigning);
      onClose();
    };

    if (Platform.OS === 'web') {
      if (window.confirm(t('mid_block_confirm'))) doBlock();
    } else {
      Alert.alert(t('mid_block_title'), t('mid_block_confirm'), [
        { text: t('mid_cancel'), style: 'cancel' },
        { text: t('mid_block'), style: 'destructive', onPress: doBlock },
      ]);
    }
  }

  if (!wallet) return null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Action header */}
      <View style={styles.chatHeader}>
        <Pressable
          onPress={() => onClose()}
          hitSlop={8}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <View style={styles.headerLeft}>
          {convoMeta?.isGroup ? (
            convoMeta.avatar ? (
              <Image source={{ uri: convoMeta.avatar }} style={styles.peerAvatarImg} />
            ) : (
              <View style={styles.peerAvatar}>
                <Ionicons name="people" size={18} color={colors.textTertiary} />
              </View>
            )
          ) : peerAvatarUrl ? (
            <Image source={{ uri: peerAvatarUrl }} style={styles.peerAvatarImg} />
          ) : (
            <View style={styles.peerAvatar}>
              <Ionicons name="person" size={16} color={colors.textTertiary} />
            </View>
          )}
          <View>
            <Text style={styles.peerName} numberOfLines={1}>
              {convoMeta?.isGroup
                ? convoMeta.name.trim() || t('mid_group_count').replace('{x}', String(convoMeta.participantIds.length))
                : peerName || (peerSigning ? peerSigning.slice(0, 12) + '…' : t('mid_chat_fallback'))}
            </Text>
            <View style={styles.encRow}>
              <Ionicons name="lock-closed" size={10} color={colors.accent} />
              <Text style={styles.headerLabel}>ML-KEM-768 + ML-DSA-65</Text>
            </View>
          </View>
        </View>
        <View style={styles.headerActions}>
          {convoMeta?.isGroup && (
            <Pressable onPress={() => setShowGroupInfo(true)} hitSlop={8} style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}>
              <Ionicons name="people-outline" size={20} color={colors.accent} />
            </Pressable>
          )}
          {peerEncPub && peerSigning && encPub && (
            <Pressable onPress={() => setShowVerify(true)} hitSlop={8} style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}>
              <Ionicons name="shield-checkmark-outline" size={20} color={colors.accent} />
            </Pressable>
          )}
          <Pressable
            onPress={() => conversationId && toggleMute(String(conversationId))}
            hitSlop={8}
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}>
            <Ionicons
              name={muted ? 'notifications-off' : 'notifications-outline'}
              size={20}
              color={muted ? colors.warning : colors.accent}
            />
          </Pressable>
          <Pressable onPress={deleteConversation} hitSlop={8} style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}>
            <Ionicons name="trash-outline" size={20} color={colors.error} />
          </Pressable>
          {!convoMeta?.isGroup && (
            <Pressable onPress={blockUser} hitSlop={8} style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}>
              <Ionicons name="ban-outline" size={20} color={colors.warning} />
            </Pressable>
          )}
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={headerHeight}>
        <FlatList
          data={messages}
          keyExtractor={(m) => String(m.id ?? Math.random())}
          inverted
          contentContainerStyle={styles.list}
          // Dragging the conversation dismisses the keyboard, like iOS Messages.
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          onRefresh={() => void load()}
          refreshing={loading}
          renderItem={({ item }) => {
            const mine = senderOf(item) === wallet.publicKey;
            const time = timeOf(item);
            const status = statusOf(item, mine);
            const msgId = String(item.id ?? '');
            const isSpoiler = isSpoilerMsg(item) && !revealedIds.has(msgId);
            const isSD = !!(item.selfDestruct || item.self_destruct);
            const replyTarget = item._replyTo
              ? messages.find((x) => String(x.id ?? '') === item._replyTo)
              : undefined;
            const rxCounts = (reactions[msgId] ?? []).reduce<Record<string, number>>((acc, r) => {
              acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
              return acc;
            }, {});
            const rxAgg = Object.entries(rxCounts);
            const avatarSrc = mine ? myAvatarUrl : peerAvatarUrl;
            const avatarEl = avatarSrc ? (
              <Image source={{ uri: avatarSrc }} style={styles.msgAvatar} />
            ) : (
              <View style={[styles.msgAvatar, { backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' }]}>
                <Ionicons name="person" size={10} color={colors.textTertiary} />
              </View>
            );
            return (
              <View style={Platform.OS === 'web' ? styles.invertedCell : undefined}>
                <View style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowTheirs]}>
                  {!mine && avatarEl}
                  <View style={{ flex: 1 }}>
                    {isSpoiler ? (
                      <Pressable
                        onPress={() => revealSpoiler(msgId)}
                        style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, styles.spoilerBubble]}
                      >
                        <Ionicons name="eye-off" size={16} color={colors.textTertiary} />
                        <Text style={styles.spoilerLabel}>{t('mid_tap_reveal')}</Text>
                      </Pressable>
                    ) : (
                      <Pressable onLongPress={() => item.id && setActionMsg(item)} delayLongPress={300}>
                        {replyTarget && (
                          <View style={[styles.replyQuote, mine ? styles.bubbleMineAlign : styles.bubbleTheirsAlign]}>
                            <View style={styles.replyBar} />
                            <Text style={styles.replyQuoteText} numberOfLines={1}>
                              {displayBody(replyTarget) || t('mid_message_placeholder_quote')}
                            </Text>
                          </View>
                        )}
                        {renderBubble(displayBody(item), mine, time, status)}
                        {rxAgg.length > 0 && (
                          <View style={[styles.reactionRow, mine ? styles.metaMine : styles.metaTheirs]}>
                            {rxAgg.map(([emoji, count]) => (
                              <View key={emoji} style={styles.reactionChip}>
                                <Text style={styles.reactionEmoji}>{emoji}</Text>
                                {count > 1 && <Text style={styles.reactionCount}>{count}</Text>}
                              </View>
                            ))}
                          </View>
                        )}
                        {(isSpoilerMsg(item) || isSD || item._sigValid !== undefined) && (
                          <View style={[styles.msgIcons, mine ? styles.metaMine : styles.metaTheirs]}>
                            {isSpoilerMsg(item) && <Ionicons name="eye-off-outline" size={12} color={colors.textTertiary} />}
                            {isSD && <Ionicons name="timer-outline" size={12} color={colors.warning} />}
                            {item._sigValid === true && <Ionicons name="checkmark-circle" size={12} color={colors.success ?? '#22c55e'} />}
                            {item._sigValid === false && <Ionicons name="close-circle" size={12} color={colors.error ?? '#ef4444'} />}
                          </View>
                        )}
                      </Pressable>
                    )}
                  </View>
                  {mine && avatarEl}
                </View>
              </View>
            );
          }}
        />

        {/* "+" menu: consolidates camera / photo / GIF / sticker / send-crypto
            plus the Spoiler & Self-destruct toggles, so the composer stays a
            single-line field until the user opens it. */}
        {showOptions && (
          <View style={styles.plusMenu}>
            <Pressable
              onPress={() => void pickImage(true)}
              style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.6 }]}>
              <Ionicons name="camera-outline" size={20} color={colors.accent} />
              <Text style={styles.menuLabel}>{t('mid_menu_camera')}</Text>
            </Pressable>
            <Pressable
              onPress={() => void pickImage(false)}
              style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.6 }]}>
              <Ionicons name="image-outline" size={20} color={colors.accent} />
              <Text style={styles.menuLabel}>{t('mid_menu_photo')}</Text>
            </Pressable>
            <Pressable
              onPress={() => { setShowOptions(false); togglePanel('gif'); }}
              style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.6 }]}>
              <Ionicons name="film-outline" size={20} color={colors.accent} />
              <Text style={styles.menuLabel}>GIF</Text>
            </Pressable>
            <Pressable
              onPress={() => { setShowOptions(false); togglePanel('sticker'); }}
              style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.6 }]}>
              <Ionicons name="happy-outline" size={20} color={colors.accent} />
              <Text style={styles.menuLabel}>{t('mid_menu_sticker')}</Text>
            </Pressable>
            {!!peerSigning && (
              <Pressable
                onPress={goSendCrypto}
                style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.6 }]}>
                <Ionicons name="cash-outline" size={20} color={colors.accent} />
                <Text style={styles.menuLabel}>{t('mid_menu_send_crypto')}</Text>
              </Pressable>
            )}
            <View style={styles.menuDivider} />
            <View style={styles.menuRow}>
              <Ionicons name="eye-off-outline" size={20} color={spoiler ? colors.accent : colors.textTertiary} />
              <Text style={[styles.menuLabel, spoiler && { color: colors.accent }]}>{t('mid_spoiler')}</Text>
              <View style={{ flex: 1 }} />
              <Switch
                value={spoiler}
                onValueChange={setSpoiler}
                trackColor={{ false: colors.surface, true: colors.accentDim }}
                thumbColor={spoiler ? colors.accent : colors.textTertiary}
              />
            </View>
            <View style={styles.menuRow}>
              <Ionicons name="timer-outline" size={20} color={selfDestruct ? colors.warning : colors.textTertiary} />
              <Text style={[styles.menuLabel, selfDestruct && { color: colors.warning }]}>{t('mid_self_destruct')}</Text>
              <View style={{ flex: 1 }} />
              <Switch
                value={selfDestruct}
                onValueChange={setSelfDestruct}
                trackColor={{ false: colors.surface, true: colors.accentDim }}
                thumbColor={selfDestruct ? colors.accent : colors.textTertiary}
              />
            </View>
            {selfDestruct && (
              <Text style={styles.sdHint}>{t('mid_self_destruct_hint')}</Text>
            )}
          </View>
        )}

        {sendError && (
          <Pressable onPress={() => setSendError(null)} style={styles.errorBanner}>
            <Ionicons name="warning" size={14} color="#fff" />
            <Text style={styles.errorText}>{sendError}</Text>
            <Ionicons name="close" size={14} color="#fff" />
          </Pressable>
        )}

        {/* Attachment preview */}
        {attachPreview && (
          <View style={styles.attachPreview}>
            <Image source={{ uri: attachPreview.uri }} style={styles.attachThumb} resizeMode="cover" />
            <View style={styles.attachActions}>
              <Pressable onPress={sendAttachment} style={({ pressed }) => [styles.attachSendBtn, pressed && { opacity: 0.7 }]}>
                <Ionicons name="send" size={14} color={colors.bg} />
                <Text style={styles.attachSendText}>{t('mid_send')}</Text>
              </Pressable>
              <Pressable onPress={cancelAttachment} style={({ pressed }) => [styles.attachCancelBtn, pressed && { opacity: 0.7 }]}>
                <Ionicons name="close" size={16} color={colors.error} />
              </Pressable>
            </View>
          </View>
        )}

        {/* Reply banner */}
        {replyingTo && (
          <View style={styles.replyBanner}>
            <View style={styles.replyBar} />
            <View style={{ flex: 1 }}>
              <Text style={styles.replyBannerLabel}>{t('mid_replying_to')}</Text>
              <Text style={styles.replyBannerText} numberOfLines={1}>
                {displayBody(replyingTo) || t('mid_message_placeholder_quote')}
              </Text>
            </View>
            <Pressable onPress={() => setReplyingTo(null)} hitSlop={8}>
              <Ionicons name="close" size={18} color={colors.textTertiary} />
            </Pressable>
          </View>
        )}

        {/* Input bar — a single "+" opens the menu above, leaving the message
            field as wide as possible (per tester feedback). */}
        <View style={styles.inputRow}>
          <Pressable
            onPress={() => { setPanel('none'); setShowOptions((v) => !v); }}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
            hitSlop={8}>
            <Ionicons
              name={showOptions ? 'close' : 'add'}
              size={28}
              color={showOptions || spoiler || selfDestruct ? colors.accent : colors.textTertiary}
            />
          </Pressable>
          <TextInput
            style={styles.input}
            placeholder={t('mid_input_placeholder')}
            placeholderTextColor={colors.textTertiary}
            value={text}
            onChangeText={setText}
            multiline
            autoCorrect
            autoCapitalize="sentences"
            spellCheck
            keyboardAppearance="dark"
            onFocus={() => { setPanel('none'); setShowOptions(false); }}
          />
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
        onEmojiSelected={(e) => setText((v) => v + e.emoji)}
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

      {/* Image lightbox */}
      <Modal
        visible={!!lightboxUrl}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxUrl(null)}>
        <View style={styles.lightboxOverlay}>
          <Pressable style={styles.lightboxClose} onPress={() => setLightboxUrl(null)}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          {lightboxUrl && (
            <Image
              source={{ uri: lightboxUrl }}
              style={styles.lightboxImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      {/* Message actions: quick reactions + reply */}
      <Modal
        visible={!!actionMsg}
        transparent
        animationType="fade"
        onRequestClose={() => setActionMsg(null)}>
        <Pressable style={styles.actionOverlay} onPress={() => setActionMsg(null)}>
          <View style={styles.actionSheet}>
            <View style={styles.reactionPicker}>
              {QUICK_REACTIONS.map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={() => actionMsg?.id && void sendReaction(String(actionMsg.id), emoji)}
                  style={({ pressed }) => [styles.reactionPick, pressed && { opacity: 0.6 }]}>
                  <Text style={styles.reactionPickEmoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              style={({ pressed }) => [styles.actionItem, pressed && { backgroundColor: colors.surface }]}
              onPress={() => {
                setReplyingTo(actionMsg);
                setActionMsg(null);
              }}>
              <Ionicons name="arrow-undo-outline" size={20} color={colors.text} />
              <Text style={styles.actionLabel}>{t('mid_reply')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Group info — rename + add members (groups only) */}
      <GroupInfoSheet
        visible={showGroupInfo}
        onClose={() => setShowGroupInfo(false)}
        wallet={wallet}
        conversationId={String(conversationId)}
        myPublicKey={wallet.publicKey}
        onAvatarPicked={(dataUri) =>
          setConvoMeta((prev) => (prev ? { ...prev, avatar: dataUri } : prev))
        }
        onChanged={() => {
          void resolveRecipients();
          void load(true);
        }}
      />

      {/* Safety number — out-of-band key verification (MITM defense) */}
      <Modal
        visible={showVerify}
        transparent
        animationType="fade"
        onRequestClose={() => setShowVerify(false)}>
        <Pressable style={styles.actionOverlay} onPress={() => setShowVerify(false)}>
          <Pressable style={styles.verifySheet} onPress={() => {}}>
            <View style={styles.verifyHeader}>
              <Ionicons name="shield-checkmark" size={22} color={colors.accent} />
              <Text style={styles.verifyTitle}>{t('mid_verify_title')}</Text>
            </View>
            <Text style={styles.verifyIntro}>
              {t('mid_verify_intro').replace('{name}', peerName || t('mid_verify_contact_fallback'))}
            </Text>
            <Text selectable style={styles.verifyNumber}>
              {peerEncPub && encPub
                ? computeSafetyNumber(wallet.publicKey, encPub, peerSigning, peerEncPub)
                : '…'}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.verifyDone, pressed && { opacity: 0.8 }]}
              onPress={() => setShowVerify(false)}>
              <Text style={styles.verifyDoneText}>{t('mid_done')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  list: { padding: spacing.md, gap: spacing.xs },
  invertedCell: { transform: [{ scaleY: -1 }] },

  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginBottom: 2 },
  msgRowMine: { justifyContent: 'flex-end' },
  msgRowTheirs: { justifyContent: 'flex-start' },
  msgAvatar: { width: 22, height: 22, borderRadius: 11, marginBottom: 6 },

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
  backBtn: { paddingVertical: 4, paddingRight: 4, marginLeft: -6, marginRight: 2 },

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
  gifImage: { width: 240, height: 180, borderRadius: 14, backgroundColor: colors.surface },

  stickerBubble: { marginBottom: 4 },
  stickerText: { fontSize: 48 },

  emojiBubble: { marginBottom: 4 },
  emojiText: { fontSize: 42 },

  spoilerBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    opacity: 0.6,
  },
  spoilerLabel: {
    color: colors.textTertiary,
    fontSize: 13,
    fontWeight: '500',
  },
  msgIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
    marginBottom: 4,
    paddingHorizontal: 2,
  },
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

  plusMenu: {
    marginHorizontal: spacing.sm,
    marginBottom: 6,
    paddingVertical: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  menuLabel: { color: colors.text, fontSize: 15, fontWeight: '500' },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 4,
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
  lightboxOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxImage: {
    width: Dimensions.get('window').width - 32,
    height: Dimensions.get('window').height - 160,
  },
  attachPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.chrome,
  },
  attachThumb: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  attachActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  attachSendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  attachSendText: {
    color: colors.bg,
    fontSize: 13,
    fontWeight: '600',
  },
  attachCancelBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,107,107,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Reply quote (above a bubble) + reply composer banner
  replyBar: { width: 3, borderRadius: 2, backgroundColor: colors.accent, alignSelf: 'stretch' },
  replyQuote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '82%',
    marginBottom: 2,
    paddingLeft: 4,
    opacity: 0.75,
  },
  replyQuoteText: { color: colors.textSecondary, fontSize: 12, flexShrink: 1 },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.sm,
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
  },
  replyBannerLabel: { color: colors.accent, fontSize: 11, fontWeight: '600' },
  replyBannerText: { color: colors.textSecondary, fontSize: 13, marginTop: 1 },

  // Reaction chips under a bubble
  reactionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2, marginBottom: 4 },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  reactionEmoji: { fontSize: 13 },
  reactionCount: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },

  // Long-press action sheet
  actionOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  actionSheet: {
    backgroundColor: colors.chrome,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  reactionPicker: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  reactionPick: { padding: 6 },
  reactionPickEmoji: { fontSize: 30 },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderRadius: radius.md,
  },
  actionLabel: { color: colors.text, fontSize: 16, fontWeight: '500' },

  // Safety-number verification sheet
  verifySheet: {
    margin: spacing.lg,
    marginTop: 'auto',
    marginBottom: 'auto',
    backgroundColor: colors.chrome,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  verifyHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verifyTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  verifyIntro: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  verifyNumber: {
    color: colors.text,
    fontSize: 18,
    letterSpacing: 1,
    lineHeight: 30,
    fontFamily: 'SpaceMono',
    textAlign: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  verifyDone: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  verifyDoneText: { color: colors.bg, fontSize: 16, fontWeight: '700' },
});

/** Route entry: reads params and renders the conversation, popping on close. */
export default function ChatScreen() {
  const { id, peer } = useLocalSearchParams<{ id: string; peer?: string }>();
  return (
    <ChatView conversationId={String(id ?? '')} peer={peer} onClose={() => router.back()} />
  );
}
