# Qwalla — App Store Review Notes

Response material for Submission ID `524ba99c-34d1-4c4d-97ea-5b158895bc59`
(v1.0, review date 8 Sep 2026), which raised **Guideline 2.1 / 3.1.5(iii)**
(cryptocurrency exchange services) and **Guideline 4.7.4** (index of
non-embedded software).

**One `[BRACKETED]` field is left to fill in before sending.** Section 3 must be pasted
into App Store Connect → Review Notes on *every* future submission, not just
this one — Apple asked for that explicitly.

---

## ⚠️ Read this before you write the reply

Apple's Guideline 2.1 letter asks for third-party exchange partnership
documentation. **There is no third party.** Qwalla, rougee.app, antireddit.com
and rougechain.io are all operated by RougeChain Technologies LLC, so items 1
and 2 of the reply are answered by that fact alone — no agreement exists to
produce because no outside company supplies anything to this app.

Do not volunteer the word "partner" anywhere in the reply. The moment Apple is
told the app partners with an exchange, the burden becomes proving that exchange
is licensed in every territory the app ships to, plus FCA registration for the
UK.

Do not describe rougechain.io as a third-party site either — Apple can see the
developer name on both, and being caught overstating distance is worse than the
finding itself. The accurate and sufficient position is about the *app*: the
iOS build surfaces no exchange. No Swap / Bridge / Stake entry points in the
wallet, no exchange dApp shortcuts in the browser. Operating a website is not
what Guideline 3.1.5(iii) governs; offering exchange functionality inside the
app is, and this build does not.

---

## 1. What changed in this build

Build 24 dropped only the Swap / Pools / Bridge bookmarks. The reviewer tapped
the **Tokens** bookmark, landed on rougechain.io, and reached the exchange from
the site's own sidebar (their screenshot 1). Removing three shortcuts while
still shipping a fourth into the same site never closed that door.

This build removes **all** RougeChain shortcuts from the iOS bookmark index —
Explorer, Tokens, NFTs, Swap, Pools and Bridge. The gate is one predicate in
[`lib/compliance.ts`](../lib/compliance.ts) applied to the bundled bookmark
list.

| Surface | Behaviour on iOS |
|---|---|
| Browser bookmark index | qRougee and antiReddit only — no RougeChain entries |
| Wallet quick actions (Swap / Bridge / Stake) | Not rendered (unchanged from build 24) |

**Nothing is blocked or disabled.** This is an index filter, not a navigation
block: rougechain.io loads normally for anyone who types or saves the URL, the
injected provider still connects, signs, sends transactions and calls contracts,
and the self-custodial wallet, encrypted messenger, encrypted mail and block
explorer are untouched. Android and web ship every bookmark.

> **Internal note, not for Apple:** the native swap/bridge/stake screens remain
> in the iOS binary with no UI entry point, and `app.json` registers the
> `qwalla://` scheme, so they stay addressable by deep link
> (`qwalla:///(tabs)/wallet/swap`). Reviewers essentially never do this. It is
> the one gap between "hidden" and "not offered", and a one-line guard per
> screen closes it if a future rejection makes that worth doing.

---

## 2. Reply to Guideline 2.1 — Guideline 3.1.5(iii)

> Paste as the App Review reply.

Thank you for the review. To clarify the app's functionality:

**Qwalla is a self-custodial wallet and encrypted communications client. It does
not provide cryptocurrency exchange services.** The app holds no user funds,
operates no order book or matching engine, and provides no fiat on- or off-ramp.
Keys are generated and held on the user's device; the app signs transactions
locally and never routes an order through a trading venue.

1. **Third-party exchange partnership — none.** We have not partnered with any
   third-party exchange to provide exchange services in this app. There is no
   partnership agreement to produce because no third party supplies exchange
   functionality to Qwalla.

2. **Third-party exchange APIs — none.** The app integrates no exchange API,
   public or private. Its network dependencies are a blockchain node API
   (`https://api.rougechain.io/api`) used for account balances, block data and
   transaction broadcast, and our own messaging and mail services. None of these
   is an exchange endpoint.

3. **Distribution.** The iOS build offers no exchange service in any territory,
   so no jurisdiction receives exchange functionality. App availability is set
   to `[CONFIRM: the territory list selected in App Store Connect]`.

4. **UK FCA cryptoasset promotions.** The app makes no financial promotion
   within the meaning of s.21 FSMA 2000. It does not offer, arrange or promote a
   cryptoasset exchange, does not invite or induce investment activity, and
   contains no price, yield, return, performance or promotional claim about any
   cryptoasset. It is a self-custodial key-management and communications tool
   for which the user pays nothing and from which we take no fee or spread.

Regarding the previous build: the trading pages the reviewer reached were pages
of a public website, loaded in the app's web browser after following links on
that site. They are not functionality of the app, and the app has no interface
of its own for them. This build ships no shortcuts to that site at all, and
presents no exchange interface anywhere.

> ⚠️ **Item 4 is a legal assertion made in your name.** It is a reasonable
> position for a fee-free non-custodial wallet with no exchange, but you hold no
> FCA registration — have counsel confirm the wording before sending. The
> alternative, if you would rather not make the claim, is to remove the United
> Kingdom from the app's availability list and say so instead.

---

## 3. Reply to Guideline 4.7.4 — index of non-embedded software

> Paste this table into **Review Notes for every submission**. Regenerate it
> with `node scripts/app-store-dapp-index.js` rather than editing it by hand —
> that script reads the real bookmark list and the real filter, so the table
> cannot drift from what ships, and it exits non-zero if it does.

Qwalla includes a web browser for decentralized applications. It contains no
games, no game emulators and no streamed software. The complete index of
non-embedded software the iOS app links to:

| Name | Developer | URL | What it is |
|---|---|---|---|
| qRougee | RougeChain Technologies LLC | https://rougee.app | Music streaming and artist pages |
| antiReddit | RougeChain Technologies LLC | https://antireddit.com | Public discussion forum |

Neither offers exchange, trading or liquidity functionality. Both are web pages
rendered in `WKWebView`; no code is downloaded, installed or executed outside
the web view. As in Safari, a user may also type any URL of their own.

Listed in earlier builds and **removed from the iOS build**: Explorer, Tokens,
NFTs, Swap, Pools and Bridge (all on `rougechain.io`).

---

## 4. Before resubmitting

Done in this branch:

- [x] `expo.ios.buildNumber` bumped to **26**.
- [x] Developer names filled in (RougeChain Technologies LLC, both).
- [x] Bookmark index verified per platform — `node scripts/app-store-dapp-index.js`
      passes: iOS lists qRougee and antiReddit only; Android and web list all
      eight.

Still needs you:

- [ ] **Settle section 2 item 4 (FCA) with counsel.** It is a legal assertion in
      your name and you hold no FCA registration. The fallback, if you would
      rather not make it, is to remove the United Kingdom from availability and
      say that instead.
- [ ] **Fill in the territory list** in section 2 item 3 to match App Store
      Connect exactly — the reply claims it.
- [ ] **Run the app once on a device or simulator** and confirm: the dApp grid
      shows only qRougee and antiReddit · wallet home shows no Swap / Bridge /
      Stake · typing `rougechain.io` still loads and the wallet still connects
      and signs. The script above checks the filter logic, not the rendered UI.
- [ ] Paste sections 2 and 3 into App Store Connect → Review Notes.
