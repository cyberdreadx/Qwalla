/**
 * App Store compliance gate.
 *
 * App Review Guideline 3.1.5(iii) requires that centralized *and* decentralized
 * exchange services only be offered where the app holds licensing to run an
 * exchange, and Guideline 4.7 covers software the app surfaces but does not
 * embed. Reviewers judge what the app *presents*: build 24 still shipped
 * RougeChain bookmarks, the reviewer tapped Tokens, and reached the exchange
 * from rougechain.io's own sidebar.
 *
 * So the iOS build ships no RougeChain dApps in its bookmark index and no
 * exchange entry points in the wallet. That is the whole gate — nothing is
 * blocked or disabled. rougechain.io stays fully usable in the dApp browser for
 * anyone who types or saves the URL, the injected provider still connects,
 * signs, sends and calls contracts, and the wallet, messenger, mail and
 * explorer are untouched. Android and web ship everything.
 */
import { Platform } from 'react-native';

/** False on iOS: no Swap / Bridge / Stake entry points in the wallet. */
export const EXCHANGE_FEATURES_ENABLED = Platform.OS !== 'ios';

/** False on iOS: RougeChain dApps are not listed in the bookmark index. */
export const BUNDLE_ROUGECHAIN_BOOKMARKS = Platform.OS !== 'ios';

function isRougeChainHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return host === 'rougechain.io' || host.endsWith('.rougechain.io');
}

/**
 * Whether a bundled bookmark ships in this build's browser index. Only affects
 * the shortcuts the app ships with — it is not a navigation block, and custom
 * bookmarks the user saves are unaffected.
 */
export function isBundledBookmarkListed(rawUrl: string): boolean {
  if (BUNDLE_ROUGECHAIN_BOOKMARKS) return true;

  try {
    return !isRougeChainHost(new URL(rawUrl).hostname);
  } catch {
    return true;
  }
}
