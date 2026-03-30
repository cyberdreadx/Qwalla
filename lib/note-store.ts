import AsyncStorage from '@react-native-async-storage/async-storage';

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

const NOTE_KEY = 'qwalla-shielded-notes';
const SENT_KEY = 'qwalla-shielded-sent';

async function loadAll(): Promise<StoredNote[]> {
  try {
    const raw = await AsyncStorage.getItem(NOTE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function persist(notes: StoredNote[]): Promise<void> {
  await AsyncStorage.setItem(NOTE_KEY, JSON.stringify(notes));
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
    const raw = await AsyncStorage.getItem(SENT_KEY);
    const notes: (StoredNote & { senderPubKey: string })[] = raw ? JSON.parse(raw) : [];
    if (notes.some((n) => n.commitment === note.commitment)) return;
    notes.push({ ...note, senderPubKey, createdAt: Date.now(), spent: false });
    await AsyncStorage.setItem(SENT_KEY, JSON.stringify(notes));
  } catch { /* ignore */ }
}

export async function deleteNote(nullifier: string): Promise<void> {
  const notes = await loadAll();
  await persist(notes.filter((n) => n.nullifier !== nullifier));
}
