/**
 * WalletConnect-style deep link pairing session manager.
 * URI format: qwalla://pair?relay=wss://...&topic=<uuid>&symKey=<hex>
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ApprovalRequest } from '@/lib/dapp-provider';
import { useWalletStore } from '@/stores/wallet';
import { rc } from '@/lib/rougechain';

const SESSIONS_KEY = 'qwalla_dapp_sessions';

export interface PairingParams {
  relay: string;
  topic: string;
  symKey: string;
}

export interface DappSession {
  topic: string;
  relay: string;
  symKey: string;
  peerName?: string;
  connectedAt: number;
}

let activeSockets = new Map<string, WebSocket>();

export function parsePairingUri(uri: string): PairingParams | null {
  try {
    const url = new URL(uri);
    const relay = url.searchParams.get('relay');
    const topic = url.searchParams.get('topic');
    const symKey = url.searchParams.get('symKey');
    if (!relay || !topic || !symKey) return null;
    return { relay, topic, symKey };
  } catch {
    return null;
  }
}

export async function getSessions(): Promise<DappSession[]> {
  try {
    const raw = await AsyncStorage.getItem(SESSIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveSessions(sessions: DappSession[]) {
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

export async function removeSession(topic: string): Promise<void> {
  const ws = activeSockets.get(topic);
  if (ws) {
    ws.close();
    activeSockets.delete(topic);
  }
  const sessions = await getSessions();
  await saveSessions(sessions.filter((s) => s.topic !== topic));
}

export async function clearAllSessions(): Promise<void> {
  activeSockets.forEach((ws) => ws.close());
  activeSockets.clear();
  await AsyncStorage.removeItem(SESSIONS_KEY);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function importKey(symKeyHex: string): Promise<CryptoKey> {
  const raw = hexToBytes(symKeyHex);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encrypt(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(iv.length + cipher.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(cipher), iv.length);
  return bytesToHex(combined);
}

async function decrypt(key: CryptoKey, cipherHex: string): Promise<string> {
  const data = hexToBytes(cipherHex);
  const iv = data.slice(0, 12);
  const cipher = data.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new TextDecoder().decode(plain);
}

export async function startPairingSession(
  params: PairingParams,
  showApproval: (req: ApprovalRequest) => void,
): Promise<boolean> {
  const wallet = useWalletStore.getState().wallet;
  if (!wallet) return false;

  let key: CryptoKey;
  try {
    key = await importKey(params.symKey);
  } catch {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    const ws = new WebSocket(params.relay);
    let resolved = false;

    ws.onopen = async () => {
      activeSockets.set(params.topic, ws);

      const sessions = await getSessions();
      if (!sessions.some((s) => s.topic === params.topic)) {
        sessions.push({
          topic: params.topic,
          relay: params.relay,
          symKey: params.symKey,
          connectedAt: Date.now(),
        });
        await saveSessions(sessions);
      }

      const subscribeMsg = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'subscribe',
        params: { topic: params.topic },
      });
      try {
        const encrypted = await encrypt(key, subscribeMsg);
        ws.send(encrypted);
      } catch {
        ws.send(subscribeMsg);
      }

      if (!resolved) {
        resolved = true;
        resolve(true);
      }
    };

    ws.onmessage = async (event) => {
      try {
        let msgStr: string;
        try {
          msgStr = await decrypt(key, event.data);
        } catch {
          msgStr = event.data;
        }

        const msg = JSON.parse(msgStr);
        if (!msg.method) return;

        const respond = async (id: number, result?: unknown, error?: string) => {
          const resp = JSON.stringify({
            jsonrpc: '2.0',
            id,
            result,
            error: error ? { message: error } : undefined,
          });
          try {
            const enc = await encrypt(key, resp);
            ws.send(enc);
          } catch {
            ws.send(resp);
          }
        };

        switch (msg.method) {
          case 'rougechain_connect':
            showApproval({
              id: msg.id,
              type: 'connect',
              origin: `ws-session:${params.topic.slice(0, 8)}`,
              resolve: async () => {
                await respond(msg.id, { publicKey: wallet.publicKey });
              },
              reject: async (err) => {
                await respond(msg.id, undefined, err);
              },
            });
            break;

          case 'rougechain_signTransaction':
            showApproval({
              id: msg.id,
              type: 'sign',
              origin: `ws-session:${params.topic.slice(0, 8)}`,
              payload: msg.params?.payload,
              resolve: async () => {
                try {
                  const { ml_dsa65 } = await import('@noble/post-quantum/ml-dsa.js');
                  const payload = JSON.stringify(msg.params?.payload || {});
                  const sig = ml_dsa65.sign(
                    hexToBytes(wallet.privateKey),
                    new TextEncoder().encode(payload),
                  );
                  await respond(msg.id, {
                    signature: bytesToHex(sig),
                    signedPayload: payload,
                  });
                } catch {
                  await respond(msg.id, undefined, 'Signing failed');
                }
              },
              reject: async (err) => {
                await respond(msg.id, undefined, err);
              },
            });
            break;

          case 'rougechain_sendTransaction':
            showApproval({
              id: msg.id,
              type: 'send',
              origin: `ws-session:${params.topic.slice(0, 8)}`,
              payload: msg.params?.payload,
              resolve: async () => {
                try {
                  const p = msg.params?.payload || {};
                  const res = await rc.transfer(wallet, {
                    to: String(p.to || ''),
                    amount: Number(p.amount || 0),
                    fee: Number(p.fee || 0.1),
                    token: String(p.token || 'XRGE'),
                  });
                  if (!(res as any).success) {
                    await respond(msg.id, undefined, (res as any).error || 'Transaction failed');
                  } else {
                    await respond(msg.id, { txId: (res as any).txId || 'submitted' });
                  }
                } catch {
                  await respond(msg.id, undefined, 'Transaction failed');
                }
              },
              reject: async (err) => {
                await respond(msg.id, undefined, err);
              },
            });
            break;

          default:
            await respond(msg.id, undefined, `Unknown method: ${msg.method}`);
        }
      } catch {
        /* ignore malformed messages */
      }
    };

    ws.onerror = () => {
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    };

    ws.onclose = () => {
      activeSockets.delete(params.topic);
    };

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    }, 15000);
  });
}
