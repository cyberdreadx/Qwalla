import { ROUGECHAIN_API } from '@/constants/config';

/** GET messages with publicKey (docs) — SDK client omits optional filter */
export async function fetchMessengerMessages(conversationId: string, publicKey: string) {
  const q = new URLSearchParams({
    conversationId,
    publicKey,
  });
  const res = await fetch(`${ROUGECHAIN_API}/messenger/messages?${q.toString()}`);
  if (!res.ok) throw new Error(`messages ${res.status}`);
  const data = await res.json();
  return (data.messages ?? []) as Record<string, unknown>[];
}
