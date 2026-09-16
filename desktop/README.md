# Qwalla Desktop (macOS + Windows)

An [Electron](https://www.electronjs.org/) shell that wraps Qwalla's existing
**web build** (the same bundle that runs qwalla.io) into installable desktop
apps: a `.dmg` for macOS and an `.exe` (NSIS) installer for Windows.

It reuses `react-native-web`, so there is no second app to maintain — the
desktop app is the web app in a native window.

## How it works

`main.js` serves the exported web bundle (`../dist`) from a localhost HTTP
server and loads it in a hardened `BrowserWindow` (`contextIsolation: true`,
`nodeIntegration: false`, `sandbox: true`). External links open in the user's
default browser; everything else stays in-app.

## Build

From the **repo root**, export the web bundle first:

```bash
npx expo export --platform web        # produces ./dist
```

Then, in this folder:

```bash
cd desktop
npm install                            # electron + electron-builder + serve-handler
npm start                              # run the desktop app locally against ../dist
```

Produce installers (output lands in `desktop/release/`):

```bash
npm run dist:win        # Windows .exe (NSIS)  — build on Windows
npm run dist:mac        # macOS .dmg           — build on macOS
npm run dist:all        # both (requires the right host per target)
```

> **Cross-compiling is limited.** Build the macOS `.dmg` on a Mac and the
> Windows `.exe` on Windows (or CI runners per-OS). electron-builder converts
> `build/icon.png` (1024×1024) to `.icns` / `.ico` automatically.

## Before you ship — required for distribution

1. **Code signing / notarization.**
   - macOS: an Apple Developer ID cert + notarization, or Gatekeeper blocks the
     app. Configure `mac.notarize` / signing env vars in `package.json` build.
   - Windows: an Authenticode cert, or SmartScreen warns on first run.
2. **Auto-update** (optional): add `electron-updater` + a release feed
   (e.g. GitHub Releases) so users get updates without re-downloading.

## Known gaps carried over from the web target

These are limitations of the *web* build the desktop app inherits — worth
deciding before a wide release. Each has a desktop-only fix path via the
Electron main process (see `preload.js` seam):

- **Key storage** is browser storage (the encrypted wallet bundle in
  AsyncStorage → localStorage/IndexedDB), **not** an OS keychain. For a wallet,
  consider upgrading to Electron `safeStorage` (OS-backed) via a preload
  bridge.
- **Crypto uses the slow JS PBKDF2 fallback** (`lib/pbkdf2.ts` returns null on
  web). Electron has Node — a desktop-only native PBKDF2 path would speed up
  unlock/backup.
- **No push notifications** (`lib/push.ts` no-ops on web). Electron can post
  native desktop notifications instead.
- **No biometric unlock** — Touch ID (macOS) / Windows Hello could be wired via
  the main process.
- **Mobile-first layout**: the UI is portrait/phone-width and will render as a
  centered column in a large window. A responsive desktop layout pass is worth
  doing for polish.
- The **in-app dApp browser** is disabled on web and stays disabled here.
