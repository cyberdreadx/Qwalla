// Qwalla desktop — Electron main process.
//
// This wraps the Expo *web* export (../dist) in a desktop window. The web
// bundle references assets by absolute path (/_expo/...), so instead of
// loading it over file://, we serve ../dist from a localhost HTTP server and
// point the window at it. That keeps client-side routing and asset resolution
// working exactly as they do on qwalla.io.

const { app, BrowserWindow, shell, ipcMain, safeStorage, session } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const handler = require('serve-handler');

// ── OS-keychain secure store ──────────────────────────────────────────────
// Persists the wallet bundle encrypted at rest via the OS keychain. safeStorage
// only encrypts/decrypts, so we store the ciphertext (base64) in a 0600 file in
// the app's userData dir. Only `qwalla_`-prefixed keys are proxied.

const storeFile = () => path.join(app.getPath('userData'), 'qwalla-secure-store.json');
const isAllowedKey = (key) => typeof key === 'string' && /^qwalla_[a-z0-9_]+$/i.test(key);

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(obj) {
  fs.writeFileSync(storeFile(), JSON.stringify(obj), { mode: 0o600 });
}

function setupSecureStore() {
  const canEncrypt = (() => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  })();

  // Synchronous availability probe read by the preload at load time.
  ipcMain.on('secure-store:available', (event) => {
    event.returnValue = canEncrypt;
  });

  ipcMain.handle('secure-store:get', (_event, key) => {
    if (!canEncrypt || !isAllowedKey(key)) return null;
    const b64 = readStore()[key];
    if (typeof b64 !== 'string') return null;
    try {
      return safeStorage.decryptString(Buffer.from(b64, 'base64'));
    } catch {
      return null;
    }
  });

  ipcMain.handle('secure-store:set', (_event, key, value) => {
    if (!isAllowedKey(key)) throw new Error('Invalid key');
    if (!canEncrypt) throw new Error('OS encryption unavailable');
    const store = readStore();
    store[key] = safeStorage.encryptString(String(value)).toString('base64');
    writeStore(store);
  });

  ipcMain.handle('secure-store:remove', (_event, key) => {
    if (!isAllowedKey(key)) return;
    const store = readStore();
    delete store[key];
    writeStore(store);
  });
}

// Packaged: dist is copied into resources/web (see extraResources in
// package.json). Dev (`npm start`): read the sibling ../dist directly.
const WEB_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'web')
  : path.join(__dirname, '..', 'dist');

let server = null;
let serverUrl = '';

function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) =>
      handler(req, res, {
        public: WEB_DIR,
        cleanUrls: true,
        // Expo emits content-hashed filenames (entry-<hash>.js, fonts, images),
        // so they can be cached hard. Without this every window load re-reads
        // ~16 MB of JS/fonts/images from disk instead of using the HTTP cache.
        headers: [
          {
            source: '**/*.@(js|css|ttf|otf|woff|woff2|png|jpg|jpeg|gif|svg|webp)',
            headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
          },
        ],
      }),
    );
    server.on('error', reject);
    // Port 0 → OS assigns a free port; bind to loopback only.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      serverUrl = `http://127.0.0.1:${port}`;
      resolve(serverUrl);
    });
  });
}

let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 860,
    minWidth: 380,
    minHeight: 600,
    center: true,
    backgroundColor: '#04060A',
    title: 'Qwalla',
    // Hide the generic File/Edit/View menu bar (Windows/Linux) for a cleaner
    // look; Alt reveals it and keyboard shortcuts (copy/paste) still work.
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Wallet-grade isolation: the renderer cannot reach Node.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(serverUrl);

  // Keep in-app navigation inside the window; send anything external
  // (real links, http(s) to other origins) to the user's default browser.
  const isInternal = (url) => url.startsWith(serverUrl);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) return { action: 'allow' };
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isInternal(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
}

// The renderer runs at http://127.0.0.1:<port>, so calls to the RougeChain API
// are cross-origin. The API isn't configured to allow a browser origin (the
// wallet only ever ran on native before), which blocks balance/tx fetches.
// Relax CORS for this app's session only — the renderer runs our own bundle, so
// this is not the risk it would be for arbitrary remote content. (Cheaper and
// safer than webSecurity: false.)
function relaxCors() {
  // Only remote responses need CORS rewriting. Scoping the filter keeps the
  // app's own asset loads (JS/fonts/images off the loopback server) out of this
  // hook entirely — every intercepted response costs a main-process round-trip,
  // and the local bundle is ~126 files / 16 MB.
  const filter = { urls: ['http://*/*', 'https://*/*'] };
  session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    if (serverUrl && details.url.startsWith(serverUrl)) {
      callback({}); // same-origin app asset — leave headers untouched
      return;
    }
    // Most RougeChain/Base/DexScreener endpoints already send
    // Access-Control-Allow-Origin: *. Appending our own would produce a
    // duplicated header ("*, *"), which browsers reject — so strip any existing
    // CORS headers (case-insensitive) and set exactly one of each.
    const headers = {};
    for (const [key, value] of Object.entries(details.responseHeaders || {})) {
      if (!/^access-control-allow-(origin|headers|methods)$/i.test(key)) {
        headers[key] = value;
      }
    }
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Headers'] = ['*'];
    headers['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS'];
    callback({ responseHeaders: headers });
  });
}

// Only one Qwalla may run at a time. Without this, each launch starts another
// instance sharing the same userData dir; they contend for the HTTP and GPU
// shader caches ("Unable to move the cache: Access is denied", "Gpu Cache
// Creation failed"), so nothing is cached and the ~4 MB bundle + 4 MB of icon
// fonts are re-parsed and shaders recompiled every time — which reads as the
// app being very slow. A second launch now just focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    relaxCors();
    setupSecureStore(); // register IPC handlers before any window/preload loads
    await startServer();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
  if (server) server.close();
});
