import React, { useEffect, useRef, useState } from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';

import { imageUriCandidates } from '@/lib/ipfs';

interface Props {
  uri?: string | null;
  style?: StyleProp<ImageStyle>;
  /** Shown when there's no uri or every candidate failed/timed out. */
  fallback?: React.ReactElement | null;
  /** Per-gateway load timeout before trying the next candidate (ms). */
  timeoutMs?: number;
}

/**
 * An Image for remote (often IPFS) content that heals on weak signal: it
 * resolves ipfs:// to several gateways and, on an error OR a load that stalls
 * past `timeoutMs`, advances to the next gateway — finally rendering `fallback`
 * when all candidates are exhausted. Drop-in for NFT/token artwork.
 */
export default function RemoteImage({ uri, style, fallback = null, timeoutMs = 8000 }: Props) {
  const candidates = React.useMemo(() => imageUriCandidates(uri), [uri]);
  const [idx, setIdx] = useState(0);
  const loadedRef = useRef(false);

  useEffect(() => {
    setIdx(0);
  }, [uri]);

  const current = candidates[idx];

  // Advance to the next gateway if this one hasn't loaded within the timeout
  // (a stalled gateway otherwise hangs forever without firing onError).
  useEffect(() => {
    if (!current) return;
    loadedRef.current = false;
    const t = setTimeout(() => {
      if (!loadedRef.current) setIdx((i) => i + 1);
    }, timeoutMs);
    return () => clearTimeout(t);
  }, [current, timeoutMs]);

  if (!current) return fallback;

  return (
    <Image
      source={{ uri: current }}
      style={style}
      onLoad={() => {
        loadedRef.current = true;
      }}
      onError={() => setIdx((i) => i + 1)}
    />
  );
}
