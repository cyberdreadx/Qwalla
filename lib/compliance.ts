/**
 * App Store compliance gate.
 *
 * App Review Guideline 3.1.5(iii) requires that centralized *and* decentralized
 * exchange services only be offered where the app holds licensing to run an
 * exchange. Qwalla holds no such licensing, has no third-party exchange
 * partner, and integrates no third-party exchange API.
 *
 * What Apple actually found: build 24 removed the Swap/Pools/Bridge bookmarks,
 * but the reviewer opened the *Tokens* bookmark and reached the exchange from
 * rougechain.io's own sidebar. So the gate has to survive in-page navigation on
 * our own site, not just the bookmark index.
 *
 * Scope is deliberately narrow. On iOS this hides the exchange entry points
 * (wallet quick actions) and keeps RougeChain's own exchange pages out of the
 * in-app browser. It does not touch the wallet's web3 capabilities: third-party
 * dApps load normally, the injected provider still connects, signs, sends and
 * calls contracts, and the messenger, mail and block explorer are unaffected.
 * Android and web builds have no gate at all.
 */
import { Platform } from 'react-native';

/** False on iOS: RougeChain's own swap / pools / bridge are not surfaced. */
export const EXCHANGE_FEATURES_ENABLED = Platform.OS !== 'ios';

export const EXCHANGE_UNAVAILABLE_TITLE = 'Not available in this app';

export const EXCHANGE_UNAVAILABLE_MESSAGE =
  'Qwalla for iOS does not offer token exchange, liquidity or bridging. ' +
  'The wallet, dApp browser, messenger, mail and block explorer are unaffected.';

/** RougeChain-operated hosts — the first-party exchange we are responsible for. */
function isRougeChainHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return host === 'rougechain.io' || host.endsWith('.rougechain.io');
}

/**
 * First path segments that identify an exchange surface on our own site.
 * Matched against the *first* segment only, so /token/XRGE and /blockchain are
 * unaffected while /swap and /pools are caught.
 */
const EXCHANGE_PATH_SEGMENTS = new Set([
  'swap',
  'swaps',
  'pool',
  'pools',
  'bridge',
  'dex',
  'exchange',
  'trade',
  'trading',
  'liquidity',
  'farm',
]);

function isExchangeSegment(segment: string | undefined): boolean {
  return !!segment && EXCHANGE_PATH_SEGMENTS.has(segment.toLowerCase());
}

/**
 * True when a URL points at a RougeChain exchange page that must not open in
 * the iOS build. Always false on Android/web, and always false for third-party
 * sites — those load like any other page in the dApp browser.
 */
export function isBlockedExchangeUrl(rawUrl: string): boolean {
  if (EXCHANGE_FEATURES_ENABLED) return false;
  if (!rawUrl) return false;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (!isRougeChainHost(parsed.hostname)) return false;

  if (isExchangeSegment(parsed.pathname.split('/').filter(Boolean)[0])) return true;

  // The site can also route through the fragment (…/#/swap).
  const hash = parsed.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return isExchangeSegment(hash);
}
