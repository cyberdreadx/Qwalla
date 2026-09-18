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
