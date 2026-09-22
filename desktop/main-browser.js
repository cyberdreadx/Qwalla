// Entry point for the standalone "Qwalla Browser" build. It just flips a flag
// and hands off to the shared main.js, which adapts branding, window size, and
// the initial URL (?browser=1) when this flag is set. See main.js (BROWSER_APP)
// and the "browser" electron-builder config in package.json.
global.__QWALLA_BROWSER_APP__ = true;
require('./main.js');
