/**
 * IPFS gateway helpers for NFT / token images.
 *
 * A single gateway (ipfs.io) is frequently slow or unreachable — especially on
 * weak signal — which left NFT images blank. imageUriCandidates() turns an
 * ipfs:// (or an existing /ipfs/ gateway URL) into one URL per gateway so a
 * loader can fall through to the next when one fails; a plain http(s) URL is
 * returned unchanged.
 */

export const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://dweb.link/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];

/** The CID + path of an ipfs:// uri or an existing /ipfs/ gateway URL, else null. */
function ipfsCidPath(uri: string): string | null {
  if (uri.startsWith('ipfs://')) return uri.slice('ipfs://'.length).replace(/^ipfs\//, '');
  const m = uri.match(/\/ipfs\/(.+)$/);
  return m ? m[1] : null;
}

/**
 * Candidate URLs for an image uri, in fallback order. For IPFS content that's
 * one URL per gateway; for a plain http(s) uri it's just that URL.
 */
export function imageUriCandidates(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const uri = raw.trim();
  if (!uri) return [];
  const cidPath = ipfsCidPath(uri);
  if (cidPath) return IPFS_GATEWAYS.map((g) => g + cidPath);
  return [uri];
}

/** The first candidate for a uri (e.g. to fetch NFT metadata JSON). */
export function resolveIpfs(raw: string | undefined | null): string | null {
  return imageUriCandidates(raw)[0] ?? null;
}
