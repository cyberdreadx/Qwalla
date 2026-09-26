# Qwalla 1.2.0 — release notes

Marketing version **1.2.0** (iOS build 30 / Android vc for 1.2.0). First native
build since 1.1.0; rolls up everything OTA'd since then plus the native voice-notes
feature. New OTA baseline is runtime **1.2.0**.

---

## TestFlight "What to Test" (paste-ready, concise)

```
What's new in 1.2.0

🎙️ Voice notes — tap the mic in any chat to record and send.
💸 Send crypto inside a chat — it posts a tip right in the conversation.
📷 New "+" attach menu — Camera, Photo, GIF, Stickers, all in one place.
💵 Wallet now shows USD values, with a tap-to-hide-balances toggle.
🗑️ Trash for chats — deleting moves to Trash (restore or delete forever), plus swipe-to-delete.
✍️ Select & copy text from messages and mail.
👥 Group photos + correct per-person avatars in group chats.
🔔 Get notified when you receive crypto.
🧭 First-run tour + a "How Qwalla works" guide in Settings.
🔑 New wallets: your recovery phrase now restores your messages too (older wallets: keep using your Backup file).
⚡ Much faster — Chats and Wallet open instantly; big messenger speedups.

Please test: recording/playing a voice note, sending a crypto tip in a chat,
the camera attach, and swipe-to-delete → Trash → restore.
```

---

## Full changelog (internal)

### Headline
- **Voice notes** — record/send/play in chats (expo-audio; the reason this is a native build).

### Messenger
- Composer redesigned into a single **+** menu (Camera, Photo, GIF, Sticker, Send crypto, Spoiler, Self-destruct); mic-when-empty / send-when-typing.
- **Send crypto in chat** → in-thread 💸 tip bubble (transfer + inline receipt).
- **Trash**: delete = soft-delete to a Trash tab (Restore / Delete forever); **swipe-to-delete** on the list.
- **Select text** on messages (partial copy) + **Copy**; **double-tap to like** (❤️).
- Group **per-sender avatars** fixed (was showing one avatar for everyone); **sticky avatars** (no more mid-conversation disappearing); **group chat photo** (client; needs daemon avatar field to sync).
- Image send fixed (typical iPhone photos now send) and **inline images show full aspect** (no crop); tap for lightbox.
- **Crypto-received** foreground alerts fixed.
- Perf: chunked/deferred decryption so opening a chat no longer freezes; list virtualization; Chats opens instantly (silent live refresh).

### Wallet
- **USD values** on the balance + assets; **hide-balances** eye toggle.
- Recent Activity shows **only this wallet's** transactions.
- Token logos display fixed.
- Opens **instantly** (heavy sections deferred past the tab transition).

### Mail
- Registered mail name shows with a **Change** button (no more empty form).
- Message body + subject **selectable** (copy).

### Browser
- **Auto-sleep inactive tabs** (Settings → Browser) to save memory.

### Security / accounts
- **Lock no longer resets navigation** — unlocking returns you to where you were.
- **Seed-derived encryption keys for new wallets** — the recovery phrase alone restores chat history (existing wallets unchanged; still use the Backup file).
- Clearer **backup vs recovery-phrase** guidance (phrase = funds; Backup file = funds + messages) at the reset dialog, recovery card, and backup card.
- First-run **tutorial** + **"How Qwalla works"** help guide in Settings.

### Fixes
- Pasted recipient addresses strip stray whitespace/newlines.
- Toasts no longer render under the notch/Dynamic Island.
- Composer gap above the tab bar removed.
- Full Spanish (EN/ES) coverage for all new UI.
