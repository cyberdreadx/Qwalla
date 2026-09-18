/**
 * Mail threading — Gmail-style conversation grouping.
 *
 * The chain has no thread primitive; each mail carries an optional `replyToId`
 * pointing at the message it answers. We walk those links up to a root and group
 * every message that shares it into one conversation, ordered oldest→newest.
 *
 * Shared by the folder list (one row per thread) and the detail view (the full
 * back-and-forth), so both agree on what a "thread" is.
 */
import type { Wallet } from '@rougechain/sdk';

import { fetchMailInbox, fetchMailSent, fetchMailTrash } from '@/lib/mail-api';

export type MailRow = {
  id: string;
  fromWalletId: string;
  toWalletIds: string[];
  senderName: string;
  subject: string;
  subjectEncrypted: string;
  bodyEncrypted: string;
  attachmentEncrypted: string;
  /** Plaintext body (legacy / cross-client mails with no encrypted body). */
  body: string;
  /** Legacy single-blob encrypted payload (older mails). */
  encrypted: string;
  hasAttachment: boolean;
  createdAt: string;
  isRead: boolean;
  folder: string;
  replyToId?: string;
};

export type ThreadGroup = {
  rootId: string;
  subject: string;
  subjectEncrypted: string;
  latestRow: MailRow;
  messages: MailRow[];
  participants: string[];
  hasUnread: boolean;
  latestDate: string;
};

export function normalizeRow(raw: Record<string, unknown>): MailRow {
  const msg = (raw.message ?? raw) as Record<string, unknown>;
  const label = (raw.label ?? {}) as Record<string, unknown>;

  return {
    id: String(msg.id ?? raw.id ?? ''),
    fromWalletId: String(msg.fromWalletId ?? msg.from_wallet_id ?? msg.from ?? ''),
    toWalletIds: ((msg.toWalletIds ?? msg.to_wallet_ids ?? [msg.to]) as unknown[]).filter(Boolean) as string[],
    senderName: String(msg.senderName ?? msg.sender_name ?? ''),
    subject: String(msg.subject ?? ''),
    subjectEncrypted: String(
      msg.subjectEncrypted ?? msg.subject_encrypted ?? msg.encrypted_subject ?? msg.encryptedSubject ?? '',
    ),
    bodyEncrypted: String(
      msg.bodyEncrypted ?? msg.body_encrypted ?? msg.encrypted_body ?? msg.encryptedBody ?? '',
    ),
    attachmentEncrypted: String(msg.attachmentEncrypted ?? msg.attachment_encrypted ?? ''),
    body: String(msg.body ?? ''),
    encrypted: String(msg.encrypted ?? ''),
    hasAttachment: Boolean(msg.hasAttachment ?? msg.has_attachment ?? false),
    createdAt: String(msg.createdAt ?? msg.created_at ?? ''),
    isRead: Boolean(label.isRead ?? label.is_read ?? raw.read ?? true),
    folder: String(label.folder ?? ''),
    replyToId: (msg.replyToId ?? msg.reply_to_id ?? undefined) as string | undefined,
  };
}

/** Walk `replyToId` links up to the thread root (bounded against cycles). */
export function findRootId(row: MailRow, byId: Map<string, MailRow>): string {
  let rootId = row.id;
  let cur = row;
  const seen = new Set<string>([row.id]);
  while (cur.replyToId && byId.has(cur.replyToId) && !seen.has(cur.replyToId)) {
    rootId = cur.replyToId;
    seen.add(rootId);
    cur = byId.get(cur.replyToId)!;
  }
  return rootId;
}

export function groupByThread(rows: MailRow[]): ThreadGroup[] {
  const byId = new Map<string, MailRow>();
  for (const r of rows) byId.set(r.id, r);

  const groups = new Map<string, MailRow[]>();
  for (const r of rows) {
    const rootId = findRootId(r, byId);
    const arr = groups.get(rootId) || [];
    arr.push(r);
    groups.set(rootId, arr);
  }

  const result: ThreadGroup[] = [];
  for (const [rootId, msgs] of groups) {
    msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const latest = msgs[msgs.length - 1];
    const root = byId.get(rootId);
    const subject = root?.subject || latest.subject || '';
    const subjectEncrypted = root?.subjectEncrypted || latest.subjectEncrypted || '';
    const participantSet = new Set<string>();
    for (const m of msgs) {
      const name = m.senderName || m.fromWalletId;
      if (name) participantSet.add(name);
    }
    result.push({
      rootId,
      subject,
      subjectEncrypted,
      latestRow: latest,
      messages: msgs,
      participants: [...participantSet],
      hasUnread: msgs.some((m) => !m.isRead),
      latestDate: latest.createdAt,
    });
  }

  result.sort((a, b) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime());
  return result;
}

/**
 * Load the full conversation containing `messageId`.
 *
 * A thread spans folders (your sent replies + their inbox messages), so we merge
 * inbox + sent, dedupe by id, group, and return the thread that holds the opened
 * message — ordered oldest→newest. Returns `[]` if it can't be reconstructed
 * (caller falls back to showing the single message).
 */
export async function fetchThread(wallet: Wallet, messageId: string): Promise<MailRow[]> {
  const [inbox, sent] = await Promise.all([
    fetchMailInbox(wallet).catch(() => [] as Record<string, unknown>[]),
    fetchMailSent(wallet).catch(() => [] as Record<string, unknown>[]),
  ]);

  const byId = new Map<string, MailRow>();
  for (const raw of [...inbox, ...sent]) {
    const row = normalizeRow(raw);
    if (row.id) byId.set(row.id, row); // dedupe (a self-addressed mail can appear in both)
  }

  // The opened message may live in trash; pull it in so its thread still resolves.
  if (!byId.has(messageId)) {
    const trash = await fetchMailTrash(wallet).catch(() => [] as Record<string, unknown>[]);
    for (const raw of trash) {
      const row = normalizeRow(raw);
      if (row.id) byId.set(row.id, row);
    }
  }

  const target = byId.get(messageId);
  if (!target) return [];

  const rootId = findRootId(target, byId);
  const thread = [...byId.values()].filter((r) => findRootId(r, byId) === rootId);
  thread.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return thread;
}
