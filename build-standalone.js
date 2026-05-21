#!/usr/bin/env node
// Build a single self-contained HTML file with data.js, app.js, and TG JSON
// data inlined. Works offline via file:// (no local server, no git, no Node).

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const data = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const cableGeo = fs.readFileSync(path.join(ROOT, 'tg/cable-geo.json'), 'utf8');
const landingGeo = fs.readFileSync(path.join(ROOT, 'tg/landing-geo.json'), 'utf8');

// Replace fetch(tg/...) with embedded objects so file:// works
const patchedApp = app.replace(
  /const \[cgRes, lgRes\] = await Promise\.all\(\[[\s\S]*?\]\);[\s\S]*?const lg = await lgRes\.json\(\);/,
  `const cg = window.__TG_CABLE_GEO__;\n    const lg = window.__TG_LANDING_GEO__;`
);

const inlined = html
  .replace('<script src="data.js"></script>', `<script>\n${data}\n</script>`)
  .replace('<script src="app.js"></script>', `<script>\nwindow.__TG_CABLE_GEO__ = ${cableGeo};\nwindow.__TG_LANDING_GEO__ = ${landingGeo};\n${patchedApp}\n</script>`);

const outPath = path.join(ROOT, 'tti-benchmark-standalone.html');
fs.writeFileSync(outPath, inlined);
console.log(`Built: ${outPath}`);
console.log(`Size: ${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB`);
