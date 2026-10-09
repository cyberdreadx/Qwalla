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
| `getNetwork()` | no | — | `{ network, label, api, chainId }` |
| `getBalance()` | no | — | balance object for the connected wallet |
| `sendTransaction(payload)` | **yes** | `{ to, amount, token?, fee? }` | `{ txId }` |
| `signTransaction(params)` | **yes** (connected site) | `{ payload }` or `{ payload, serializedHex }` — put `chainId` in the payload | `{ signature }` (hex, ML-DSA-65) |
| `signMessage(params)` | **yes, every time** | `{ message }` (string, ≤ 4,096 bytes) | `{ signature, publicKey, address }` |
| `approve(params)` | **yes** | `{ spender, amount, token? }` | `{ success, … }` |
| `swap(params)` | **yes** | `{ tokenIn, tokenOut, amountIn, minAmountOut? }` | `{ success, … }` |
| `callContract(params)` | **yes** (connected site) | `{ contractAddr, method, args?, gasLimit?, attach?, chainId? }` | `{ success, txId, fee, gasLimit, attach, chainId, preview }` |
| `getEncryptionPublicKey()` | connected | — | ML-KEM public key (hex) — for E2E messaging |
| `decrypt(params)` | connected **+ decrypt permission** | `{ envelope, myId }` | `{ plaintext }` |
| `on(event, cb)` / `removeListener(event, cb)` | — | see Events | — |

### Examples

```js
// Send 25 XRGE
const { txId } = await window.rougechain.sendTransaction({
  payload: { to: 'rouge1…', amount: 25, token: 'XRGE' },
});

// Sign a transaction payload (object is canonicalized — deep key-sorted — then
// UTF-8 encoded before signing). serializedHex is optional; if you pass it, it
// must be exactly those canonical bytes (what @rougechain/sdk serializePayload
// returns), hex-encoded.
const { signature } = await window.rougechain.signTransaction({
  payload: { type: 'transfer', from: publicKey, to: 'rouge1…', amount: 25, timestamp: Date.now(), nonce: '…' },
});

// Login / token gating: sign a MESSAGE, not a transaction (see "Sign-in" below)
if (typeof window.rougechain.signMessage === 'function') {
  const { signature, publicKey, address } = await window.rougechain.signMessage({ message });
}

// Approve a spender, then swap
await window.rougechain.approve({ spender: 'rouge1…', amount: 100, token: 'XRGE' });
await window.rougechain.swap({ tokenIn: 'XRGE', tokenOut: 'qUSDC', amountIn: 100 });
```

> **Fees:** RougeChain currently charges a **flat 1 XRGE** fee per transaction;
> any `fee` you pass is informational and may be overridden by the node. Amounts
> of **XRGE are whole numbers** (decimals are dropped); other tokens keep their
> decimals.

## Contract calls (`callContract`), including payable calls

`callContract` signs a player-signed `contract_call` and submits it to
`POST /api/v2/contract/execute`. It is the same transaction rougechain.io, the
RougeChain browser extension and `@rougechain/sdk` (`rc.contracts.execute`)
build, with the same field names and units, so one code path works everywhere:

| Field | Type | Meaning |
|---|---|---|
| `contractAddr` | string | Contract address (hex; lower-cased). `address` / `contract` are accepted as aliases. |
| `method` | string | Contract function to call. |
| `args` | JSON | Arguments; default `{}`. |
| `gasLimit` | integer | 1 – 10,000,000. The fee is `gasLimit × 0.000001` XRGE, charged up front. If omitted, Qwalla dry-runs the call and signs `ceil(gasUsed × 1.5) + 1000` (the SDK rule). |
| `attach` | `{ symbol, amount }` | **Payable call**: pays the contract. `symbol` is `"XRGE"` or a token symbol (1–32 letters, digits, `_`, `-`; upper-cased). `amount` is a **positive integer**: **quanta** for XRGE (1 XRGE = 1,000,000,000 quanta), **raw units** for a token. A digit string is accepted and sent as a JSON integer; it must be ≤ `Number.MAX_SAFE_INTEGER`. Omit `attach` for a normal call. |
| `chainId` | string, optional | The network you mean: `"rougechain-mainnet-1"` or `"rougechain-devnet-1"` (testnet) — `getNetwork().chainId`. Another network's id is refused; without it the sheet shows a warning. |

```js
import { xrgeToQuanta } from '@rougechain/sdk'; // or: Math.round(0.5 * 1e9) for simple amounts

// Pay 0.5 XRGE into a contract
const res = await window.rougechain.callContract({
  contractAddr: '86fe93e2…',
  method: 'buy_ticket',
  args: { round: 12 },
  gasLimit: 300_000,                                    // max fee 0.3 XRGE
  attach: { symbol: 'XRGE', amount: Number(xrgeToQuanta('0.5')) }, // 500000000 quanta
});
// res → { success: true, txId, fee, gasLimit: 300000,
//         attach: { symbol: 'XRGE', amount: 500000000 }, preview: { returnData, gasUsed, events } }

// Pay 25 raw units of a token
await window.rougechain.callContract({ contractAddr: '86fe93e2…', method: 'pay', attach: { symbol: 'GOLD', amount: 25 } });
```

The RougeChain extension's form also works:
`sendTransaction({ payload: { type: 'contract_call', contractAddr, method, args, gasLimit, attach } })`
goes through exactly the same checks and sheet (a `from` other than the wallet's
key is rejected).

What the wallet does:

- **Connected site only.** Call `connect()` first; otherwise the call is
  rejected with `Site not connected. Call connect() first.`
- **Validates** the fields above and rejects anything else (`amount` of `0`, a
  decimal, a negative number, `"0.5"`; a symbol with spaces; a `gasLimit` out of
  range) with a message naming the field.
- **Checks the balance before asking:** max fee + an XRGE payment must fit the
  wallet's XRGE balance, and a token payment must fit that token's balance
  (plus XRGE for the fee). Otherwise the call is rejected, e.g.
  `Insufficient XRGE for the gas fee and the attached payment: have 1 XRGE, need 1.1 XRGE`.
- **Approval sheet:** `You are sending 0.5 XRGE to contract <full address>` at the
  top, then the method, gas limit, max fee, max total XRGE, arguments, and the
  exact text that is signed (the canonical encoding of the payload — the bytes
  submitted as `payload_bytes_hex`). A payment of **50 % or more** of the
  wallet's balance of that asset turns the sheet red.
- **Signs for the selected network only.** The signed payload carries the
  selected network's `chainId` (checked once per session against the node's
  `/api/health`), so the signature is valid on that one network. A `chainId`
  for another network is rejected (`This request is for RougeChain Testnet, but
  Qwalla is on RougeChain Mainnet. …`); no `chainId` is allowed, with a warning
  on the sheet. The sheet names the network, and the result echoes the signed
  `chainId`. Switching networks while the sheet is open cancels the request.
- The payment moves to the contract **only if the call succeeds** in its block;
  the gas fee is charged either way. The contract reads it with
  `host_get_attached_amount` / `host_get_attached_symbol`.

### Feature detection

Payable calls need a Qwalla build with `window.rougechain.capabilities.payableCalls`:

```js
const caps = window.rougechain?.capabilities ?? {};
if (!caps.payableCalls) {
  // Older Qwalla: callContract used the node-signed preview endpoint and IGNORED `attach`.
  // Don't send a payable call — ask the user to update Qwalla.
}
```

`window.rougechain.capabilities` is a frozen object:
`{ signMessage: true, payableCalls: true }`. A missing object or a missing key
means "not supported". As a second check, the result echoes what was signed in
`attach` (`null` for a non-payable call): if you attached a payment and the
result has no `attach` field, the wallet ignored it.

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
- `decrypt({ envelope, myId })` decrypts a message addressed to the user **inside
  the wallet** (the KEM secret never leaves it) and resolves to `{ plaintext }`.
  - `envelope` is the package as **JSON text**: the 1:1 message format
    `{ kemCipherText, iv, encryptedContent, senderKemCipherText?, senderIv?,
    senderEncryptedContent? }` (ML-KEM-768 → HKDF-SHA256, salt 32 zero bytes,
    info `"pqc-msg"` → AES-256-GCM, all hex). Legacy RouGee `{v:1,keys}`
    envelopes are also supported for backward compatibility.
  - `myId` selects the recipient in a legacy `{v:1,keys}` envelope; it must be a
    non-empty string for every call.
  - **Permission:** the first `decrypt` from a site shows a one-time sheet asking
    to let it read encrypted messages. "Allow" is remembered for that site;
    disconnecting the site (or Revoke in Settings → Connected Sites) withdraws it.
    A denied request rejects with `User denied request`. Concurrent calls share
    one prompt, so an inbox can decrypt many messages after a single approval.

This is what lets a dApp's inbox interoperate with Qwalla's own Chats. The key
derivation is the shared `deriveRougeeKem(mnemonic, …|rougee-gram|kem-v1)`
standard — see `docs/rougechain-dapp-kem-bridge.md` for the design detail.

## Sign-in and token gating (`signMessage`)

Use `signMessage` to prove a visitor controls a wallet. Do **not** use
`signTransaction` for logins: it signs transaction bytes.

- The wallet signs
  `"\x19RougeChain Signed Message:\n" + decimal(byte length) + "\n" + UTF-8(message)`
  with ML-DSA-65. Those bytes can never be a RougeChain transaction, and a
  transaction signature never verifies as a message.
- The site must be connected. The user is asked **every time**; nothing is
  remembered. The sheet shows your site, the whole message (invisible characters
  shown as symbols) and, for a sign-in message, its domain, address, nonce and
  expiry — with a red warning if the domain in the message is not your site.
- A message that parses as a transaction payload (JSON with `type` / `tx_type`)
  is refused: use `signTransaction` for those.
- Verify on your server with `verifyMessage` / `verifySignIn` from
  `@rougechain/sdk` (1.13.0+). Signatures are 3,309 bytes and public keys 1,952
  bytes (hex doubles that), so send them in a POST body, not a URL.
- Feature-detect: older Qwalla builds and extension versions before 1.8.0 do not
  have the method (`window.rougechain.capabilities?.signMessage` is `true` in
  Qwalla builds that do).

The message format, the sign-in text and a complete token-gating server are in
the RougeChain docs: <https://docs.rougechain.io/advanced/wallet-authentication>.

## Notes & gotchas

- **Approval is mandatory** for `sendTransaction`, `signTransaction`,
  `signMessage`, `approve`, `swap`, and `callContract`. If the user dismisses the sheet, the promise
  rejects. `decrypt` asks **once per site** (see above).
- **`signTransaction` signs the payload it shows.** The signed bytes are the
  canonical encoding of `payload` (`serializePayload` from `@rougechain/sdk`).
  `payload` is required and must be an object; a `serializedHex` that is not
  those bytes is rejected with `serializedHex does not match the payload`. Call
  `connect()` first: an unconnected site gets
  `Site not connected. Call connect() first.`
- **One origin = one connection.** Connection approval is remembered per origin.
- **No window.ethereum.** Don't assume EVM semantics; use the methods above.
- Works identically in the mobile in-app browser and the Qwalla Browser desktop
  app (same injected provider, same message protocol).
