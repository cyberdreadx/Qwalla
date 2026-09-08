// Print the index of non-embedded software the iOS build links to, for the
// Review Notes Apple requires on every submission (Guideline 4.7.4), and check
// that the shipped bookmark filter still resolves the way the notes claim.
//
// Reads the real ALL_BOOKMARKS list and the real predicate from
// lib/compliance.ts, so it cannot drift from what actually ships.
//
// Usage:
//   node scripts/app-store-dapp-index.js
//
// Exits non-zero if a platform's bookmark index is not what's expected — run it
// before pasting docs/app-store-review-notes.md section 3 into App Store Connect.

const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');
const Module = require('module');

const REPO = path.resolve(__dirname, '..');

// Developer of record for each bundled dApp — Apple asks for these by name.
const DEVELOPERS = {
  qRougee: 'RougeChain Technologies LLC',
  antiReddit: 'RougeChain Technologies LLC',
};

function loadCompliance(osName) {
  const src = fs.readFileSync(path.join(REPO, 'lib/compliance.ts'), 'utf8');
  const { code } = babel.transformSync(src, {
    filename: 'compliance.ts',
    presets: [require.resolve('@babel/preset-typescript')],
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
    babelrc: false,
    configFile: false,
  });

  // Stub react-native so the module's Platform check resolves per platform.
  const origLoad = Module._load;
  Module._load = (req, ...rest) =>
    req === 'react-native' ? { Platform: { OS: osName } } : origLoad(req, ...rest);
  try {
    const m = new Module('compliance');
    m._compile(code, path.join(REPO, 'lib/compliance.js'));
    return m.exports;
  } finally {
    Module._load = origLoad;
  }
}

const browser = fs.readFileSync(path.join(REPO, 'app/(tabs)/browser/index.tsx'), 'utf8');
const block = browser.match(/const ALL_BOOKMARKS: Bookmark\[\] = \[([\s\S]*?)\n\];/);
if (!block) {
  console.error('Could not find ALL_BOOKMARKS in app/(tabs)/browser/index.tsx');
  process.exit(1);
}
const bookmarks = [...block[1].matchAll(/name: '([^']+)', url: '([^']+)'/g)].map(
  ([, name, url]) => ({ name, url }),
);

const listedOn = (os) => {
  const { isBundledBookmarkListed } = loadCompliance(os);
  return bookmarks.filter((b) => isBundledBookmarkListed(b.url));
};

const ios = listedOn('ios');
const everywhereElse = bookmarks.map((b) => b.name);

let failed = false;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(8)} ${actual.join(', ') || '(none)'}`);
  if (!ok) console.log(`      expected: ${expected.join(', ')}`);
};

console.log('Bookmark index by platform\n');
check('ios', ios.map((b) => b.name), ['qRougee', 'antiReddit']);
check('android', listedOn('android').map((b) => b.name), everywhereElse);
check('web', listedOn('web').map((b) => b.name), everywhereElse);

const missing = ios.filter((b) => !DEVELOPERS[b.name]).map((b) => b.name);
if (missing.length) {
  failed = true;
  console.log(`\nFAIL  no developer of record for: ${missing.join(', ')}`);
}

console.log('\n\nGuideline 4.7.4 index — paste into App Store Connect → Review Notes\n');
console.log('| Name | Developer | URL |');
console.log('|---|---|---|');
for (const b of ios) console.log(`| ${b.name} | ${DEVELOPERS[b.name] || '?'} | ${b.url} |`);

process.exit(failed ? 1 : 0);
