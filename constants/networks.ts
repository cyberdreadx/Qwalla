/**
 * RougeChain network definitions — mainnet / testnet / devnet.
 * See https://docs.rougechain.io for endpoint documentation.
 */

export type NetworkId = 'mainnet' | 'testnet' | 'devnet';

export interface NetworkConfig {
  id: NetworkId;
  /** Short label shown in pills/switchers */
  label: string;
  /** Longer human description shown in Settings */
  description: string;
  /** REST API base, no trailing slash */
  api: string;
  /** WebSocket endpoint for real-time tx/block events */
  ws: string;
  /** STARK prover page for shielded unshield proofs */
  prover: string;
  /** Whether the faucet exists on this network */
  faucet: boolean;
  /** Pill tint — keep it obvious which chain you're on */
  color: string;
}

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  mainnet: {
    id: 'mainnet',
    label: 'Mainnet',
    description: 'RougeChain production network (rougechain-mainnet-1). Real value — no faucet.',
    api: 'https://api.rougechain.io/api',
    ws: 'wss://api.rougechain.io/api/ws',
    prover: 'https://rougechain.io/prover.html',
    faucet: false,
    color: '#2EE6A8',
  },
  testnet: {
    id: 'testnet',
    label: 'Testnet',
    description: 'Public test network with faucet. Tokens have no value.',
    api: 'https://testnet.rougechain.io/api',
    ws: 'wss://testnet.rougechain.io/api/ws',
    prover: 'https://rougechain.io/prover.html',
    faucet: true,
    color: '#FDCB6E',
  },
  devnet: {
    id: 'devnet',
    label: 'Devnet',
    description: 'Local node at 127.0.0.1:5100 — for development only.',
    api: 'http://127.0.0.1:5100/api',
    ws: 'ws://127.0.0.1:5100/api/ws',
    prover: 'https://rougechain.io/prover.html',
    faucet: true,
    color: '#6C5CE7',
  },
};

/**
 * Networks the user is allowed to select. Devnet points at a cleartext
 * localhost node and only works with a dev node running, so it's hidden in
 * production/release builds — otherwise App Review testers (and users) can
 * land on a dead, non-functional network.
 */
export const NETWORK_IDS: NetworkId[] = __DEV__
  ? ['mainnet', 'testnet', 'devnet']
  : ['mainnet', 'testnet'];

/** Production default. A persisted user choice always overrides this. */
export const DEFAULT_NETWORK: NetworkId = 'mainnet';

export function isNetworkId(v: unknown): v is NetworkId {
  return v === 'mainnet' || v === 'testnet' || v === 'devnet';
}

/** Whether a network id is user-selectable in the current build. */
export function isSelectableNetwork(v: unknown): v is NetworkId {
  return isNetworkId(v) && NETWORK_IDS.includes(v);
}
