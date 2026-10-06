import type { Wallet } from '@rougechain/sdk';

import { decryptAnyFb } from '@/lib/decrypt-fallback';
import { fetchMessengerMessages } from '@/lib/messenger-api';
import { writeCache } from '@/lib/message-cache';

/**
 * Warm the on-disk cache for a conversation while the app is foregrounded, so
 * tapping into it paints instantly instead of doing a cold fetch+decrypt. The
 * chat screen ([id].tsx) always refreshes from the network on open, so this is
 * purely a head-start and best-effort: failures and any drift self-correct.
 *
 * Mirrors [id].tsx's cache format (Msg rows with `_body`/`_replyTo` + reaction
 * rows), but intentionally simpler — it skips signature verification (done on
 * open), self-destruct messages (never cached), and anything that doesn't
 * decrypt (left out so the open-time load fetches it fresh).
 */

type Row = Record<string, unknown>;

// Duplicated from [id].tsx (small, stable, pure) to avoid refactoring the chat
// screen. If the envelope format changes there, update here too — but a mismatch
// only costs a head-start, never correctness (the open-time load is canonical).
function parseEnvelope(raw: string):
  | { kind: 'msg'; body: string; replyTo?: string }
  | { kind: 'rx'; target: string; emoji: string } {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o && o.v === 1 && o.k === 'msg' && typeof o.b === 'string') {
      return { kind: 'msg', body: o.b, replyTo: typeof o.r === 'string' ? o.r : undefined };
    }
    if (o && o.v === 1 && o.k === 'rx' && typeof o.t === 'string' && typeof o.e === 'string') {
      return { kind: 'rx', target: o.t, emoji: o.e };
    }
  } catch {
    /* legacy plain body */
  }
  return { kind: 'msg', body: raw };
}

function epoch(m: Row): number {
  const raw = (m.createdAt ?? m.created_at) as string | undefined;
  if (raw) {
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) return t;
  }
  return Number(m.timestamp ?? 0);
}

function rowCipher(m: Row): string {
  return String(m.encrypted_content ?? m.encryptedContent ?? m.encrypted ?? '');
}

export async function prefetchConversation(
  wallet: Wallet,
  conversationId: string,
  encPriv: string,
  encPub: string,
): Promise<void> {
  try {
    const rows = (await fetchMessengerMessages(wallet, conversationId)) as Row[];
    if (!Array.isArray(rows) || rows.length === 0) return;
    const myPk = wallet.publicKey.toLowerCase();
    const messages: Row[] = [];
    const reactions: { id: string; target: string; emoji: string; mine: boolean; cipher: string }[] = [];

    for (const m of rows) {
      if (m.selfDestruct || m.self_destruct) continue; // ephemeral — never cached
      const sender = String(
        m.senderWalletId ?? m.sender_wallet_id ?? m.sender ?? m.sender_public_key ?? m.senderPublicKey ?? '',
      ).toLowerCase();
      const isMine = sender === myPk;
      const cipher = rowCipher(m);
      let env;
      try {
        env = parseEnvelope(decryptAnyFb(cipher, encPriv, encPub, isMine));
      } catch {
        continue; // couldn't decrypt — leave it for the open-time load
      }
      const id = String(m.id ?? '');
      if (env.kind === 'rx') {
        if (id) reactions.push({ id, target: env.target, emoji: env.emoji, mine: isMine, cipher });
      } else {
        m._body = env.body;
        m._replyTo = env.replyTo;
        messages.push(m);
      }
    }

    messages.sort((a, b) => epoch(b) - epoch(a)); // newest-first, matches the chat
    await writeCache(wallet.publicKey, `c_${conversationId}`, { messages, reactions });
  } catch {
    /* best-effort — never throw into the caller */
  }
}

/**
 * Prefetch the newest `limit` conversations, one at a time with a small yield
 * between them so it never competes with foreground interaction. Skips ids that
 * already have a cache written this session (tracked by the caller via `done`).
 */
export async function prefetchRecent(
  wallet: Wallet,
  conversationIds: string[],
  encPriv: string,
  encPub: string,
  limit = 4,
): Promise<void> {
  for (const id of conversationIds.slice(0, limit)) {
    if (!id) continue;
    await prefetchConversation(wallet, id, encPriv, encPub);
    await new Promise((r) => setTimeout(r, 150)); // breathe between conversations
  }
}
