// Chrome-extension support for the Qwalla Browser (desktop only).
//
// Uses electron-chrome-extensions (runtime: browser-action toolbar, popups,
// chrome.* APIs, content scripts) + electron-chrome-web-store (install from the
// Chrome Web Store). Both are bound to the dApp <webview> session so extensions
// apply to the pages the user browses — not to Qwalla's own app UI.
//
// Tab model bridge: the browser's tabs are <webview>s in the renderer, so we
// register each webview's webContents with the extensions runtime as a "tab",
// and translate the runtime's tab callbacks (select/remove/create) into IPC the
// renderer's tab UI understands.
const path = require('path');
const { app, session } = require('electron');

let extensions = null;
let getWin = () => null;

// Pending renderer-created tabs, keyed by a request id, resolved when the new
// <webview>'s webContents attaches (see registerWebviewTab).
let nextReq = 1;
const pendingTabs = new Map();

/** Set up the extensions runtime + Web Store on the given session partition. */
function setupExtensions({ partition, getMainWindow }) {
  getWin = getMainWindow;
  const dappSession = session.fromPartition(partition);

  // Must be required after app is ready (the module touches app at load).
  const { ElectronChromeExtensions } = require('electron-chrome-extensions');
  const { installChromeWebStore } = require('electron-chrome-web-store');

  // Needed so <browser-action-list> can render extension icons (crx:// scheme).
  ElectronChromeExtensions.handleCRXProtocol(dappSession);

  extensions = new ElectronChromeExtensions({
    license: 'GPL-3.0',
    session: dappSession,
    // An extension opened a tab (e.g. its options page or a link) — ask the
    // renderer to open a new browser tab and wait for its webContents.
    createTab: async (details) => {
      const win = getWin();
      if (!win) throw new Error('no window');
      const wc = await requestRendererTab(win, details.url || 'about:blank');
      return [wc, win];
    },
    selectTab: (tab, win) => {
      win?.webContents.send('ext:select-tab', tab.id);
    },
    removeTab: (tab, win) => {
      win?.webContents.send('ext:remove-tab', tab.id);
    },
    // Single-window browser: reuse the main window for any window request.
    createWindow: async () => getWin(),
  });

  // Make the <browser-action-list> element + chrome API available in the app
  // renderer (the toolbar). The preload only requires 'electron', so it runs
  // fine under the main window's sandbox. Registered on defaultSession, which is
  // the app window's session.
  try {
    const preloadPath = require.resolve(
      'electron-chrome-extensions/dist/chrome-extension-api.preload.js',
    );
    session.defaultSession.registerPreloadScript({
      type: 'frame',
      id: 'electron-chrome-extensions',
      filePath: preloadPath,
    });
  } catch (e) {
    console.warn('[Qwalla] extension toolbar preload registration failed:', e);
  }

  const extensionsPath = path.join(app.getPath('userData'), 'Extensions');
  installChromeWebStore({
    session: dappSession,
    extensionsPath,
    loadExtensions: true, // reload previously installed extensions on launch
    minimumManifestVersion: 2,
  }).catch((e) => console.warn('[Qwalla] Chrome Web Store setup failed:', e));

  console.log('[Qwalla] Extensions runtime ready on', partition);
}

/**
 * Register a dApp <webview>'s webContents as an extension tab. Called from
 * main.js on did-attach-webview. `tabId` is the renderer's own tab id so the
 * runtime's select/remove callbacks can be mapped back to the UI.
 */
function registerWebviewTab(webContents, win) {
  if (!extensions) return;
  try {
    extensions.addTab(webContents, win);
  } catch (e) {
    console.warn('[Qwalla] addTab failed:', e);
  }
  // If an extension createTab() is awaiting a new tab, resolve the oldest
  // pending request with this freshly-attached webview.
  const first = pendingTabs.keys().next();
  if (!first.done) {
    const resolve = pendingTabs.get(first.value);
    pendingTabs.delete(first.value);
    resolve(webContents);
  }
}

function selectWebviewTab(webContents) {
  if (extensions && webContents) {
    try { extensions.selectTab(webContents); } catch { /* ignore */ }
  }
}

function removeWebviewTab(webContents) {
  if (extensions && webContents) {
    try { extensions.removeTab(webContents); } catch { /* ignore */ }
  }
}

// Ask the renderer to open a new tab and resolve with its webContents once the
// webview attaches. Times out so a stuck request can't hang the runtime.
function requestRendererTab(win, url) {
  const reqId = nextReq++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingTabs.delete(reqId);
      reject(new Error('tab-open timeout'));
    }, 15000);
    pendingTabs.set(reqId, (wc) => {
      clearTimeout(timer);
      resolve(wc);
    });
    win.webContents.send('ext:open-tab', { reqId, url });
  });
}

module.exports = {
  setupExtensions,
  registerWebviewTab,
  selectWebviewTab,
  removeWebviewTab,
};
