// Preload for the in-app dApp browser's <webview> guests.
//
// The injected RougeChain/EVM providers (lib/dapp-provider.ts, lib/evm-provider.ts)
// were written for react-native-webview: they call
// `window.ReactNativeWebView.postMessage(...)` to reach the host, and the host
// replies by injecting `window.postMessage(...)`. We reproduce exactly that
// contract on Electron so the same provider code runs unchanged:
//
//   guest → host:  window.ReactNativeWebView.postMessage  →  ipcRenderer.sendToHost('rnwv-message')
//   host  → guest: <webview>.executeJavaScript("window.postMessage(...)")  (see ElectronWebView)
//
// contextIsolation is on, so we bridge into the page's main world via
// contextBridge. Node stays unreachable from the guest — the only thing exposed
// is a single postMessage function, the same surface mobile grants.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ReactNativeWebView', {
  postMessage: (data) => ipcRenderer.sendToHost('rnwv-message', String(data)),
});
