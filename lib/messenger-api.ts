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
