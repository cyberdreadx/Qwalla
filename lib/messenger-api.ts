import type { Wallet } from '@rougechain/sdk';

import { rc } from '@/lib/rougechain';

/** Fetch messages for a conversation using the SDK's v2 signed endpoint */
export async function fetchMessengerMessages(wallet: Wallet, conversationId: string) {
  const data = await rc.messenger.getMessages(wallet, conversationId);
  return (Array.isArray(data) ? data : []) as Record<string, unknown>[];
}
