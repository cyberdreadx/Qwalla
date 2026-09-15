# Android wallet-only launch

This Android release provides self-custodial wallet creation/import, balances, send/receive, encrypted chat and mail, and wallet security settings.

Android disables Swap, Bridge, Stake, Shield, token creation, the dApp browser and remote dApp pairing. Restricted route components redirect before mounting their feature implementation, including when opened via deep links. iOS behavior is unchanged by this Android scope change.

## Build

Run `npx eas-cli build --platform android --profile android-wallet` from this project. This profile uses the `android-wallet` update channel, an Android-specific `android-wallet-1` runtime, an AAB artifact, and the production signing configuration. Version code starts at 5 and the inherited auto-increment may advance it further. The previously uploaded build 3 does not contain these restrictions and must be replaced.

## Before release

- On an Android device, verify create/import, native and Base transfers, receiving, chat/mail and fingerprint unlock.
- Open deep links to wallet/swap, wallet/bridge, wallet/stake, wallet/shield, wallet/create-token and browser. All should return to the wallet without mounting those screens.
- Attempt a Qwalla dApp pairing link. No pairing request should start.
- Capture new screenshots. Existing wallet and browser store images show features excluded from this build.
- Remove dApp browser, swaps, bridge, staking, Shield and token-creation claims from the Android listing and release notes.
- Describe the app accurately in the Financial Features declaration. This code change is not a legal determination or a guarantee of approval.
- Review launch territories against the actual feature scope and current Play requirements, then replace the old bundle before submitting.

Suggested release notes:
Introducing Qwalla for Android. Manage your self-custodial wallet, send and receive tokens, and use encrypted chat and mail. Protect wallet access with automatic locking and fingerprint unlock on supported devices.
