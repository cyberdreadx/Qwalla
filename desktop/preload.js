// Preload — the isolated bridge between the renderer (the web app) and the
// Electron main process.
//
// It exposes an OS-keychain-backed secure store to the web app under
// `window.qwallaSecureStore`. Values are encrypted at rest by the OS keychain
// (macOS Keychain / Windows DPAPI) in the main process — the renderer only ever
// sees plaintext for the specific wallet keys it asks for, and nothing is
// written to browser localStorage. `available` is false when the OS can't
// provide encryption (e.g. a Linux box with no keyring), in which case the app
// keeps the wallet disabled rather than storing keys insecurely.

const { contextBridge, ipcRenderer } = require('electron');

// Resolved synchronously so lib/secure-store.ts can decide WALLET_SUPPORTED at
// module-eval time (main registers this handler before the window loads).
const available = ipcRenderer.sendSync('secure-store:available') === true;

contextBridge.exposeInMainWorld('qwallaSecureStore', {
  available,
  getItem: (key) => ipcRenderer.invoke('secure-store:get', key),
  setItem: (key, value) => ipcRenderer.invoke('secure-store:set', key, value),
  removeItem: (key) => ipcRenderer.invoke('secure-store:remove', key),
});

// In-app dApp browser support. The renderer sets the <webview preload> attribute
// from this path, and the browser menu clears the guest partition via clearData.
// Presence of `qwallaWebviewPreload` also tells the renderer it's the desktop app.
contextBridge.exposeInMainWorld('qwallaWebviewPreload', ipcRenderer.sendSync('webview-preload-path'));
contextBridge.exposeInMainWorld('qwallaBrowser', {
  clearData: () => ipcRenderer.invoke('dapp:clear-data'),
  // Downloads: subscribe to progress updates (returns an unsubscribe fn) and
  // open / reveal a finished file.
  onDownload: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('download:update', listener);
    return () => ipcRenderer.removeListener('download:update', listener);
  },
  openDownload: (filePath) => ipcRenderer.invoke('download:open', filePath),
  showDownload: (filePath) => ipcRenderer.invoke('download:show', filePath),
  // Tell the extensions runtime which dApp <webview> tab is active, so the
  // toolbar's browser actions / popups act on the current page.
  setActiveTab: (webContentsId) => ipcRenderer.send('ext:tab-selected', webContentsId),
  // Extension manager (chrome://extensions equivalent).
  ext: {
    list: () => ipcRenderer.invoke('ext:list'),
    loadUnpacked: () => ipcRenderer.invoke('ext:load-unpacked'),
    remove: (id) => ipcRenderer.invoke('ext:remove', id),
    update: () => ipcRenderer.invoke('ext:update'),
  },
});
