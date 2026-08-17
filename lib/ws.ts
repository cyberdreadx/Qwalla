import { AppState, Platform, type AppStateStatus } from 'react-native';

import { getActiveNetwork } from '@/lib/rougechain';

export type WsEvent = {
  type: string;
  tx?: {
    hash?: string;
    from?: string;
    to?: string;
    amount?: number;
    fee?: number;
    token?: string;
    tx_type?: string;
  };
  block?: { height?: number; tx_count?: number };
  // messenger `new_message` events — routing hints only, content stays encrypted
  conversation_id?: string;
  sender_wallet_id?: string;
  participant_ids?: string[];
  [key: string]: unknown;
};

type Listener = (event: WsEvent) => void;

const RECONNECT_BASE_MS = 5000;
const RECONNECT_MAX_MS = 60000;
const HEARTBEAT_MS = 30000;
const MAX_CONSECUTIVE_FAILURES = 5;

class RougeChainWs {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private attempt = 0;
  private consecutiveFailures = 0;
  private active = false;
  private suspended = false;
  private appState: AppStateStatus = 'active';
  private appStateSub: { remove(): void } | null = null;

  connect() {
    if (this.active) return;
    this.active = true;
    this.suspended = false;
    this.consecutiveFailures = 0;
    this.appStateSub = AppState.addEventListener('change', this.onAppState);
    this.open();
  }

  disconnect() {
    this.active = false;
    this.suspended = false;
    this.appStateSub?.remove();
    this.appStateSub = null;
    this.clearTimers();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Reconnect against the currently-active network's WS endpoint.
   * Safe to call when not connected (no-op until connect()).
   */
  retarget() {
    if (!this.active) return;
    this.suspended = false;
    this.consecutiveFailures = 0;
    this.reconnectNow();
  }

  private onAppState = (next: AppStateStatus) => {
    const prev = this.appState;
    this.appState = next;
    if (prev.match(/inactive|background/) && next === 'active' && this.active) {
      this.suspended = false;
      this.consecutiveFailures = 0;
      this.attempt = 0;
      this.reconnectNow();
    }
  };

  private open() {
    if (this.suspended) return;
    this.clearTimers();

    if (Platform.OS === 'web' && typeof WebSocket === 'undefined') {
      this.goSuspend();
      return;
    }

    try {
      this.ws = new WebSocket(getActiveNetwork().ws);
    } catch {
      this.onFailure();
      return;
    }

    this.ws.onopen = () => {
      this.attempt = 0;
      this.consecutiveFailures = 0;
      this.startHeartbeat();
    };

    this.ws.onmessage = (e) => {
      try {
        const data: WsEvent = JSON.parse(e.data as string);
        for (const fn of this.listeners) fn(data);
      } catch { /* malformed frame */ }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.onFailure();
    };

    this.ws.onerror = () => {
      /* onclose will fire after onerror — handle reconnect there */
    };
  }

  private onFailure() {
    if (!this.active || this.suspended) return;
    this.consecutiveFailures++;

    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.goSuspend();
      return;
    }

    this.scheduleReconnect();
  }

  private goSuspend() {
    this.suspended = true;
    this.clearTimers();
    if (__DEV__) {
      console.log('[WS] Suspended — server unreachable. Will retry when app resumes.');
    }
  }

  private reconnectNow() {
    this.clearTimers();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.attempt = 0;
    this.open();
  }

  private scheduleReconnect() {
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.attempt, RECONNECT_MAX_MS);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('ping');
      }
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
  }
}

export const rougeWs = new RougeChainWs();
