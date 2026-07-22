/**
 * dApp provider bridge — generates the injected JS for window.rougechain
 * and processes incoming messages from the WebView.
 */

import type { RefObject } from 'react';
import type WebView from 'react-native-webview';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { createSignedTokenApproval } from '@rougechain/sdk';

import { getActiveNetwork, getActiveNetworkId, rc } from '@/lib/rougechain';
import { isConnected, addConnectedSite } from '@/lib/connected-sites';
import { useWalletStore } from '@/stores/wallet';

function hexToBytes(h: string): Uint8Array {
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return b;
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

function sortKeysDeep(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeysDeep);
  if (obj !== null && typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return obj;
}

export interface DappRequest {
  id: number;
  method:
    | 'connect'
    | 'getBalance'
    | 'getNetwork'
    | 'signTransaction'
    | 'sendTransaction'
    | 'approve'
    | 'swap'
    | 'callContract';
  params?: Record<string, unknown>;
  origin: string;
}

export interface ApprovalRequest {
  id: number;
  type: 'connect' | 'sign' | 'send' | 'approve' | 'swap' | 'contract';
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
      if(msg.type==='rougechain-event'&&msg.event){
        emitLocal(msg.event,msg.data);
      }
    }catch(ex){}
  });

  var listeners={};
  function emitLocal(ev,data){
    var set=listeners[ev];
    if(!set)return;
    set.forEach(function(cb){
      try{cb(data);}catch(ex){}
    });
  }
  var provider={
    isRougeChain:true,
    connect:function(){return sendReq('connect');},
    getBalance:function(){return sendReq('getBalance');},
    getNetwork:function(){return sendReq('getNetwork');},
    signTransaction:function(params){return sendReq('signTransaction',params&&params.payload?params:{payload:params});},
    sendTransaction:function(payload){return sendReq('sendTransaction',{payload:payload});},
    approve:function(params){return sendReq('approve',params);},
    swap:function(params){return sendReq('swap',params);},
    callContract:function(params){return sendReq('callContract',params);},
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

/**
 * Push a provider event (accountsChanged / networkChanged / disconnect)
 * into the page. Wire this through lib/dapp-events' setDappEventSink.
 */
export function sendEventToWebView(
  webViewRef: RefObject<WebView | null>,
  event: string,
  data?: unknown,
) {
  const msg = JSON.stringify({
    source: 'rougechain-native',
    type: 'rougechain-event',
    event,
    data,
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

    case 'getNetwork': {
      const net = getActiveNetwork();
      sendResponseToWebView(webViewRef, request.id, {
        network: net.id,
        label: net.label,
        api: net.api,
      });
      return;
    }

    case 'connect': {
      const connectResult = {
        publicKey: wallet.publicKey,
        network: getActiveNetworkId(),
      };
      const alreadyConnected = await isConnected(request.origin);
      if (alreadyConnected) {
        sendResponseToWebView(webViewRef, request.id, connectResult);
        return;
      }
      showApproval({
        id: request.id,
        type: 'connect',
        origin: request.origin,
        resolve: async (result) => {
          await addConnectedSite(request.origin);
          sendResponseToWebView(webViewRef, request.id, connectResult);
        },
        reject: (err) => {
          sendResponseToWebView(webViewRef, request.id, undefined, err);
        },
      });
      return;
    }

    case 'approve': {
      const spender = String(request.params?.spender || '');
      const tokenSymbol = String(request.params?.token || request.params?.tokenSymbol || 'XRGE');
      const amount = Number(request.params?.amount || 0);
      if (!spender || !(amount > 0)) {
        sendResponseToWebView(webViewRef, request.id, undefined, 'approve requires spender and amount');
        return;
      }
      showApproval({
        id: request.id,
        type: 'approve',
        origin: request.origin,
        payload: { spender, token: tokenSymbol, amount },
        resolve: async () => {
          try {
            const tx = createSignedTokenApproval(wallet, spender, tokenSymbol, amount);
            const res = await rc.submitTx('/v2/token/approve', tx);
            if (!res.success) {
              sendResponseToWebView(webViewRef, request.id, undefined, res.error || 'Approval failed');
            } else {
              sendResponseToWebView(webViewRef, request.id, { success: true, ...res.data });
            }
          } catch (e) {
            sendResponseToWebView(webViewRef, request.id, undefined, 'Approval failed');
          }
        },
        reject: (err) => {
          sendResponseToWebView(webViewRef, request.id, undefined, err);
        },
      });
      return;
    }

    case 'swap': {
      const tokenIn = String(request.params?.tokenIn || '');
      const tokenOut = String(request.params?.tokenOut || '');
      const amountIn = Number(request.params?.amountIn || 0);
      const minAmountOut = Number(request.params?.minAmountOut || 0);
      if (!tokenIn || !tokenOut || !(amountIn > 0)) {
        sendResponseToWebView(webViewRef, request.id, undefined, 'swap requires tokenIn, tokenOut, amountIn');
        return;
      }
      showApproval({
        id: request.id,
        type: 'swap',
        origin: request.origin,
        payload: { tokenIn, tokenOut, amountIn, minAmountOut },
        resolve: async () => {
          try {
            const res = await rc.dex.swap(wallet, { tokenIn, tokenOut, amountIn, minAmountOut });
            if (!res.success) {
              sendResponseToWebView(webViewRef, request.id, undefined, res.error || 'Swap failed');
            } else {
              sendResponseToWebView(webViewRef, request.id, { success: true, ...res.data });
            }
          } catch (e) {
            sendResponseToWebView(webViewRef, request.id, undefined, 'Swap failed');
          }
        },
        reject: (err) => {
          sendResponseToWebView(webViewRef, request.id, undefined, err);
        },
      });
      return;
    }

    case 'callContract': {
      const address = String(request.params?.address || request.params?.contract || '');
      const method = String(request.params?.method || '');
      if (!address || !method) {
        sendResponseToWebView(webViewRef, request.id, undefined, 'callContract requires address and method');
        return;
      }
      showApproval({
        id: request.id,
        type: 'contract',
        origin: request.origin,
        payload: request.params,
        resolve: async () => {
          try {
            const res = await rc.shielded.callContract({
              caller: wallet.publicKey,
              address,
              method,
              args: request.params?.args ?? [],
            });
            sendResponseToWebView(webViewRef, request.id, res);
          } catch (e) {
            sendResponseToWebView(webViewRef, request.id, undefined, 'Contract call failed');
          }
        },
        reject: (err) => {
          sendResponseToWebView(webViewRef, request.id, undefined, err);
        },
      });
      return;
    }

    case 'signTransaction': {
      const payload = request.params?.payload as Record<string, unknown> | undefined;
      const serializedHex = request.params?.serializedHex as string | undefined;
      showApproval({
        id: request.id,
        type: 'sign',
        origin: request.origin,
        payload,
        resolve: async () => {
          try {
            let dataToSign: Uint8Array;
            if (serializedHex) {
              dataToSign = hexToBytes(serializedHex);
            } else {
              const payloadStr = JSON.stringify(sortKeysDeep(payload || {}));
              dataToSign = new TextEncoder().encode(payloadStr);
            }

            const sig = ml_dsa65.sign(dataToSign, hexToBytes(wallet.privateKey));
            sendResponseToWebView(webViewRef, request.id, {
              signature: bytesToHex(sig),
            });
          } catch (e: any) {
            const msg = e?.message || String(e);
            console.error('[Qwalla] signTransaction failed:', msg);
            sendResponseToWebView(webViewRef, request.id, undefined, `Signing failed: ${msg}`);
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
