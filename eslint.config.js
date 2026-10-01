// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "desktop/*"],
  },
  {
    rules: {
      // React-DOM rule: flags literal ' and " in JSX text. This is a React
      // Native app (text renders fine either way), so it's noise here.
      "react/no-unescaped-entities": "off",
    },
  },
]);
