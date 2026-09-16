// Preload runs in an isolated context between the renderer and Node.
//
// Nothing is exposed to the web app yet — it runs exactly as it does in a
// browser. This file is the seam for future desktop-only upgrades, e.g.
// exposing OS-keychain storage (electron `safeStorage`) or Touch ID /
// Windows Hello via `contextBridge.exposeInMainWorld(...)`.
