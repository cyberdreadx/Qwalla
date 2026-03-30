import { useRef, useCallback, useState } from 'react';
import WebView from 'react-native-webview';

const PROVER_URL = 'https://rougechain.io/prover.html';

type PendingRequest = {
  resolve: (proof: string) => void;
  reject: (err: Error) => void;
};

let requestId = 0;
const pending = new Map<string, PendingRequest>();

export function useStarkProver() {
  const webViewRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);

  const onMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.ready) {
        setReady(true);
        return;
      }
      const req = pending.get(msg.id);
      if (!req) return;
      pending.delete(msg.id);
      if (msg.error) {
        req.reject(new Error(msg.error));
      } else {
        req.resolve(msg.proof);
      }
    } catch { /* ignore malformed messages */ }
  }, []);

  const proveUnshield = useCallback(
    (amount: number, fee = 1): Promise<string> => {
      return new Promise((resolve, reject) => {
        if (!webViewRef.current) {
          reject(new Error('Prover WebView not mounted'));
          return;
        }
        const id = `p${++requestId}`;
        pending.set(id, { resolve, reject });
        const msg = JSON.stringify({ id, amount, fee });
        webViewRef.current.injectJavaScript(
          `window.postMessage(${JSON.stringify(msg)}, '*'); true;`
        );
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error('STARK proof generation timed out'));
          }
        }, 30_000);
      });
    },
    []
  );

  return { webViewRef, onMessage, proveUnshield, ready, proverUrl: PROVER_URL };
}
