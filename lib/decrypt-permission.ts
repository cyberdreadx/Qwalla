/**
 * Permission for a dApp to read messages encrypted to the user.
 *
 * `window.rougechain.decrypt` opens envelopes with the wallet's messaging keys —
 * the same keys that protect Qwalla Chats, Mail and RouGee DMs. Being connected
 * only lets a site see the public key and balance, so decrypting needs its own,
 * explicit grant: the user is asked the first time a site calls `decrypt` for
 * the active account, the answer "allow" is remembered for that site AND that
 * account (each account has its own keys and inbox, so switching accounts asks
 * again), and disconnecting the site (or revoking in Settings) withdraws it. A "deny" is not remembered — the site can
 * ask again on its next call, and the user decides again.
 *
 * Asking on every call would make a DM inbox (dozens of envelopes at once)
 * unusable, so concurrent calls from one site share one prompt.
 */
import { allowDecrypt, canDecrypt } from '@qwalla/core/provider-bridge';

const inFlight = new Map<string, Promise<boolean>>();

/**
 * Resolve true when `origin` may decrypt for `account` (the active wallet's public key) — already granted, or the user says yes
 * now (via `ask`). Calls that arrive while a prompt is open wait for that prompt.
 */
export async function ensureDecryptPermission(
  origin: string,
  account: string,
  ask: () => Promise<boolean>,
): Promise<boolean> {
  if (!account) return false;
  if (await canDecrypt(origin, account)) return true;
  const key = `${origin}\n${account.toLowerCase()}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const yes = await ask();
        if (yes) await allowDecrypt(origin, account);
        return yes;
      } catch {
        return false;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, pending);
  }
  return pending;
}
