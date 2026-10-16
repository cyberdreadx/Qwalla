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

// Install window.rougechain / window.ethereum at document-start — before any
// page script runs — so dApps that read the provider during initial evaluation
// (a bare `if (window.ethereum)`, a library that snapshots it on load) see it.
// We append a <script> into the page's main world; the provider scripts
// self-guard against double injection. This runs just after the transport
// (ReactNativeWebView) is exposed above, which the injected provider needs.
//
// NOTE: a site with a strict Content-Security-Policy can block this inline
// <script> (CSP is enforced regardless of who appends the node). That case is
// covered by ElectronWebView's dom-ready executeJavaScript(), which is CSP-exempt
// — so the provider still installs there, just not at document-start. This path
// is the fast path for the common (non-strict-CSP) case; it never regresses.
try {
  const code = ipcRenderer.sendSync('get-injection');
  if (code) {
    const script = document.createElement('script');
    script.textContent = code;
    const root = document.head || document.documentElement;
    if (root) {
      root.appendChild(script);
      script.remove();
    }
  }
} catch {
  /* fall back to the host's dom-ready injection */
}
