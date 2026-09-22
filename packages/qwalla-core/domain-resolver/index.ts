/**
 * domain-resolver — native Qwalla name resolution.
 *
 * Roadmap: resolve `name.rouge` domains and the `rouge://` protocol to
 * RougeChain records, with RougeCloud integration. Stubbed for now; hosts fall
 * back to the on-chain name registry (see lib/names.ts → @qwalla/core/rougechain
 * once migrated). Kept host-agnostic so both the mobile app and the browser's
 * Electron protocol handler can share one resolver.
 */

export interface RougeDomainRecord {
  /** The queried name, without the `.rouge` suffix. */
  name: string;
  /** Resolved RougeChain address (rouge1…), or null if unregistered. */
  address: string | null;
}

/** Resolve a `.rouge` name. Not yet implemented — returns null. */
export async function resolveRougeDomain(_name: string): Promise<RougeDomainRecord | null> {
  return null;
}
