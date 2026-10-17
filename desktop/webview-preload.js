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

// Inject a script element into the page's main world at document-start.
function injectMainWorld(code) {
  if (!code) return;
  try {
    const script = document.createElement('script');
    script.textContent = code;
    const root = document.head || document.documentElement;
    if (root) {
      root.appendChild(script);
      script.remove();
    }
  } catch {
    /* CSP blocked or document not ready — non-fatal */
  }
}

// Make navigator.userAgentData (UA Client Hints, the JS side) match the spoofed
// Chrome User-Agent, dropping the "Electron" brand Chromium reports by default.
// Google reads this during sign-in and blocks embedded browsers that leak it
// ("this browser may not be secure"). We derive the version from the already-
// spoofed navigator.userAgent so it stays in sync with main.js.
injectMainWorld(`(function(){
  try {
    if (!navigator.userAgentData) return;
    var m = /Chrome\\/(\\d+)(?:\\.(\\d+)\\.(\\d+)\\.(\\d+))?/.exec(navigator.userAgent || '');
    var major = m ? m[1] : '140';
    var full = (m && m[2]) ? (major + '.' + m[2] + '.' + m[3] + '.' + m[4]) : (major + '.0.0.0');
    var brands = [
      { brand: 'Chromium', version: major },
      { brand: 'Not=A?Brand', version: '24' },
      { brand: 'Google Chrome', version: major }
    ];
    var fullList = [
      { brand: 'Chromium', version: full },
      { brand: 'Not=A?Brand', version: '24.0.0.0' },
      { brand: 'Google Chrome', version: full }
    ];
    var orig = navigator.userAgentData;
    var platform = orig.platform || 'Windows';
    var clean = {
      brands: brands,
      mobile: false,
      platform: platform,
      getHighEntropyValues: function(hints){
        return orig.getHighEntropyValues(hints).then(function(v){
          v.brands = brands; v.fullVersionList = fullList; v.uaFullVersion = full; return v;
        }).catch(function(){
          return { architecture:'x86', bitness:'64', brands: brands, fullVersionList: fullList,
                   mobile:false, model:'', platform: platform, platformVersion:'15.0.0', uaFullVersion: full };
        });
      },
      toJSON: function(){ return { brands: brands, mobile:false, platform: platform }; }
    };
    Object.defineProperty(navigator, 'userAgentData', { configurable:true, enumerable:true, get:function(){ return clean; } });
  } catch(e){}
})();`);

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
  injectMainWorld(ipcRenderer.sendSync('get-injection'));
} catch {
  /* fall back to the host's dom-ready injection */
}
