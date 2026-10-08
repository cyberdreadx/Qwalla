import { RougeChain } from '@rougechain/sdk';

import { DEFAULT_NETWORK, NETWORKS, type NetworkConfig, type NetworkId } from '@/constants/networks';
import { chainCheckedFetch, verifyChainId } from '@/lib/chain-id';

/**
 * Network-aware RougeChain client.
 *
 * `rc` is a stable Proxy that always delegates to the client for the
 * currently-selected network, so every existing `rc.xyz()` call site keeps
 * working across mainnet/testnet/devnet switches with no re-imports.
 */

/**
 * Client for one network. `chainId` makes the SDK put the network's chain id into every payload it
 * signs (@rougechain/sdk >= 1.15.0); the fetch refuses writes once the node is found to report a
 * different chain id (lib/chain-id). The session cross-check starts as soon as the client exists.
 */
function makeClient(id: NetworkId): RougeChain {
  verifyChainId(id).catch(() => {
    /* recorded; every later signature / write on this network is refused */
  });
  return new RougeChain(NETWORKS[id].api, {
    chainId: NETWORKS[id].chainId ?? undefined,
    fetch: chainCheckedFetch(id),
  });
}

let activeId: NetworkId = DEFAULT_NETWORK;
let client = makeClient(activeId);

type NetworkListener = (id: NetworkId) => void;
const listeners = new Set<NetworkListener>();

export function getActiveNetworkId(): NetworkId {
  return activeId;
}

export function getActiveNetwork(): NetworkConfig {
  return NETWORKS[activeId];
}

/**
 * Swap the underlying client to a different network.
 * Called by the network store — use that (useNetworkStore) from UI code.
 */
export function setActiveNetwork(id: NetworkId): void {
  if (id === activeId) return;
  activeId = id;
  client = makeClient(id);
  for (const fn of listeners) {
    try {
      fn(id);
    } catch {
      /* listener errors must not break the switch */
    }
  }
}

/** Subscribe to network switches (used by ws, dapp bridge). Returns unsubscribe. */
export function onNetworkChange(fn: NetworkListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const rc: RougeChain = new Proxy({} as RougeChain, {
  get(_target, prop) {
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(client);
    }
    return value;
  },
});
