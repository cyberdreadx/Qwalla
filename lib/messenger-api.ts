import type { Wallet } from '@rougechain/sdk';

import { rc } from '@/lib/rougechain';

/** Fetch messages for a conversation using the SDK's v2 signed endpoint */
export async function fetchMessengerMessages(wallet: Wallet, conversationId: string) {
  const data = await rc.messenger.getMessages(wallet, conversationId);
  return (Array.isArray(data) ? data : []) as Record<string, unknown>[];
}

/** True when the running SDK build supports renaming conversations. */
export function canRenameConversation(): boolean {
  return typeof rc.messenger.updateConversation === 'function';
}

/** True when the running SDK build supports adding participants. */
export function canAddParticipants(): boolean {
  return typeof rc.messenger.addParticipants === 'function';
}

/**
 * Rename a group conversation. Throws a clear error if the SDK build doesn't
 * ship the endpoint yet, so the UI can surface it instead of crashing on an
 * undefined method.
 */
export async function renameConversation(wallet: Wallet, conversationId: string, name: string) {
  if (!rc.messenger.updateConversation) {
    throw new Error('Renaming isn’t available in this app version yet.');
  }
  return rc.messenger.updateConversation(wallet, conversationId, { name });
}

/**
 * Read a conversation's group avatar (a base64 data-URI) from whatever shape the
 * node returns, or null if none / not yet supported by the backend.
 */
export function conversationAvatarOf(convo: Record<string, unknown> | null | undefined): string | null {
  if (!convo) return null;
  const v = (convo.avatar ?? convo.avatarUrl ?? convo.avatar_url ?? convo.groupAvatar ?? convo.group_avatar) as
    | string
    | undefined;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Set (or clear, with '') a group conversation's avatar. The current `name` is
 * passed through so the existing update endpoint doesn't blank it. Forward-
 * compatible: today's SDK signs only `name` and ignores `avatar`, so this is a
 * harmless no-op on the avatar until the SDK + node add the field — at which
 * point the exact same call starts persisting it. See docs/group-avatar-spec.md.
 */
export async function setConversationAvatar(
  wallet: Wallet,
  conversationId: string,
  name: string,
  avatar: string,
) {
  if (!rc.messenger.updateConversation) {
    throw new Error('Group photos aren’t available in this app version yet.');
  }
  return rc.messenger.updateConversation(wallet, conversationId, {
    name,
    avatar,
  } as Parameters<typeof rc.messenger.updateConversation>[2]);
}

/**
 * Add participants to an existing conversation. Throws a clear error if the SDK
 * build doesn't ship the endpoint yet.
 */
export async function addConversationParticipants(
  wallet: Wallet,
  conversationId: string,
  participantIds: string[],
) {
  if (!rc.messenger.addParticipants) {
    throw new Error('Adding members isn’t available in this app version yet.');
  }
  return rc.messenger.addParticipants(wallet, conversationId, participantIds);
}
