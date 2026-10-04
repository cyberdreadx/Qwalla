// Post-export patch for the web build (qwalla.io).
//
// The Expo web export is a single ~4.4MB JS bundle, so until it parses the
// visitor sees a blank page — which reads as "slow" or a timeout. This injects
// two cheap things into dist/index.html, with no effect on the native app:
//
//   1. preconnect hints for the Google Fonts hosts the landing uses.
//   2. an instant, dependency-free loading splash inside #root that paints
//      immediately and removes itself the moment the app renders its first
//      node (MutationObserver), with a timed fallback.
//
// Idempotent: re-running (or re-exporting then running) won't double-inject.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const INDEX = resolve('dist', 'index.html');
const MARKER = 'qw-splash';

if (!existsSync(INDEX)) {
  console.error(`[inject-splash] ${INDEX} not found — did "expo export" run?`);
  process.exit(1);
}

let html = readFileSync(INDEX, 'utf8');

if (html.includes(MARKER)) {
  console.log('[inject-splash] splash already present — skipping.');
  process.exit(0);
}

const preconnect =
  '<link rel="preconnect" href="https://fonts.googleapis.com"/>' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>';

const splash = `<div id="${MARKER}" style="position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:#0A0C10;transition:opacity .35s ease">
<div style="font:700 28px/1 'Space Grotesk',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:-.5px;color:#fff">QWALLA</div>
<div style="width:30px;height:30px;border:3px solid rgba(31,224,197,.25);border-top-color:#1FE0C5;border-radius:50%;animation:qwspin .8s linear infinite"></div>
<style>@keyframes qwspin{to{transform:rotate(360deg)}}</style>
</div>
<script>(function(){var r=document.getElementById('root'),s=document.getElementById('${MARKER}');if(!r||!s)return;function done(){if(!s)return;s.style.opacity='0';setTimeout(function(){s&&s.remove()},400);s=null;}var o=new MutationObserver(function(){for(var i=0;i<r.children.length;i++){if(r.children[i].id!=='${MARKER}'){o.disconnect();done();return;}}});o.observe(r,{childList:true});setTimeout(function(){o.disconnect();done();},15000);})();</script>`;

html = html
  .replace('</head>', `${preconnect}</head>`)
  .replace('<div id="root">', `<div id="root">${splash}`);

writeFileSync(INDEX, html, 'utf8');
console.log('[inject-splash] injected preconnect + loading splash into dist/index.html');
