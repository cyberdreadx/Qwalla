import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import {
  DEFAULT_NETWORK,
  NETWORKS,
  isSelectableNetwork,
  type NetworkConfig,
  type NetworkId,
} from '@/constants/networks';
import { emitDappEvent } from '@/lib/dapp-events';
import { getActiveNetworkId, setActiveNetwork } from '@/lib/rougechain';
import { rougeWs } from '@/lib/ws';

const STORAGE_KEY = 'qwalla_network_v1';

type NetworkState = {
  /** True once the persisted choice has been loaded */
  hydrated: boolean;
  networkId: NetworkId;
  network: NetworkConfig;
  hydrate: () => Promise<void>;
  switchNetwork: (id: NetworkId) => Promise<void>;
};

export const useNetworkStore = create<NetworkState>((set) => ({
  hydrated: false,
  networkId: getActiveNetworkId(),
  network: NETWORKS[getActiveNetworkId()],

  hydrate: async () => {
    let id: NetworkId = DEFAULT_NETWORK;
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      // Only restore a network that's selectable in this build — a persisted
      // 'devnet' choice must not come back in a production build.
      if (isSelectableNetwork(stored)) id = stored;
    } catch {
      /* fall back to default */
    }
    setActiveNetwork(id);
    rougeWs.retarget();
    set({ hydrated: true, networkId: id, network: NETWORKS[id] });
  },

  switchNetwork: async (id: NetworkId) => {
    if (!isSelectableNetwork(id)) return;
    setActiveNetwork(id);
    rougeWs.retarget();
    set({ networkId: id, network: NETWORKS[id] });
    emitDappEvent('networkChanged', { network: id, api: NETWORKS[id].api });
    try {
      await AsyncStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* non-fatal — choice just won't persist */
    }
  },
}));
