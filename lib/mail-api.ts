import { ROUGECHAIN_API } from '@/constants/config';

export async function fetchMailInbox(publicKey: string) {
  const res = await fetch(`${ROUGECHAIN_API}/mail/inbox?publicKey=${encodeURIComponent(publicKey)}`);
  if (!res.ok) throw new Error(`inbox ${res.status}`);
  const data = await res.json();
  return (data.messages ?? data.mail ?? []) as Record<string, unknown>[];
}

export async function fetchMailSent(publicKey: string) {
  const res = await fetch(`${ROUGECHAIN_API}/mail/sent?publicKey=${encodeURIComponent(publicKey)}`);
  if (!res.ok) throw new Error(`sent ${res.status}`);
  const data = await res.json();
  return (data.messages ?? data.mail ?? []) as Record<string, unknown>[];
}

export async function fetchMailTrash(publicKey: string) {
  const res = await fetch(`${ROUGECHAIN_API}/mail/trash?publicKey=${encodeURIComponent(publicKey)}`);
  if (!res.ok) throw new Error(`trash ${res.status}`);
  const data = await res.json();
  return (data.messages ?? data.mail ?? []) as Record<string, unknown>[];
}

export async function fetchMailMessage(id: string, publicKey: string) {
  const res = await fetch(
    `${ROUGECHAIN_API}/mail/message/${encodeURIComponent(id)}?publicKey=${encodeURIComponent(publicKey)}`
  );
  if (!res.ok) throw new Error(`message ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}
