/**
 * dApp provider bridge — generates the injected JS for window.rougechain
 * and processes incoming messages from the WebView.
 */

import type { RefObject } from 'react';
import type WebView from 'react-native-webview';

import { rc } from '@/lib/rougechain';
import { isConnected, addConnectedSite } from '@/lib/connected-sites';
import { useWalletStore } from '@/stores/wallet';

export interface DappRequest {
  id: number;
  method: 'connect' | 'getBalance' | 'signTransaction' | 'sendTransaction';
  params?: Record<string, unknown>;
  origin: string;
}

export interface ApprovalRequest {
  id: number;
  type: 'connect' | 'sign' | 'send';
  origin: string;
  favicon?: string;
  payload?: Record<string, unknown>;
  resolve: (result: unknown) => void;
  reject: (error: string) => void;
}

export function getInjectedProviderScript(): string {
  return `(function(){
  if(window.rougechain) return;
  var reqId=0;
  var pending={};

  function sendReq(method,params){
    return new Promise(function(resolve,reject){
      var id=++reqId;
      pending[id]={resolve:resolve,reject:reject};
      window.ReactNativeWebView.postMessage(JSON.stringify({
        source:'rougechain-provider',
        type:'rougechain-request',
        id:id,
        method:method,
        params:params||{}
      }));
      setTimeout(function(){
        if(pending[id]){
          delete pending[id];
          reject(new Error('RougeChain: request "'+method+'" timed out'));
        }
      },120000);
    });
  }

  window.addEventListener('message',function(e){
    try{
      var msg=typeof e.data==='string'?JSON.parse(e.data):e.data;
      if(!msg||msg.source!=='rougechain-native')return;
      if(msg.type==='rougechain-response'){
        var p=pending[msg.id];
        if(p){
          delete pending[msg.id];
          if(msg.error) p.reject(new Error(msg.error));
          else p.resolve(msg.result);
        }
      }
    }catch(ex){}
  });

  var listeners={};
  var provider={
    isRougeChain:true,
    connect:function(){return sendReq('connect');},
    getBalance:function(){return sendReq('getBalance');},
    signTransaction:function(payload){return sendReq('signTransaction',{payload:payload});},
    sendTransaction:function(payload){return sendReq('sendTransaction',{payload:payload});},
    on:function(ev,cb){
      if(!listeners[ev])listeners[ev]=new Set();
      listeners[ev].add(cb);
    },
    removeListener:function(ev,cb){
      if(listeners[ev])listeners[ev].delete(cb);
    }
  };

  Object.defineProperty(window,'rougechain',{
    value:Object.freeze(provider),
    writable:false,
    configurable:false
  });
  window.dispatchEvent(new Event('rougechain#initialized'));
})();true;`;
}

export function sendResponseToWebView(
  webViewRef: RefObject<WebView | null>,
  id: number,
  result?: unknown,
  error?: string,
) {
  const msg = JSON.stringify({
    source: 'rougechain-native',
    type: 'rougechain-response',
    id,
    result,
    error,
  });
  webViewRef.current?.injectJavaScript(
    `window.postMessage(${JSON.stringify(msg)},'*');true;`,
  );
}

export async function handleDappRequest(
  request: DappRequest,
  webViewRef: RefObject<WebView | null>,
  showApproval: (req: ApprovalRequest) => void,
): Promise<void> {
  const wallet = useWalletStore.getState().wallet;
  if (!wallet) {
    sendResponseToWebView(webViewRef, request.id, undefined, 'No wallet connected');
    return;
  }

  switch (request.method) {
    case 'getBalance': {
      try {
        const bal = await rc.getBalance(wallet.publicKey);
        sendResponseToWebView(webViewRef, request.id, bal);
      } catch (e) {
        sendResponseToWebView(webViewRef, request.id, undefined, 'Failed to fetch balance');
      }
      return;
    }

    case 'connect': {
      const alreadyConnected = await isConnected(request.origin);
      if (alreadyConnected) {
        sendResponseToWebView(webViewRef, request.id, { publicKey: wallet.publicKey });
        return;
      }
      showApproval({
        id: request.id,
        type: 'connect',
        origin: request.origin,
        resolve: async (result) => {
          await addConnectedSite(request.origin);
          sendResponseToWebView(webViewRef, request.id, { publicKey: wallet.publicKey });
        },
        reject: (err) => {
          sendResponseToWebView(webViewRef, request.id, undefined, err);
        },
      });
      return;
    }

    case 'signTransaction': {
      const payload = request.params?.payload as Record<string, unknown> | undefined;
      showApproval({
        id: request.id,
        type: 'sign',
        origin: request.origin,
        payload,
        resolve: async () => {
          try {
            const { ml_dsa65 } = await import('@noble/post-quantum/ml-dsa.js');
            const hexToBytes = (h: string) => {
              const b = new Uint8Array(h.length / 2);
              for (let i = 0; i < b.length; i++) b[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
              return b;
            };
            const bytesToHex = (b: Uint8Array) =>
              Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');

            const payloadStr = JSON.stringify(payload || {});
            const sig = ml_dsa65.sign(hexToBytes(wallet.privateKey), new TextEncoder().encode(payloadStr));
            sendResponseToWebView(webViewRef, request.id, {
              signature: bytesToHex(sig),
              signedPayload: payloadStr,
            });
          } catch (e) {
            sendResponseToWebView(webViewRef, request.id, undefined, 'Signing failed');
          }
        },
        reject: (err) => {
          sendResponseToWebView(webViewRef, request.id, undefined, err);
        },
      });
      return;
    }

    case 'sendTransaction': {
      const txPayload = request.params?.payload as Record<string, unknown> | undefined;
      showApproval({
        id: request.id,
        type: 'send',
        origin: request.origin,
        payload: txPayload,
        resolve: async () => {
          try {
            const res = await rc.transfer(wallet, {
              to: String(txPayload?.to || ''),
              amount: Number(txPayload?.amount || 0),
              fee: Number(txPayload?.fee || 0.1),
              token: String(txPayload?.token || 'XRGE'),
            });
            if (!res.success) {
              sendResponseToWebView(webViewRef, request.id, undefined, res.error || 'Transaction failed');
            } else {
              sendResponseToWebView(webViewRef, request.id, { txId: (res as any).txId || 'submitted' });
            }
          } catch (e) {
            sendResponseToWebView(webViewRef, request.id, undefined, 'Transaction failed');
          }
        },
        reject: (err) => {
          sendResponseToWebView(webViewRef, request.id, undefined, err);
        },
      });
      return;
    }

    default:
      sendResponseToWebView(webViewRef, request.id, undefined, `Unknown method: ${request.method}`);
  }
}
