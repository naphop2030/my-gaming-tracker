// Language switch (English / Thai) for the whole page.
//
// The game is written in English. When Thai is on, this file watches the page and swaps every
// piece of English text it knows for its Thai translation, and swaps it back when Thai is off.
// Translations come from two places:
//   - public/i18n/th-ui.js: screens, menus and the game's messages (with patterns for numbers and names)
//   - public/i18n/th-<adventure>.js: the story text, keyed by a short hash of the English
// Anything without a translation simply stays in English.
(() => {
  'use strict';
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
  let lang = store.get('dnd.lang') === 'th' ? 'th' : 'en';

  // Same hash as scripts/build-thai.js: FNV-1a, 32 bits, as 7 base-36 characters.
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36).padStart(7, '0');
  }

  const T = () => window.I18N_TH || { exact: {}, patterns: [] };
  const content = () => window.I18N_TH_CONTENT || {};
  let compiled = null;
  function patterns() {
    if (!compiled) {
      compiled = (T().patterns || []).map(([re, th]) => [new RegExp(`^${re}$`), th]);
      // Story lines with {name} in them become patterns too.
      for (const [en, th] of Object.entries(window.I18N_TH_NAMED || {})) {
        const re = en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{name\\\}/g, '(.+?)');
        compiled.push([new RegExp(`^${re}$`), th.replace(/\{name\}/g, '$1')]);
      }
    }
    return compiled;
  }

  const cache = new Map();
  // Translate one string (without surrounding spaces). Returns null if nothing is known for it.
  function tr(s, depth = 0) {
    if (!s || depth > 8 || !/[A-Za-z]/.test(s)) return null;
    if (cache.has(s)) return cache.get(s);
    let out = T().exact[s] ?? content()[hash(s)] ?? null;
    if (out === null && T().lower && T().lower[s.toLowerCase()]) out = T().lower[s.toLowerCase()];
    if (out === null) {
      for (const [re, th] of patterns()) {
        const m = s.match(re);
        if (!m) continue;
        // Captured pieces (names of heroes, items, places, monsters) are translated too where known.
        const res = th.replace(/\$(\d)/g, (_, i) => { const part = m[Number(i)] ?? ''; return tr(part, depth + 1) ?? part; });
        if (res !== s) { out = res; break; } // a pattern that changed nothing doesn't count
      }
    }
    // Long texts that join several sentences or story pieces: translate them piece by piece.
    if (out === null && s.length > 40) out = compound(s, depth);
    cache.set(s, out);
    return out;
  }
  function compound(s, depth) {
    for (let i = 20; i < s.length - 2; i++) {
      if (s[i] !== ' ' && s[i] !== '\n') continue;
      const prev = s[i - 1];
      if (!'.!?"”…'.includes(prev)) continue;
      const left = s.slice(0, i);
      const l = T().exact[left] ?? content()[hash(left)];
      if (l == null) continue;
      const rest = s.slice(i).replace(/^\s+/, '');
      const r = tr(rest, depth + 1);
      if (r !== null) return `${l}${s[i] === '\n' ? '\n' : ' '}${r}`;
    }
    return null;
  }
  function translateText(s) {
    if (lang !== 'th') return s;
    const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const t = tr(m[2]);
    return t === null ? s : `${m[1]}${t}${m[3]}`;
  }

  // ---------- applying it to the page ----------
  const ORIGINAL = new WeakMap(); // text node -> its English text
  const SHOWN = new WeakMap(); // text node -> what this file last put in it
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
  let busy = false;

  function doText(node) {
    const p = node.parentNode;
    if (!p || SKIP.has(p.nodeName) || (p.closest && p.closest('[data-no-translate], input'))) return;
    let en = ORIGINAL.get(node);
    // The app changed this text since we last wrote it: that's the new English.
    if (en === undefined || node.data !== SHOWN.get(node)) en = node.data;
    ORIGINAL.set(node, en);
    const want = translateText(en);
    if (node.data !== want) node.data = want;
    SHOWN.set(node, want);
  }
  function doAttrs(el) {
    if (!el.getAttribute) return;
    for (const a of ATTRS) {
      const key = `data-en-${a}`;
      const v = el.getAttribute(a);
      if (v === null) continue;
      let en = el.getAttribute(key);
      if (en === null || v !== el.getAttribute(`data-shown-${a}`)) { en = v; el.setAttribute(key, en); }
      const want = translateText(en);
      if (v !== want) el.setAttribute(a, want);
      el.setAttribute(`data-shown-${a}`, want);
    }
  }
  function walk(root) {
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (SKIP.has(root.nodeName)) return; doAttrs(root); }
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n = it.nextNode();
    while (n) { if (n.nodeType === 3) doText(n); else doAttrs(n); n = it.nextNode(); }
  }
  function apply() {
    busy = true;
    try { walk(document.body); } finally { busy = false; }
    document.documentElement.lang = lang;
    document.documentElement.classList.toggle('lang-th', lang === 'th');
  }
  const observer = new MutationObserver((list) => {
    if (busy) return;
    busy = true;
    try {
      for (const m of list) {
        if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doAttrs(m.target);
        else for (const n of m.addedNodes) walk(n);
      }
    } finally { busy = false; }
  });

  function start() {
    apply();
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.I18N = {
    get lang() { return lang; },
    set(l) {
      lang = l === 'th' ? 'th' : 'en';
      store.set('dnd.lang', lang);
      cache.clear();
      apply();
      window.dispatchEvent(new Event('langchange'));
    },
    t: (s) => translateText(s), // for text the page draws itself (toasts, prompts)
    _hash: hash,
  };
})();
