/**
 * "Browser app" mode.
 *
 * The standalone Qwalla Browser (a separate Electron build — see
 * qwalla-browser/) loads the exact same web bundle as the wallet app, but with
 * `?browser=1` on the initial URL. In that mode the app boots straight into the
 * browser screen full-window and hides the messenger/mail tabs, so the product
 * reads as a web3 browser (browser + built-in wallet) rather than a wallet with
 * a browser tab. The regular Qwalla app never sets the flag.
 *
 * Read once at module load from the initial URL (the flag survives the SPA's
 * first paint); falls back to a global the Electron preload can set.
 */
function detectBrowserApp(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if ((window as unknown as { __QWALLA_BROWSER__?: boolean }).__QWALLA_BROWSER__ === true) {
      return true;
    }
    const search = window.location?.search ?? '';
    return new URLSearchParams(search).get('browser') === '1';
  } catch {
    return false;
  }
}

export const IS_BROWSER_APP = detectBrowserApp();
