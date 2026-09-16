// Expo Metro config, extended to keep the Electron desktop shell (./desktop)
// out of the React Native bundle/watcher — nothing in the app imports it, and
// its node_modules (electron, etc.) must never be crawled by Metro.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const desktopBlock = /[\\/]desktop[\\/].*/;
const existing = config.resolver.blockList;
config.resolver.blockList = existing
  ? [].concat(existing, desktopBlock)
  : desktopBlock;

module.exports = config;
