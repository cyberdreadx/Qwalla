# Qwalla 1.1.0 — Release Notes

**Marketing version:** 1.1.0
**iOS build:** 29 · **Android versionCode:** 4
**Release type:** App Store update (1.0.0 → 1.1.0), auto-release on approval

## What's New (App Store "What's New" copy)

```
What's New in 1.1.0

• Smoother keyboard handling — the on-screen keyboard now stays out of the way
  while you type a message, compose encrypted mail, or fill out a send form.
• Send to any address instantly — plain transfers can now go straight to any
  rouge1 address, including brand-new ones that haven't transacted before.
• Stability improvements and polish under the hood.
```

### Shorter alternative

```
• Improved keyboard handling across messaging, mail, and wallet screens — no more covered text fields.
• Send transfers directly to any rouge1 address, including ones never used before.
• Stability and performance improvements.
```

## Technical changes

- **Keyboard overlay fix (Android especially):** adopted `react-native-keyboard-controller`
  app-wide (KeyboardProvider + KeyboardAvoidingView / KeyboardAwareScrollView) so the
  keyboard no longer covers input fields under Expo SDK 55 edge-to-edge. Covers messenger,
  mail compose, wallet forms (send, send-base, swap, shield, create-token), auth screens,
  and the lock screen. Native dependency — required a rebuild (not OTA-deliverable).
- **Transfer to any rouge1 address (PR #29):** plain transfers now send straight to a
  rouge1 address via the canonical address instead of resolving the recipient's public
  key first, so never-seen rouge1 addresses work. Shielded notes still resolve the pubkey.

## Release checklist (App Store Connect)

1. Version Release → **Automatically release this version** (auto-release on approval).
2. Attach **build 29** (v1.1.0) once Apple finishes processing.
3. Export compliance → Yes uses encryption → Yes exempt → Yes standard algorithms →
   self-classify (the `ITSAppUsesNonExemptEncryption` key is intentionally absent from app.json).
4. Paste the "What's New" copy above → **Submit for Review**.
