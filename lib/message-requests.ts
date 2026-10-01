import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Message-request gate (Instagram/Signal-style). The node has no server-side
 * "accept" primitive, so which conversations you've accepted is tracked locally.
 *
 * A 1:1 chat you didn't start and haven't accepted is a *request*: it's shown in
 * a separate Requests tab with its preview hidden, and you Accept (move to
 * Primary) or Delete (block the sender). Conversations you start are
 * auto-accepted; all pre-existing conversations are grandfathered on first run
 * so only genuinely new incoming chats become requests.
 */

const ACCEPTED_KEY = 'qwalla_accepted_chats';
const MIGRATED_KEY = 'qwalla_requests_migrated';

export async function getAcceptedChats(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(ACCEPTED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export async function acceptChat(conversationId: string): Promise<void> {
  if (!conversationId) return;
  const list = await getAcceptedChats();
  if (list.includes(conversationId)) return;
  list.push(conversationId);
  await AsyncStorage.setItem(ACCEPTED_KEY, JSON.stringify(list));
}

/**
 * One-time migration: grandfather all currently-existing conversations as
 * accepted, so turning this feature on doesn't quarantine chats the user
 * already has. Returns true if it ran (caller should reload the accepted set).
 */
export async function migrateExistingChats(conversationIds: string[]): Promise<boolean> {
  try {
    const done = await AsyncStorage.getItem(MIGRATED_KEY);
    if (done) return false;
    const set = new Set(await getAcceptedChats());
    for (const id of conversationIds) if (id) set.add(id);
    await AsyncStorage.setItem(ACCEPTED_KEY, JSON.stringify([...set]));
    await AsyncStorage.setItem(MIGRATED_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

// ── Mail: the same gate, keyed by SENDER (wallet id/address) instead of a
// conversation id. A mail from a sender you haven't accepted, emailed, or
// transacted with is a request. ──────────────────────────────────────────────
const ACCEPTED_SENDERS_KEY = 'qwalla_accepted_mail_senders';
const MAIL_MIGRATED_KEY = 'qwalla_mail_requests_migrated';

export async function getAcceptedSenders(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(ACCEPTED_SENDERS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export async function acceptSender(senderId: string): Promise<void> {
  if (!senderId) return;
  const list = await getAcceptedSenders();
  if (list.includes(senderId)) return;
  list.push(senderId);
  await AsyncStorage.setItem(ACCEPTED_SENDERS_KEY, JSON.stringify(list));
}

/** Grandfather existing inbox senders on first run (same idea as chats). */
export async function migrateExistingSenders(senderIds: string[]): Promise<boolean> {
  try {
    const done = await AsyncStorage.getItem(MAIL_MIGRATED_KEY);
    if (done) return false;
    const set = new Set(await getAcceptedSenders());
    for (const id of senderIds) if (id) set.add(id);
    await AsyncStorage.setItem(ACCEPTED_SENDERS_KEY, JSON.stringify([...set]));
    await AsyncStorage.setItem(MAIL_MIGRATED_KEY, '1');
    return true;
  } catch {
    return false;
  }
}
