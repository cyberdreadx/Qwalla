# Qwalla — App Store Review Notes

Response material for Submission ID `524ba99c-34d1-4c4d-97ea-5b158895bc59`
(v1.0, review date 8 Sep 2026), which raised **Guideline 2.1 / 3.1.5(iii)**
(cryptocurrency exchange services) and **Guideline 4.7.4** (index of
non-embedded software).

**Fill in every `[BRACKETED]` field before sending.** Section 3 must be pasted
into App Store Connect → Review Notes on *every* future submission, not just
this one — Apple asked for that explicitly.

---

## 1. What changed in this build

Build 24 already removed the Swap / Pools / Bridge bookmarks and the wallet's
Swap / Bridge / Stake quick actions on iOS. It was rejected anyway because the
reviewer opened the **Tokens** bookmark and reached the exchange from
rougechain.io's *own sidebar* — the site navigates in-page, so removing the
bookmark never closed the door.

This build closes that path. The gate is in [`lib/compliance.ts`](../lib/compliance.ts):

| Surface | Behaviour on iOS |
|---|---|
| Wallet quick actions (Swap / Bridge / Stake) | Not rendered (unchanged from build 24, now driven by the shared gate) |
| Browser bookmark index | Swap / Pools / Bridge absent |
| Browser navigation to RougeChain exchange routes | Refused — address bar, saved bookmark, deep link, **and in-page navigation from rougechain.io's own menu** |

Scope is deliberately narrow: it matches `rougechain.io` and its subdomains
only, on exchange path segments only (`/swap`, `/pools`, `/bridge`, `/dex`,
`/liquidity`, …). `/blockchain`, `/tokens`, `/nfts`, `/token/XRGE` and every
third-party site are unaffected.

**Deliberately not changed — Qwalla stays a working web3 wallet.** Third-party
dApps load normally in the browser, the injected provider still connects, signs,
sends transactions and calls contracts, and the self-custodial wallet, encrypted
messenger, encrypted mail and block explorer are untouched. Android and web
builds have no gate at all.

> **Internal note, not for Apple:** the native swap/bridge/stake screens are
> still compiled into the iOS binary with no UI entry point. Because `app.json`
> registers the `qwalla://` scheme and expo-router exposes typed routes, they
> remain addressable by deep link (`qwalla:///(tabs)/wallet/swap`). Reviewers
> essentially never do this, but it is the one gap between "hidden" and "not
> offered" — a one-line guard in each screen closes it if a future rejection
> makes that worth doing.

---

## 2. Reply to Guideline 2.1 — Guideline 3.1.5(iii)

> Paste as the App Review reply. Apple's three requests all presuppose a
> third-party exchange partner; there isn't one, which is what items 1–3 say.

Thank you for the review. To clarify the app's functionality:

**Qwalla is a self-custodial wallet and encrypted communications client. It does
not provide cryptocurrency exchange services on iOS.** The app holds no user
funds, operates no order book or matching engine, and provides no fiat on- or
off-ramp. As of build `[BUILD NUMBER]` the iOS build presents no token exchange,
liquidity-pool or bridging functionality: those entry points are absent from the
interface, and our exchange web pages do not open in the app's dApp browser.

1. **Third-party exchange partnership — none.** We have not partnered with any
   third-party exchange. There is no partnership agreement to provide because no
   third party supplies exchange services to this app.

2. **Third-party exchange APIs — none.** The app integrates no exchange API,
   public or private. Its only network dependencies are our own non-exchange
   infrastructure: the RougeChain node API (`https://api.rougechain.io/api`) for
   balances, block data and transaction broadcast, and our messaging and mail
   services. The app signs transactions locally with keys held on the user's
   device; it never routes an order through a venue.

3. **Distribution.** Because the iOS build offers no exchange service in any
   territory, no jurisdiction receives exchange functionality. App availability
   is set to `[CONFIRM: the territory list selected in App Store Connect]`.

4. **UK FCA cryptoasset promotions.** The app makes no financial promotion
   within the meaning of s.21 FSMA 2000. It does not offer, arrange or promote a
   cryptoasset exchange, does not invite or induce investment activity, and
   contains no price, yield, return, performance or promotional claim about any
   cryptoasset. The app is a self-custodial key-management and communications
   tool for which the user pays nothing and from which we take no fee or spread.

The exchange access the reviewer found came from in-page navigation on our own
website inside the app's browser; that has been corrected, and those pages no
longer open in the app. We are happy to provide a build walkthrough or any
further detail.

> ⚠️ **Item 4 is a legal assertion made in your name.** It is a reasonable
> position for a fee-free non-custodial wallet with no exchange, but we hold no
> FCA registration, so have counsel confirm the wording before you send it. If
> you would rather not make the claim at all, the alternative is to remove the
> United Kingdom from the app's availability list and say so instead.

---

## 3. Reply to Guideline 4.7.4 — index of non-embedded software

> Paste this table into **Review Notes for every submission**, and keep it in
> sync with `ALL_BOOKMARKS` in
> [`app/(tabs)/browser/index.tsx`](../app/(tabs)/browser/index.tsx).

Qwalla includes a dApp browser. It contains no games, no game emulators and no
streamed software. The complete index of non-embedded software reachable from
the browser's bookmark index in the iOS build:

| Name | Developer | URL | What it is |
|---|---|---|---|
| qRougee | `[LEGAL ENTITY]` | https://rougee.app | Music streaming and artist pages |
| antiReddit | `[CONFIRM — first-party or third-party?]` | https://antireddit.com | Public discussion forum |
| Explorer | `[LEGAL ENTITY]` | https://rougechain.io/blockchain | Read-only block explorer (blocks, transactions, addresses) |
| Tokens | `[LEGAL ENTITY]` | https://rougechain.io/tokens | Read-only token directory |
| NFTs | `[LEGAL ENTITY]` | https://rougechain.io/nfts | Read-only NFT directory |

None of the above offers exchange, trading or liquidity functionality. All are
web pages rendered in `WKWebView`; no code is downloaded, installed or executed
outside the web view. Users may also type a URL, exactly as in Safari.

Listed in earlier builds and **no longer reachable in the iOS build**: Swap
(`rougechain.io/swap`), Pools (`rougechain.io/pools`), Bridge
(`rougechain.io/bridge`).

---

## 4. Before resubmitting

- [ ] Bump `expo.ios.buildNumber` in `app.json`, and fill in `[BUILD NUMBER]` above.
- [ ] Fill in the developer names in section 3 — Apple asked for them by name.
- [ ] Settle section 2 item 4 (FCA) with counsel.
- [ ] Confirm the availability territory list matches what section 2 item 3 claims.
- [ ] Verify on device:
      wallet home shows no Swap / Bridge / Stake ·
      browser bookmarks show only the five entries above ·
      typing `rougechain.io/swap` is refused ·
      opening `rougechain.io/blockchain`, then tapping **Swap** in the site's own
      sidebar, is refused ·
      a third-party dApp still connects and signs.
- [ ] Paste sections 2 and 3 into App Store Connect → Review Notes.
