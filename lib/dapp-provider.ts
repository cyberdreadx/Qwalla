/**
 * dApp provider bridge — generates the injected JS for window.rougechain
 * and processes incoming messages from the WebView.
 */

import type { RefObject } from 'react';
import type WebView from 'react-native-webview';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { createSignedTokenApproval } from '@rougechain/sdk';

import { NETWORKS } from '@/constants/networks';
import { getActiveNetwork, getActiveNetworkId, rc } from '@/lib/rougechain';
import { isConnected, addConnectedSite } from '@qwalla/core/provider-bridge';
import { ensureDecryptPermission } from '@/lib/decrypt-permission';
import { nativePubkeyToAddress } from '@qwalla/core/wallet/address';
import { reviewSignMessageRequest, signMessage, type SignMessageReview } from '@/lib/sign-message';
import { authorizeSignTransaction } from '@/lib/sign-transaction-request';
import {
  authorizeCallContract,
  signedCallBody,
  type BalanceLike,
  type CallContractRequest,
  type ContractCallReview,
} from '@/lib/contract-call-request';
import { bindWallet, checkDappChainId, verifyChainId } from '@/lib/chain-id';
import { deriveRougeeKem, decryptRougeeEnvelope, decryptMessage } from '@qwalla/core/pq';
import { useWalletStore } from '@/stores/wallet';

function hexToBytes(h: string): Uint8Array {
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return b;
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

export interface DappRequest {
  id: number;
  method:
    | 'connect'
    | 'getBalance'
    | 'getNetwork'
    | 'signTransaction'
    | 'signMessage'
    | 'sendTransaction'
    | 'approve'
    | 'swap'
    | 'callContract'
    | 'getEncryptionPublicKey'
    | 'decrypt';
  params?: Record<string, unknown>;
  origin: string;
}

export interface ApprovalRequest {
  id: number;
  type: 'connect' | 'sign' | 'message' | 'send' | 'approve' | 'swap' | 'contract' | 'decrypt';
  origin: string;
  favicon?: string;
  payload?: Record<string, unknown>;
  /** type 'sign' (RougeChain signTransaction): the exact JSON text that is signed. */
  signedText?: string;
  /**
   * type 'sign' (RougeChain signTransaction): the network the payload is signed for (from its
   * `chainId`), and whether it names none (older dApps — shown with a warning).
   */
  signNetwork?: { name: string; missingChainId: boolean };
  /** type 'message' (signMessage): what the approval sheet shows — see lib/sign-message. */
  messageReview?: SignMessageReview;
  /** type 'contract' (callContract): payment, contract, method, fee — see lib/contract-call-request. */
  contractReview?: ContractCallReview;
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
    capabilities:Object.freeze({signMessage:true,payableCalls:true}),
    connect:function(){return sendReq('connect');},
    getBalance:function(){return sendReq('getBalance');},
    getNetwork:function(){return sendReq('getNetwork');},
    signTransaction:function(params){return sendReq('signTransaction',params&&params.payload?params:{payload:params});},
    signMessage:function(params){return sendReq('signMessage',{message:params&&params.message});},
    sendTransaction:function(payload){return sendReq('sendTransaction',{payload:payload});},
    approve:function(params){return sendReq('approve',params);},
    swap:function(params){return sendReq('swap',params);},
    callContract:function(params){return sendReq('callContract',params);},
    getEncryptionPublicKey:function(){return sendReq('getEncryptionPublicKey');},
    decrypt:function(params){return sendReq('decrypt',params);},
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

/** The node's `{"error": "..."}` out of an SDK `POST … failed: 400 … {json}` message. */
function nodeError(err: string | undefined): string | undefined {
  if (!err) return err;
  const i = err.indexOf('{');
  if (i >= 0) {
    try {
      const j = JSON.parse(err.slice(i));
      if (j && typeof j.error === 'string') return j.error;
    } catch {
      /* not JSON */
    }
  }
  return err;
}

/** Read-only dry run of a call (free, nothing signed) — the gas used, or why it would fail. */
async function dryRunContractCall(
  req: CallContractRequest,
  caller: string,
): Promise<{ gasUsed: number } | { error: string }> {
  const body: Record<string, unknown> = { method: req.method, args: req.args, caller };
  if (req.attach) body.attach = req.attach;
  try {
    const r = await rc.post<{ success?: boolean; gasUsed?: number; error?: string | null }>(
      `/contract/${encodeURIComponent(req.contractAddr)}/query`,
      body,
    );
    if (r?.success !== true) return { error: r?.error || 'the dry run failed' };
    return { gasUsed: Number(r.gasUsed ?? 0) };
  } catch (e: any) {
    return { error: nodeError(e?.message || String(e)) || 'the dry run failed' };
  }
}

/**
 * callContract (and an extension-style sendTransaction with a `contract_call` payload): a
 * player-signed `contract_call` (POST /api/v2/contract/execute), optionally PAYABLE. Connected
 * origin only; the balance is checked before the sheet opens; the signed bytes are the canonical
 * encoding of the payload the sheet shows (lib/contract-call-request). The payload carries the
 * selected network's `chainId` (cross-checked with its node); a dApp `chainId` for another
 * network is refused, none is shown with a warning — the same gate as signTransaction.
 */
async function handleCallContract(
  request: DappRequest,
  params: unknown,
  wallet: { publicKey: string; privateKey: string },
  webViewRef: RefObject<WebView | null>,
  showApproval: (req: ApprovalRequest) => void,
): Promise<void> {
  const network = getActiveNetworkId();
  const prepared = await authorizeCallContract(params, request.origin, wallet.publicKey, {
    isConnected,
    getBalance: async (pk) => (await rc.getBalance(pk)) as BalanceLike,
    estimateGas: dryRunContractCall,
    network: async () => ({ name: `RougeChain ${NETWORKS[network].label}`, chainId: await verifyChainId(network) }),
  });
  if ('error' in prepared) {
    sendResponseToWebView(webViewRef, request.id, undefined, prepared.error);
    return;
  }
  showApproval({
    id: request.id,
    type: 'contract',
    origin: request.origin,
    payload: prepared.payload,
    signedText: prepared.signedText,
    contractReview: prepared.review,
    resolve: async () => {
      // The payload names the network it was prepared on; the network may have been switched
      // while the sheet was open.
      if (getActiveNetworkId() !== network) {
        sendResponseToWebView(webViewRef, request.id, undefined, 'Network changed. Please try again.');
        return;
      }
      try {
        const sig = ml_dsa65.sign(prepared.bytes, hexToBytes(wallet.privateKey));
        const body = signedCallBody(prepared, bytesToHex(sig), wallet.publicKey);
        const res = await rc.submitTx('/v2/contract/execute', body);
        if (!res.success) {
          sendResponseToWebView(webViewRef, request.id, undefined, nodeError(res.error) || 'Contract call failed');
          return;
        }
        const data = (res.data ?? {}) as Record<string, unknown>;
        // `attach` echoes what was signed (null = none), so a site can confirm the payment was
        // honoured — older Qwalla builds ignored it and returned no `attach` field.
        sendResponseToWebView(webViewRef, request.id, {
          success: true,
          txId: data.txId,
          fee: data.fee,
          gasLimit: prepared.review.gasLimit,
          attach: prepared.payload.attach ?? null,
          // The network the signature is valid on (null only on an unreached local devnet).
          chainId: prepared.review.network.chainId,
          preview: data.preview,
        });
      } catch (e: any) {
        const msg = e?.message || String(e);
        sendResponseToWebView(webViewRef, request.id, undefined, `Contract call failed: ${msg}`);
      }
    },
    reject: (err) => {
      sendResponseToWebView(webViewRef, request.id, undefined, err);
    },
  });
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
        // The chain id to put into signed payloads as `chainId` (null on a local devnet).
        chainId: net.chainId,
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
            // Signed for the selected network only: the wallet is bound to its chain id.
            const chainId = await verifyChainId(getActiveNetworkId());
            const tx = createSignedTokenApproval(bindWallet(wallet, chainId), spender, tokenSymbol, amount);
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

    // The dApp may attach `{ symbol, amount }` (integer quanta for XRGE, raw units for a token) —
    // the same fields as rougechain.io, the extension and @rougechain/sdk.
    case 'callContract': {
      await handleCallContract(request, request.params, wallet, webViewRef, showApproval);
      return;
    }

    case 'signTransaction': {
      // Connected origin only, and the signed bytes are always the canonical encoding of the
      // payload the sheet shows (see lib/sign-transaction-request).
      const prepared = await authorizeSignTransaction(request.params, request.origin, isConnected);
      if ('error' in prepared) {
        sendResponseToWebView(webViewRef, request.id, undefined, prepared.error);
        return;
      }
      // Network gate: the payload's chainId must be the selected network's (cross-checked with
      // its node once per session). A payload without chainId is shown with a warning.
      const network = getActiveNetworkId();
      try {
        await verifyChainId(network);
      } catch (e: any) {
        sendResponseToWebView(webViewRef, request.id, undefined, e?.message || String(e));
        return;
      }
      const chain = checkDappChainId(prepared.payload, network);
      if (!chain.ok) {
        sendResponseToWebView(webViewRef, request.id, undefined, chain.error);
        return;
      }
      showApproval({
        id: request.id,
        type: 'sign',
        origin: request.origin,
        payload: prepared.payload,
        signedText: prepared.signedText,
        signNetwork: { name: chain.networkName, missingChainId: chain.status === 'missing' },
        resolve: async () => {
          try {
            // The network may have been switched while the sheet was open.
            if (getActiveNetworkId() !== network) {
              sendResponseToWebView(webViewRef, request.id, undefined, 'Network changed. Please try again.');
              return;
            }
            const sig = ml_dsa65.sign(prepared.bytes, hexToBytes(wallet.privateKey));
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

    // Prove control of the wallet by signing a text message (login, token gating). The signed
    // bytes carry the "\x19RougeChain Signed Message:\n" prefix (lib/sign-message), which the
    // chain can never accept as a transaction. The site must be connected and the user is asked
    // EVERY time — there is no remembered approval for this method.
    case 'signMessage': {
      if (!(await isConnected(request.origin))) {
        sendResponseToWebView(webViewRef, request.id, undefined, 'Site not connected. Call connect() first.');
        return;
      }
      const address = nativePubkeyToAddress(wallet.publicKey);
      const review = reviewSignMessageRequest(request.params?.message, request.origin, address);
      if ('error' in review) {
        sendResponseToWebView(webViewRef, request.id, undefined, review.error);
        return;
      }
      showApproval({
        id: request.id,
        type: 'message',
        origin: request.origin,
        messageReview: review,
        resolve: async () => {
          try {
            sendResponseToWebView(webViewRef, request.id, {
              signature: signMessage(wallet.privateKey, review.message),
              publicKey: wallet.publicKey,
              address,
            });
          } catch (e: any) {
            const msg = e?.message || String(e);
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
      // The RougeChain extension's dApp API sends contract calls this way:
      // sendTransaction({ payload: { type: 'contract_call', contractAddr, method, args, gasLimit, attach } }).
      if (txPayload && typeof txPayload === 'object' && txPayload.type === 'contract_call') {
        if (txPayload.from !== undefined && txPayload.from !== wallet.publicKey) {
          sendResponseToWebView(webViewRef, request.id, undefined, "payload.from is not this wallet's signing key");
          return;
        }
        await handleCallContract(request, txPayload, wallet, webViewRef, showApproval);
        return;
      }
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

    // ── RouGee DM key bridge (E2E messaging inside the dApp browser) ──
    // Both require the site to be connected. RouGee's DMs now use Qwalla's NATIVE
    // messenger crypto so the two apps share one readable inbox: expose the
    // native encryption key and decrypt with Qwalla's `decryptMessage`. Legacy
    // RouGee v1 envelopes ({v:1,keys}) still decrypt with the seed-derived RouGee
    // key so old messages remain readable. The secret never leaves the wallet.
    case 'getEncryptionPublicKey': {
      if (!(await isConnected(request.origin))) {
        sendResponseToWebView(webViewRef, request.id, undefined, 'Not connected');
        return;
      }
      try {
        // Prefer the native messenger key (unifies with Qwalla's own Chats);
        // fall back to the RouGee-derived key if the native one isn't present.
        const encPublicKey = useWalletStore.getState().encPublicKey;
        if (encPublicKey) {
          sendResponseToWebView(webViewRef, request.id, { encryptionPublicKey: encPublicKey });
          return;
        }
        const mnemonic = useWalletStore.getState().mnemonic;
        const kem = deriveRougeeKem(mnemonic, wallet.privateKey);
        sendResponseToWebView(webViewRef, request.id, { encryptionPublicKey: kem.publicKeyHex });
      } catch (e) {
        sendResponseToWebView(webViewRef, request.id, undefined, 'Could not derive encryption key');
      }
      return;
    }

    case 'decrypt': {
      if (!(await isConnected(request.origin))) {
        sendResponseToWebView(webViewRef, request.id, undefined, 'Not connected');
        return;
      }
      const envelope = String(request.params?.envelope ?? '');
      const myId = String(request.params?.myId ?? '');
      if (!envelope || !myId) {
        sendResponseToWebView(webViewRef, request.id, undefined, 'decrypt requires envelope and myId');
        return;
      }
      // Reading the user's encrypted messages needs its own grant, beyond connecting: asked
      // once per site, remembered on "allow", withdrawn on disconnect (lib/decrypt-permission).
      const allowed = await ensureDecryptPermission(request.origin, () => new Promise<boolean>((resolve) => {
        showApproval({
          id: request.id,
          type: 'decrypt',
          origin: request.origin,
          resolve: () => resolve(true),
          reject: () => resolve(false),
        });
      }));
      if (!allowed) {
        sendResponseToWebView(webViewRef, request.id, undefined, 'User denied request');
        return;
      }
      try {
        let isV1 = false;
        try {
          const o = JSON.parse(envelope);
          isV1 = o && o.v === 1 && !!o.keys;
        } catch {
          /* not JSON we recognize */
        }
        const store = useWalletStore.getState();
        const rougee = deriveRougeeKem(store.mnemonic, wallet.privateKey);

        // Try both keys so the RouGee↔native crypto migration can't break DMs
        // regardless of which key a message was encrypted to (the directory key
        // shifts from the RouGee-derived key to the native key mid-migration).
        // Wrong-key attempts fail the GCM auth tag and are skipped.
        const attempts: Array<() => string> = [];
        if (isV1) {
          // v1 RouGee envelope: only ever encrypted to the RouGee-derived key.
          attempts.push(() => decryptRougeeEnvelope(envelope, myId, rougee.secretKey));
        } else {
          // Qwalla message format: native key first, then the RouGee-derived key.
          if (store.encPrivateKey) {
            const encPriv = store.encPrivateKey;
            attempts.push(() => decryptMessage(envelope, encPriv, false));
          }
          attempts.push(() => decryptMessage(envelope, bytesToHex(rougee.secretKey), false));
        }

        let plaintext: string | null = null;
        for (const attempt of attempts) {
          try {
            const pt = attempt();
            if (pt && pt !== '[Unable to decrypt]') {
              plaintext = pt;
              break;
            }
          } catch {
            /* wrong key/format — try the next */
          }
        }
        if (plaintext === null) throw new Error('unable to decrypt');
        sendResponseToWebView(webViewRef, request.id, { plaintext });
      } catch (e) {
        sendResponseToWebView(webViewRef, request.id, undefined, 'Decryption failed');
      }
      return;
    }

    default:
      sendResponseToWebView(webViewRef, request.id, undefined, `Unknown method: ${request.method}`);
  }
}
