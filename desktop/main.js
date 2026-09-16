// Qwalla desktop — Electron main process.
//
// This wraps the Expo *web* export (../dist) in a desktop window. The web
// bundle references assets by absolute path (/_expo/...), so instead of
// loading it over file://, we serve ../dist from a localhost HTTP server and
// point the window at it. That keeps client-side routing and asset resolution
// working exactly as they do on qwalla.io.

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const http = require('http');
const handler = require('serve-handler');

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
      handler(req, res, { public: WEB_DIR, cleanUrls: true }),
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

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 380,
    minHeight: 600,
    backgroundColor: '#0A0C10',
    title: 'Qwalla',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Wallet-grade isolation: the renderer cannot reach Node.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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

app.whenReady().then(async () => {
  await startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
  if (server) server.close();
});
