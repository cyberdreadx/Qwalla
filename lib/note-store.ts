import AsyncStorage from '@react-native-async-storage/async-storage';

import { getActiveNetworkId } from '@/lib/rougechain';

export interface ShieldedNote {
  commitment: string;
  nullifier: string;
  value: number;
  randomness: string;
  ownerPubKey: string;
}

export interface StoredNote extends ShieldedNote {
  createdAt: number;
  spent: boolean;
  spentAt?: number;
}

/**
 * Notes are network-scoped so testnet notes can never be spent (or shown)
 * against mainnet and vice versa. Testnet keeps the legacy un-suffixed key
 * so existing users don't lose notes on upgrade.
 */
function noteKey(): string {
  const id = getActiveNetworkId();
  return id === 'testnet' ? 'qwalla-shielded-notes' : `qwalla-shielded-notes:${id}`;
}

function sentKey(): string {
  const id = getActiveNetworkId();
  return id === 'testnet' ? 'qwalla-shielded-sent' : `qwalla-shielded-sent:${id}`;
}

async function loadAll(): Promise<StoredNote[]> {
  try {
    const raw = await AsyncStorage.getItem(noteKey());
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function persist(notes: StoredNote[]): Promise<void> {
  await AsyncStorage.setItem(noteKey(), JSON.stringify(notes));
}

export async function saveNote(note: ShieldedNote): Promise<void> {
  const notes = await loadAll();
  if (notes.some((n) => n.commitment === note.commitment)) return;
  notes.push({ ...note, createdAt: Date.now(), spent: false });
  await persist(notes);
}

export async function getActiveNotes(ownerPubKey: string): Promise<StoredNote[]> {
  const notes = await loadAll();
  return notes.filter((n) => n.ownerPubKey === ownerPubKey && !n.spent);
}

export async function getShieldedBalance(ownerPubKey: string): Promise<number> {
  const active = await getActiveNotes(ownerPubKey);
  return active.reduce((sum, n) => sum + n.value, 0);
}

export async function markSpent(nullifier: string): Promise<void> {
  const notes = await loadAll();
  const note = notes.find((n) => n.nullifier === nullifier);
  if (note) {
    note.spent = true;
    note.spentAt = Date.now();
    await persist(notes);
  }
}

export async function importNote(jsonStr: string, ownerPubKey: string): Promise<StoredNote> {
  const parsed = JSON.parse(jsonStr) as ShieldedNote;
  if (!parsed.commitment || !parsed.nullifier || !parsed.randomness || !parsed.value || !parsed.ownerPubKey) {
    throw new Error('Invalid note — missing required fields');
  }
  if (parsed.ownerPubKey !== ownerPubKey) {
    throw new Error('This note belongs to a different wallet');
  }
  const notes = await loadAll();
  if (notes.some((n) => n.commitment === parsed.commitment)) {
    throw new Error('Note already imported');
  }
  const stored: StoredNote = { ...parsed, createdAt: Date.now(), spent: false };
  notes.push(stored);
  await persist(notes);
  return stored;
}

export async function saveSentNote(note: ShieldedNote, senderPubKey: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(sentKey());
    const notes: (StoredNote & { senderPubKey: string })[] = raw ? JSON.parse(raw) : [];
    if (notes.some((n) => n.commitment === note.commitment)) return;
    notes.push({ ...note, senderPubKey, createdAt: Date.now(), spent: false });
    await AsyncStorage.setItem(sentKey(), JSON.stringify(notes));
  } catch { /* ignore */ }
}

export async function deleteNote(nullifier: string): Promise<void> {
  const notes = await loadAll();
  await persist(notes.filter((n) => n.nullifier !== nullifier));
}
