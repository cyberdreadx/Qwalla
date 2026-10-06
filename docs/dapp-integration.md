# Connect your site to the Qwalla wallet

Qwalla injects a wallet **provider** into any website opened inside its in-app
dApp browser (iOS/Android) and the **Qwalla Browser** desktop app. Your site
talks to the user's RougeChain wallet through a single global object —
`window.rougechain` — to read their address/balance, request signatures, and
send transactions. Every state-changing action prompts the user for approval
inside the wallet; the private key never leaves it.

> This is the same provider used by first-party dApps. It is **not** an
> EVM/EIP-1193 provider — RougeChain is a post-quantum (ML-DSA-65 / ML-KEM-768)
> chain, so the method set is RougeChain-native.

## 1. Detect the provider

The provider is injected **before** your page scripts run and is a frozen
object. Detect it synchronously, or wait for the `rougechain#initialized` event
(fired once after injection):

```js
function getQwalla() {
  return typeof window !== 'undefined' && window.rougechain?.isRougeChain
    ? window.rougechain
    : null;
}

// Already there?
let qwalla = getQwalla();

// …or wait for it (covers very early page scripts):
window.addEventListener('rougechain#initialized', () => {
  qwalla = getQwalla();
});
```

If `window.rougechain` is absent, the page isn't running inside Qwalla — show
your normal "Open in Qwalla" prompt.

## 2. Connect

`connect()` prompts the user to approve the connection (once per origin; later
calls from an already-approved origin resolve immediately).

```js
const { publicKey, network } = await window.rougechain.connect();
// publicKey → the user's ML-DSA-65 wallet public key (their identity)
// network   → 'mainnet' | 'testnet' | …
```

Rejected connections throw — wrap calls in `try/catch`.

## 3. Methods

All methods return a `Promise`. Approval-gated methods show the wallet's
approval sheet; read-only methods don't. Requests time out after **120 s**.

| Method | Approval? | Params | Resolves with |
|---|---|---|---|
| `connect()` | yes (first time) | — | `{ publicKey, network }` |
| `getNetwork()` | no | — | `{ network, label, api }` |
| `getBalance()` | no | — | balance object for the connected wallet |
| `sendTransaction(payload)` | **yes** | `{ to, amount, token?, fee? }` | `{ txId }` |
| `signTransaction(params)` | **yes** | `{ payload }` **or** `{ serializedHex }` | `{ signature }` (hex, ML-DSA-65) |
| `approve(params)` | **yes** | `{ spender, amount, token? }` | `{ success, … }` |
| `swap(params)` | **yes** | `{ tokenIn, tokenOut, amountIn, minAmountOut? }` | `{ success, … }` |
| `callContract(params)` | **yes** | `{ address, method, … }` | contract call result |
| `getEncryptionPublicKey()` | connected | — | ML-KEM public key (hex) — for E2E messaging |
| `decrypt(params)` | connected | an encrypted envelope | plaintext string |
| `on(event, cb)` / `removeListener(event, cb)` | — | see Events | — |

### Examples

```js
// Send 25 XRGE
const { txId } = await window.rougechain.sendTransaction({
  payload: { to: 'rouge1…', amount: 25, token: 'XRGE' },
});

// Sign an arbitrary payload (object is canonicalized — deep key-sorted — then
// UTF-8 encoded before signing). Pass serializedHex to sign exact bytes.
const { signature } = await window.rougechain.signTransaction({
  payload: { action: 'login', nonce: '…' },
});

// Approve a spender, then swap
await window.rougechain.approve({ spender: 'rouge1…', amount: 100, token: 'XRGE' });
await window.rougechain.swap({ tokenIn: 'XRGE', tokenOut: 'qUSDC', amountIn: 100 });
```

> **Fees:** RougeChain currently charges a **flat 1 XRGE** fee per transaction;
> any `fee` you pass is informational and may be overridden by the node. Amounts
> of **XRGE are whole numbers** (decimals are dropped); other tokens keep their
> decimals.

## 4. Events

```js
window.rougechain.on('accountsChanged', (publicKey) => { /* re-read state */ });
window.rougechain.on('networkChanged',  (network)   => { /* switch RPC/UI */ });
window.rougechain.on('disconnect',      ()          => { /* reset session */ });
```

Always re-fetch balance/identity on `accountsChanged` — the user may have
switched accounts in the wallet.

## 5. End-to-end messaging bridge (optional)

If your dApp has encrypted DMs, it can share Qwalla's messaging identity instead
of maintaining its own. Once connected:

- `getEncryptionPublicKey()` returns the wallet's **native ML-KEM-768** public
  key — publish/look it up so peers can encrypt to the user.
- `decrypt(envelope)` decrypts a message addressed to the user **inside the
  wallet** (the KEM secret never leaves it). Legacy RouGee `{v:1,keys}` envelopes
  are also supported for backward compatibility.

This is what lets a dApp's inbox interoperate with Qwalla's own Chats. The key
derivation is the shared `deriveRougeeKem(mnemonic, …|rougee-gram|kem-v1)`
standard — see `docs/rougechain-dapp-kem-bridge.md` for the design detail.

## Notes & gotchas

- **Approval is mandatory** for `sendTransaction`, `signTransaction`, `approve`,
  `swap`, and `callContract`. If the user dismisses the sheet, the promise
  rejects.
- **One origin = one connection.** Connection approval is remembered per origin.
- **No window.ethereum.** Don't assume EVM semantics; use the methods above.
- Works identically in the mobile in-app browser and the Qwalla Browser desktop
  app (same injected provider, same message protocol).
