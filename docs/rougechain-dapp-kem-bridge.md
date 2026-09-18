# RougeChain dApp KEM bridge — design spec

**Status:** proposal · **Author:** eng · **Scope:** Qwalla `window.rougechain` provider + RouGee (rougee-gram) messaging

## Problem

RouGee (the photo dApp) shows *"DMs need an in-app wallet"* when opened inside
Qwalla's dApp browser. DMs are E2E-encrypted with ML-KEM-768; the encryption
key must be derived from / held with the wallet. Qwalla's injected provider
exposes only `connect()` and `signTransaction()` — no key material and no
decrypt primitive — so RouGee can't participate in encrypted messaging while
connected through Qwalla (same for the desktop browser extension).

## Critical finding — the two apps are NOT wire-compatible today

Before adding a bridge, note that RouGee and Qwalla use **different KEM key
origins and different envelope formats**. A bridge alone does not make their
inboxes interoperable.

| | RouGee (`src/lib/pqc.ts`) | Qwalla (`lib/encryption.ts` + `stores/wallet.ts`) |
|---|---|---|
| KEM key origin | **Deterministic from seed**: `ml_kem768.keygen(SHA-512(mnemonic\|"rougee-gram"\|"kem-v1"))` | **Random** `ml_kem768.keygen()`, stored in the wallet bundle |
| Key discovery | Recomputed locally; never published | **Registered on the node directory** (`messenger.registerWallet.encryptionPublicKey`); peers look it up by pubkey |
| Wrap KDF | none — raw KEM sharedSecret → AES-GCM | **HKDF**(SHA-256, salt=0, info=`"pqc-msg"` / `"pqc-cek-wrap"`) → AES-GCM |
| Envelope | `{v:1, iv, data, keys:{ id: {kem,wIv,wCek} }}` | 1:1 `{kemCipherText,iv,encryptedContent,sender…}`; v2 `{version:2, wrappedKeys:{ encPubHex: {…} }}` |
| Recipient key | participant **address/id** | **encryption public-key hex** |

Consequence: RouGee ↔ Qwalla DMs can't cross-decrypt even between native
wallets. They are two separate E2E systems on one chain. Qwalla's format is the
one it claims matches the node / browser extension.

## Two directions (pick one)

### Direction A — Minimal bridge (non-breaking, fragmented inbox)

Add provider methods so RouGee, running inside Qwalla, can do **its own** scheme
without the seed leaving Qwalla.

Provider surface (new methods on `window.rougechain`):

```ts
// Returns the caller-wallet's KEM public key (hex), gated per connected origin.
getEncryptionPublicKey(): Promise<{ encryptionPublicKey: string }>

// Decrypts a single envelope the page received. Qwalla does the KEM work with
// the private key it holds and returns ONLY plaintext — never the secret key or
// raw shared secret. Requires the origin to be connected; may prompt.
decrypt(params: { envelope: string; myId: string }): Promise<{ plaintext: string }>
```

- **Non-breaking.** RouGee-native and RouGee-web DMs keep working unchanged.
- To match RouGee's key exactly, Qwalla must reproduce RouGee's *seed*
  derivation (`SHA-512(mnemonic|"rougee-gram"|"kem-v1")`) — a fragile coupling,
  and it needs the mnemonic (absent for raw-key imports).
- The RouGee-in-Qwalla inbox stays **separate** from Qwalla's own messenger.
- Encrypt stays client-side in RouGee (public keys are enough to encrypt); only
  `decrypt` needs the bridge.

### Direction B — Unify on the ecosystem format (breaking for RouGee, one inbox)

RouGee adopts Qwalla / extension / node conventions:
- discover peers' `encryptionPublicKey` via the node directory (`rc.messenger`),
- switch its wire format to HKDF + `wrappedKeys` keyed by encPubHex,
- for provider wallets, delegate `decrypt` to Qwalla via the bridge above; for
  native wallets, generate+store a random KEM key like Qwalla does.

- **One messaging ecosystem** across RouGee-web, RouGee-in-Qwalla, Qwalla-native
  and the extension. This is the "real provider" answer.
- **Breaking**: RouGee's existing DMs (old seed-derived key + old format) become
  unreadable. Needs a dual-read migration window (try new format, fall back to
  legacy) and a re-registration of each user's KEM key on the directory.

## Transport (either direction)

Reuse the existing request bridge in `lib/dapp-provider.ts`:
- add `'getEncryptionPublicKey'` and `'decrypt'` to `DappRequest.method`,
- inject the two functions in `getInjectedProviderScript()` (call `sendReq`),
- handle them in `handleDappRequest()` using `useWalletStore` `encPrivateKey` /
  `encPublicKey` and `@/lib/encryption`.

## Security

- Both methods **require the origin to be in connected-sites**; reject otherwise.
- `decrypt` returns plaintext only. **Never** expose `encPrivateKey` or a raw
  KEM shared secret to the page — that would let any connected dApp decrypt
  everything addressed to the user.
- Consider a per-session user consent + a rate/prompt policy for `decrypt` (a
  page decrypting a long history should be visible to the user).
- Group/mail v2 already keys by encPubHex; a batch `decryptMany` can be added
  later to avoid one round-trip per message.

## RouGee-side changes (`src/lib/extensionSigner.ts`, `src/lib/pqc.ts`)

- Extend `RougeChainProvider` with the two optional methods.
- `deriveKemKeypair` / decrypt path: when `host` is `qwalla`/`extension` and the
  provider advertises the methods, route `getEncryptionPublicKey` + `decrypt`
  through the provider instead of local seed derivation.
- Ungate DMs for provider wallets **only** when the provider advertises the
  bridge (feature-detect; old Qwalla builds keep the current gated UX).

## Open decision

Direction **A** (ship fast, fragmented) vs **B** (unified, breaking + migration).
Recommendation: **B** long-term for a coherent ecosystem, but it requires a
migration plan for existing RouGee DMs; **A** is the smaller step if we want DMs
working inside Qwalla immediately without touching existing conversations.
