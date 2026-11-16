'use strict';
// Builds public/i18n/th-<adventure>.js, the Thai translation of an adventure's story text.
//
// The translations live in i18n-src/th-content-*.txt as "index|Thai text" lines, where the index
// is the position of the English string in the list this script extracts from the adventure file
// (run with --list to print that list). Story lines are looked up in the game by a hash of the
// English, so the file the game loads doesn't need the English at all; lines that contain {name}
// are kept as English -> Thai pairs so the hero's name can be swapped in.
//
//   node scripts/build-thai.js            build public/i18n/th-ashen-vale.js
//   node scripts/build-thai.js --list     print the numbered English strings
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const A = require(path.join(root, 'adventures', 'ashen-vale.js'));
const KEYS = new Set(['name', 'desc', 'text', 'label', 'title', 'region', 'tagline', 'lore', 'blurb', 'intro', 'defeat', 'locked', 'verb', 'warn']);

function extract(adv) {
  const out = new Set();
  (function walk(o, k) {
    if (typeof o === 'string') { if (KEYS.has(k)) out.add(o); return; }
    if (!o || typeof o !== 'object') return;
    for (const [kk, v] of Object.entries(o)) {
      if (kk.startsWith('__')) continue; // scenes added at runtime by tests
      walk(v, Array.isArray(o) ? k : kk);
    }
  })(adv, '');
  return [...out];
}

// Same hash as public/i18n.js.
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).padStart(7, '0');
}

const strings = extract(A);
if (process.argv.includes('--list')) {
  strings.forEach((s, i) => console.log(`${i}|${s.replace(/\n/g, '\\n')}`));
  process.exit(0);
}

const th = new Map();
const srcDir = path.join(root, 'i18n-src');
for (const f of fs.readdirSync(srcDir).filter((n) => /^th-content-\d+\.txt$/.test(n)).sort()) {
  for (const line of fs.readFileSync(path.join(srcDir, f), 'utf8').split('\n')) {
    const m = line.match(/^(\d+)\|(.*)$/);
    if (m) th.set(Number(m[1]), m[2].replace(/\\n/g, '\n'));
  }
}

const byHash = {};
const named = {};
const missing = [];
strings.forEach((en, i) => {
  const t = th.get(i);
  if (!t) { missing.push(i); return; }
  if (en.includes('{name}')) named[en] = t;
  else byHash[hash(en)] = t;
});

const outDir = path.join(root, 'public', 'i18n');
fs.mkdirSync(outDir, { recursive: true });
const body = `// Thai translation of "${A.title}" (built by scripts/build-thai.js; edit i18n-src/th-content-*.txt instead).
window.I18N_TH_CONTENT = Object.assign(window.I18N_TH_CONTENT || {}, ${JSON.stringify(byHash)});
window.I18N_TH_NAMED = Object.assign(window.I18N_TH_NAMED || {}, ${JSON.stringify(named, null, 0)});
`;
fs.writeFileSync(path.join(outDir, 'th-ashen-vale.js'), body);
console.log(`${strings.length} strings, ${strings.length - missing.length} translated${missing.length ? `, missing: ${missing.join(', ')}` : ''}.`);
