// Canonical comparison key for browser URLs.
//
// The in-app browser compares URLs in several places — "is this page
// bookmarked?", history de-duplication, omnibox suggestion de-duplication — and
// raw string equality gets them wrong: `https://rougee.app` (a shipped default
// bookmark) never matches the visited `https://rougee.app/`, and host casing
// differs between what a user types and what a site redirects to. urlKey()
// normalizes just enough to make those comparisons behave, while deliberately
// KEEPING the query string and hash so distinct pages (e.g. search results,
// hash-routed SPA views) are not merged.

export function urlKey(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.host.toLowerCase();
    // Strip trailing slashes from the path so `/foo/` === `/foo` and
    // `https://site.com/` === `https://site.com`.
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol.toLowerCase()}//${host}${path}${u.search}${u.hash}`;
  } catch {
    return (raw || '').trim();
  }
}

/** Whether two URLs point at the same page, ignoring trailing-slash/host-case noise. */
export function sameUrl(a: string, b: string): boolean {
  return urlKey(a) === urlKey(b);
}
