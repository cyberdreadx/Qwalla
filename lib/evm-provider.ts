/**
 * window.ethereum (EIP-1193) provider for the in-app browser, so EVM dApps —
 * notably rougechain.io/bridge — can drive the Base side using Qwalla's own
 * key (derived from the wallet's seed). Read RPC is proxied to Base; the two
 * signing methods (personal_sign, eth_sendTransaction) require approval.
 *
 * Messages use a distinct bus (`qwalla-evm` / `qwalla-evm-native`) so they never
 * collide with the RougeChain provider (`rougechain-provider`).
 */
import type { RefObject } from 'react';
import type WebView from 'react-native-webview';

import { deriveEvmAccount, personalSign, type EvmAccount } from '@/lib/evm-wallet';
import { EVM_CHAINS, getChain, rpc, fillSignAndSend, type EvmTxRequest } from '@/lib/evm-rpc';
import type { ApprovalRequest } from '@/lib/dapp-provider';
import { useWalletStore } from '@/stores/wallet';

export interface EvmRequest {
  id: number;
  method: string;
  params: unknown[];
  origin: string;
}

const DEFAULT_CHAIN_ID = 8453; // Base mainnet

// Read-only methods safe to proxy straight to the Base RPC endpoint.
const READ_METHODS = new Set([
  'eth_getBalance',
  'eth_call',
  'eth_estimateGas',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_blockNumber',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getLogs',
]);

// ── Session state (module-level; reset on wallet change) ────────────────────
let currentChainId = DEFAULT_CHAIN_ID;
const connectedOrigins = new Set<string>();
let cachedAccount: EvmAccount | null = null;
let cachedMnemonic: string | null = null;

function getAccount(): EvmAccount | null {
  const mnemonic = useWalletStore.getState().mnemonic;
  if (!mnemonic) {
    cachedAccount = null;
    cachedMnemonic = null;
    return null;
  }
  if (cachedAccount && cachedMnemonic === mnemonic) return cachedAccount;
  cachedAccount = deriveEvmAccount(mnemonic);
  cachedMnemonic = mnemonic;
  return cachedAccount;
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Best-effort UTF-8 preview of a personal_sign payload for the approval sheet. */
function decodeMessagePreview(raw: string): string {
  if (typeof raw !== 'string') return String(raw);
  if (!raw.startsWith('0x')) return raw; // already plain text
  try {
    const text = new TextDecoder().decode(hexToBytes(raw));
    // If it decodes to mostly printable text, show it; else show the hex.
    return /[^\x09\x0a\x0d\x20-\x7e]/.test(text) ? raw : text;
  } catch {
    return raw;
  }
}

// ── Messaging ───────────────────────────────────────────────────────────────
export function sendEvmResponse(
  webViewRef: RefObject<WebView | null>,
  id: number,
  result?: unknown,
  error?: { code: number; message: string },
) {
  const msg = JSON.stringify({ source: 'qwalla-evm-native', id, result, error });
  webViewRef.current?.injectJavaScript(`window.postMessage(${JSON.stringify(msg)},'*');true;`);
}

export function sendEvmEvent(webViewRef: RefObject<WebView | null>, event: string, data?: unknown) {
  const msg = JSON.stringify({ source: 'qwalla-evm-native', event, data });
  webViewRef.current?.injectJavaScript(`window.postMessage(${JSON.stringify(msg)},'*');true;`);
}

function ok(webViewRef: RefObject<WebView | null>, id: number, result: unknown) {
  sendEvmResponse(webViewRef, id, result);
}
function fail(webViewRef: RefObject<WebView | null>, id: number, code: number, message: string) {
  sendEvmResponse(webViewRef, id, undefined, { code, message });
}

// ── Request handler ─────────────────────────────────────────────────────────
export async function handleEvmRequest(
  req: EvmRequest,
  webViewRef: RefObject<WebView | null>,
  showApproval: (r: ApprovalRequest) => void,
): Promise<void> {
  const { id, method, params, origin } = req;
  const chain = getChain(currentChainId) ?? EVM_CHAINS[DEFAULT_CHAIN_ID];

  try {
    switch (method) {
      case 'eth_chainId':
        return ok(webViewRef, id, '0x' + currentChainId.toString(16));
      case 'net_version':
        return ok(webViewRef, id, String(currentChainId));

      case 'eth_accounts': {
        const acct = getAccount();
        return ok(webViewRef, id, acct && connectedOrigins.has(origin) ? [acct.address] : []);
      }

      case 'eth_requestAccounts': {
        const acct = getAccount();
        if (!acct) {
          return fail(webViewRef, id, 4100, 'No EVM account — this wallet was imported without a seed phrase.');
        }
        if (connectedOrigins.has(origin)) return ok(webViewRef, id, [acct.address]);
        return showApproval({
          id,
          type: 'connect',
          origin,
          payload: { evm: true, address: acct.address, chain: chain.name },
          resolve: () => {
            connectedOrigins.add(origin);
            ok(webViewRef, id, [acct.address]);
            sendEvmEvent(webViewRef, 'accountsChanged', [acct.address]);
            sendEvmEvent(webViewRef, 'connect', { chainId: '0x' + currentChainId.toString(16) });
          },
          reject: () => fail(webViewRef, id, 4001, 'User rejected the request'),
        });
      }

      case 'wallet_switchEthereumChain': {
        const target = Number((params?.[0] as { chainId?: string })?.chainId ?? '0x0');
        if (!EVM_CHAINS[target]) {
          return fail(webViewRef, id, 4902, 'Unrecognized chain — add it first');
        }
        currentChainId = target;
        sendEvmEvent(webViewRef, 'chainChanged', '0x' + target.toString(16));
        return ok(webViewRef, id, null);
      }

      case 'wallet_addEthereumChain': {
        const target = Number((params?.[0] as { chainId?: string })?.chainId ?? '0x0');
        if (!EVM_CHAINS[target]) {
          return fail(webViewRef, id, 4901, 'Only Base and Base Sepolia are supported');
        }
        currentChainId = target;
        sendEvmEvent(webViewRef, 'chainChanged', '0x' + target.toString(16));
        return ok(webViewRef, id, null);
      }

      case 'personal_sign': {
        const acct = getAccount();
        if (!acct) return fail(webViewRef, id, 4100, 'No EVM account available');
        const rawMessage = String(params?.[0] ?? '');
        return showApproval({
          id,
          type: 'sign',
          origin,
          payload: { evm: true, kind: 'personal_sign', message: decodeMessagePreview(rawMessage), address: acct.address },
          resolve: () => {
            try {
              const bytes = rawMessage.startsWith('0x') ? hexToBytes(rawMessage) : rawMessage;
              ok(webViewRef, id, personalSign(acct.privateKeyHex, bytes));
            } catch (e) {
              fail(webViewRef, id, -32603, e instanceof Error ? e.message : 'Signing failed');
            }
          },
          reject: () => fail(webViewRef, id, 4001, 'User rejected the request'),
        });
      }

      case 'eth_sendTransaction': {
        const acct = getAccount();
        if (!acct) return fail(webViewRef, id, 4100, 'No EVM account available');
        const tx = (params?.[0] ?? {}) as EvmTxRequest;
        if (!tx.to) return fail(webViewRef, id, -32602, 'Missing "to" address');
        return showApproval({
          id,
          type: 'send',
          origin,
          payload: {
            evm: true,
            kind: 'sendTransaction',
            to: tx.to,
            value: tx.value ?? '0x0',
            data: tx.data ?? '0x',
            chain: chain.name,
          },
          resolve: async () => {
            try {
              const hash = await fillSignAndSend(chain, acct, tx);
              ok(webViewRef, id, hash);
            } catch (e) {
              fail(webViewRef, id, -32603, e instanceof Error ? e.message : 'Transaction failed');
            }
          },
          reject: () => fail(webViewRef, id, 4001, 'User rejected the request'),
        });
      }

      // eth_sign / signTypedData are intentionally unsupported for now — the
      // bridge only needs personal_sign, and eth_sign is unsafe (blind signing).
      case 'eth_sign':
      case 'eth_signTypedData':
      case 'eth_signTypedData_v3':
      case 'eth_signTypedData_v4':
        return fail(webViewRef, id, 4200, `${method} is not supported yet`);

      default: {
        if (READ_METHODS.has(method)) {
          const result = await rpc(chain.rpcUrl, method, params ?? []);
          return ok(webViewRef, id, result);
        }
        return fail(webViewRef, id, 4200, `Unsupported method: ${method}`);
      }
    }
  } catch (e) {
    return fail(webViewRef, id, -32603, e instanceof Error ? e.message : 'Internal error');
  }
}

/** Reset EVM session state (call on wallet change / logout). */
export function resetEvmSession() {
  connectedOrigins.clear();
  cachedAccount = null;
  cachedMnemonic = null;
  currentChainId = DEFAULT_CHAIN_ID;
}

// ── Injected window.ethereum (EIP-1193) ──────────────────────────────────────
export function getInjectedEthereumScript(): string {
  return `(function(){
  if(window.ethereum && window.ethereum.isQwalla) return;
  var reqId=0, pending={}, listeners={};
  function rpc(method, params){
    return new Promise(function(resolve,reject){
      var id=++reqId; pending[id]={resolve:resolve,reject:reject};
      window.ReactNativeWebView.postMessage(JSON.stringify({source:'qwalla-evm',id:id,method:method,params:params||[]}));
      setTimeout(function(){ if(pending[id]){ delete pending[id]; reject({code:4900,message:'Qwalla: request timed out'}); } },180000);
    });
  }
  function emit(ev,data){ (listeners[ev]||[]).forEach(function(cb){ try{cb(data);}catch(e){} }); }
  window.addEventListener('message', function(e){
    try{
      var msg=typeof e.data==='string'?JSON.parse(e.data):e.data;
      if(!msg || msg.source!=='qwalla-evm-native') return;
      if(msg.id && pending[msg.id]){
        var p=pending[msg.id]; delete pending[msg.id];
        if(msg.error) p.reject(msg.error); else p.resolve(msg.result);
      }
      if(msg.event){
        if(msg.event==='chainChanged') eth.chainId=msg.data;
        if(msg.event==='accountsChanged') eth.selectedAddress=(msg.data&&msg.data[0])||null;
        emit(msg.event,msg.data);
      }
    }catch(ex){}
  });
  var eth={
    isMetaMask:true, isQwalla:true,
    chainId:'0x2105', networkVersion:'8453', selectedAddress:null,
    request:function(args){ return rpc(args&&args.method, args&&args.params); },
    enable:function(){ return rpc('eth_requestAccounts',[]); },
    send:function(m,p){ if(typeof m==='string') return rpc(m,p||[]); return rpc(m.method,m.params||[]); },
    sendAsync:function(payload,cb){ rpc(payload.method,payload.params||[]).then(function(r){cb(null,{id:payload.id,jsonrpc:'2.0',result:r});}).catch(function(err){cb(err,null);}); },
    on:function(ev,cb){ (listeners[ev]=listeners[ev]||[]).push(cb); return eth; },
    removeListener:function(ev,cb){ listeners[ev]=(listeners[ev]||[]).filter(function(x){return x!==cb;}); return eth; }
  };
  Object.defineProperty(window,'ethereum',{value:eth,writable:false,configurable:true});
  window.dispatchEvent(new Event('ethereum#initialized'));
})();true;`;
}
