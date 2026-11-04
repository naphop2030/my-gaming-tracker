// Location artwork for adventure mode, drawn as layered SVG "cut paper" scenes.
// Each scene is a function (mood) => SVG markup, at 1600 x 600, meant to be cropped to fit.
// mood is 'ash' (the Vale under falling ash) or 'clear' (after the bell rings).
// Want real pictures instead? Give a location an `image` in the adventure file.
(() => {
  'use strict';

  const W = 1600;
  const H = 600;

  // Small seeded random generator so every scene draws the same way each time.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const f = (n) => Math.round(n * 10) / 10;

  const PALETTES = {
    ash: { top: '#2e2622', bottom: '#9a7356', glow: '#e9a35c', far: '#6e5848', mid: '#4b3c32', near: '#2d231d', front: '#16110e', light: '#ffc46b', fog: '#b59a82', water: '#5d4a3c' },
    clear: { top: '#203a5c', bottom: '#e8b583', glow: '#ffe0a8', far: '#5f7189', mid: '#3e4c5e', near: '#252f3b', front: '#11161c', light: '#ffd27a', fog: '#c9d3df', water: '#55708c' },
  };

  // ---------- building blocks ----------
  function defs(id, p) {
    return `<defs>
      <linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.top}"/><stop offset="1" stop-color="${p.bottom}"/></linearGradient>
      <radialGradient id="${id}-glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${p.glow}" stop-opacity=".85"/><stop offset="1" stop-color="${p.glow}" stop-opacity="0"/></radialGradient>
      <radialGradient id="${id}-lamp" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${p.light}" stop-opacity=".7"/><stop offset="1" stop-color="${p.light}" stop-opacity="0"/></radialGradient>
      <linearGradient id="${id}-shade" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>
      <filter id="${id}-blur" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>
      <filter id="${id}-soft"><feGaussianBlur stdDeviation="3"/></filter>
    </defs>`;
  }
  const sky = (id, sunX = 1100, sunY = 330, sunR = 260) =>
    `<rect width="${W}" height="${H}" fill="url(#${id}-sky)"/><ellipse cx="${sunX}" cy="${sunY}" rx="${sunR * 1.6}" ry="${sunR}" fill="url(#${id}-glow)"/>`;

  // A hill/mountain silhouette across the whole width.
  function ridge(r, base, amp, rough, color, opts = {}) {
    const step = opts.step || 40;
    let d = `M0 ${H} L0 ${f(base)}`;
    let y = base;
    for (let x = 0; x <= W + step; x += step) {
      const wave = Math.sin(x / (opts.wave || 260) + (opts.phase || 0)) * amp;
      y = base - wave - (r() - 0.5) * rough;
      d += ` L${x} ${f(y)}`;
    }
    d += ` L${W} ${H} Z`;
    return `<path d="${d}" fill="${color}"/>`;
  }

  function pine(x, y, h, color) {
    const w = h * 0.36;
    return `<path d="M${f(x)} ${f(y - h)} L${f(x + w * 0.5)} ${f(y - h * 0.55)} L${f(x + w * 0.3)} ${f(y - h * 0.55)} L${f(x + w * 0.7)} ${f(y - h * 0.2)} L${f(x + w * 0.45)} ${f(y - h * 0.2)} L${f(x + w * 0.8)} ${f(y)} L${f(x - w * 0.8)} ${f(y)} L${f(x - w * 0.45)} ${f(y - h * 0.2)} L${f(x - w * 0.7)} ${f(y - h * 0.2)} L${f(x - w * 0.3)} ${f(y - h * 0.55)} L${f(x - w * 0.5)} ${f(y - h * 0.55)} Z" fill="${color}"/>`;
  }
  function roundTree(x, y, h, color, r) {
    const cr = h * 0.32;
    let s = `<rect x="${f(x - h * 0.03)}" y="${f(y - h * 0.45)}" width="${f(h * 0.06)}" height="${f(h * 0.45)}" fill="${color}"/>`;
    for (let i = 0; i < 4; i++) s += `<circle cx="${f(x + (r() - 0.5) * cr * 1.2)}" cy="${f(y - h * 0.6 - r() * cr * 0.8)}" r="${f(cr * (0.6 + r() * 0.5))}" fill="${color}"/>`;
    return s;
  }
  function deadTree(x, y, h, color, r) {
    let s = `<path d="M${f(x - h * 0.04)} ${y} L${f(x - h * 0.015)} ${f(y - h)} L${f(x + h * 0.015)} ${f(y - h)} L${f(x + h * 0.04)} ${y} Z" fill="${color}"/>`;
    for (let i = 0; i < 6; i++) {
      const by = y - h * (0.35 + r() * 0.6);
      const dir = r() < 0.5 ? -1 : 1;
      const len = h * (0.15 + r() * 0.25);
      s += `<path d="M${x} ${f(by)} q${f(dir * len * 0.5)} ${f(-len * 0.2)} ${f(dir * len)} ${f(-len * 0.6)}" stroke="${color}" stroke-width="${f(h * 0.018)}" fill="none" stroke-linecap="round"/>`;
    }
    return s;
  }
  function forest(r, n, y0, y1, hMin, hMax, color, kind = 'pine') {
    let s = '';
    for (let i = 0; i < n; i++) {
      const x = r() * (W + 100) - 50;
      const y = y0 + r() * (y1 - y0);
      const h = hMin + r() * (hMax - hMin);
      s += kind === 'pine' ? pine(x, y, h, color) : kind === 'dead' ? deadTree(x, y, h, color, r) : roundTree(x, y, h, color, r);
    }
    return s;
  }
  const fog = (id, y, color, opacity = 0.35, h = 60) =>
    `<ellipse cx="${W / 2}" cy="${y}" rx="${W * 0.7}" ry="${h}" fill="${color}" opacity="${opacity}" filter="url(#${id}-blur)"/>`;
  const lamp = (id, x, y, r = 40) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${id}-lamp)"/>`;

  function house(id, x, y, w, h, color, light, r, opts = {}) {
    const roof = h * (0.7 + r() * 0.3);
    let s = `<path d="M${f(x - 6)} ${f(y - h)} L${f(x + w / 2)} ${f(y - h - roof)} L${f(x + w + 6)} ${f(y - h)} Z" fill="${color}"/>`;
    s += `<rect x="${x}" y="${f(y - h)}" width="${w}" height="${h}" fill="${color}"/>`;
    if (r() < 0.8) s += `<rect x="${f(x + w * 0.7)}" y="${f(y - h - roof * 0.9)}" width="${f(w * 0.12)}" height="${f(roof * 0.6)}" fill="${color}"/>`;
    if (opts.windows !== false) {
      const wx = x + w * (0.2 + r() * 0.4);
      const wy = y - h * 0.65;
      if (r() < 0.85) s += lamp(id, wx + 5, wy + 6, 26) + `<rect x="${f(wx)}" y="${f(wy)}" width="10" height="12" fill="${light}"/>`;
    }
    return s;
  }

  function wrap(id, mood, body) {
    const p = PALETTES[mood] || PALETTES.ash;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${defs(id, p)}${body(p)}<rect width="${W}" height="${H}" fill="url(#${id}-shade)"/></svg>`;
  }

  // ---------- scenes ----------
  const SCENES = {
    thornwick: (mood) => wrap('sc-thorn', mood, (p) => {
      const r = rng(11);
      let s = sky('sc-thorn', 1180, 300);
      s += ridge(r, 330, 40, 30, p.far, { wave: 300 });
      s += ridge(r, 390, 30, 18, p.mid, { wave: 220, phase: 2 });
      s += forest(r, 26, 395, 420, 40, 70, p.mid, 'round');
      // village hill
      s += `<path d="M0 ${H} L0 470 Q 400 400 800 420 Q 1200 440 1600 470 L1600 ${H} Z" fill="${p.near}"/>`;
      // church spire
      s += `<rect x="760" y="300" width="50" height="130" fill="${p.near}"/><path d="M752 302 L785 210 L818 302 Z" fill="${p.near}"/><rect x="777" y="240" width="8" height="30" fill="${p.light}" opacity=".7"/>`;
      const spots = [[420, 440], [500, 432], [585, 428], [655, 432], [860, 432], [930, 428], [1010, 436], [1090, 444], [1180, 452], [330, 452]];
      for (const [x, y] of spots) s += house('sc-thorn', x, y, 50 + r() * 30, 34 + r() * 18, p.near, p.light, r);
      // fields in front
      s += `<path d="M0 ${H} L0 520 Q800 470 1600 520 L1600 ${H} Z" fill="${p.front}"/>`;
      for (let i = 0; i < 9; i++) s += `<path d="M${-200 + i * 220} ${H} L${700 + i * 30} 505" stroke="${p.near}" stroke-width="5" opacity=".7"/>`;
      // lantern posts
      s += `<rect x="250" y="470" width="5" height="80" fill="${p.front}"/>${lamp('sc-thorn', 252, 470, 34)}<rect x="246" y="463" width="12" height="12" fill="${p.light}"/>`;
      s += `<rect x="1350" y="478" width="5" height="80" fill="${p.front}"/>${lamp('sc-thorn', 1352, 478, 34)}<rect x="1346" y="471" width="12" height="12" fill="${p.light}"/>`;
      s += fog('sc-thorn', 470, p.fog, 0.18);
      return s;
    }),

    'old-road': (mood) => wrap('sc-road', mood, (p) => {
      const r = rng(23);
      let s = sky('sc-road', 800, 260, 300);
      s += ridge(r, 260, 70, 60, p.far, { wave: 200, step: 30 });
      // the abbey, tiny, on the far peak
      s += `<g fill="${p.far}" opacity=".95"><rect x="770" y="150" width="70" height="40"/><rect x="820" y="105" width="20" height="60"/><path d="M816 107 L830 80 L844 107 Z"/><path d="M765 152 L805 128 L845 152 Z"/></g>`;
      s += `<path d="M560 330 L700 230 L760 186 L860 186 L920 236 L1060 330 Z" fill="${p.far}"/>`;
      s += ridge(r, 380, 45, 30, p.mid, { wave: 280, phase: 1 });
      s += ridge(r, 450, 25, 20, p.near, { wave: 180, phase: 3 });
      // the road
      s += `<path d="M560 ${H} C 700 520, 900 480, 790 420 C 720 385, 800 360, 805 340 L 815 340 C 820 362, 760 390, 830 420 C 960 480, 1000 540, 1060 ${H} Z" fill="${p.mid}" opacity=".9"/>`;
      s += `<path d="M560 ${H} C 700 520, 900 480, 790 420" stroke="${p.front}" stroke-width="3" fill="none" opacity=".5"/>`;
      // leaning waystone and signpost
      s += `<path d="M420 ${H - 30} L455 360 Q472 345 490 360 L512 ${H - 30} Z" fill="${p.front}" transform="rotate(-6 466 500)"/>`;
      s += `<rect x="1160" y="400" width="10" height="170" fill="${p.front}"/><path d="M1100 420 L1230 410 L1245 425 L1230 440 L1100 450 Z" fill="${p.front}"/><path d="M1240 470 L1110 462 L1095 476 L1110 490 L1240 496 Z" fill="${p.front}"/>`;
      s += `<path d="M0 ${H} L0 540 Q400 510 800 560 Q1200 520 1600 545 L1600 ${H} Z" fill="${p.front}"/>`;
      for (let i = 0; i < 40; i++) { const x = r() * W; const y = 530 + r() * 60; s += `<path d="M${f(x)} ${f(y)} l-6 -22 M${f(x)} ${f(y)} l2 -26 M${f(x)} ${f(y)} l8 -20" stroke="${p.front}" stroke-width="3"/>`; }
      s += fog('sc-road', 430, p.fog, 0.28, 50);
      return s;
    }),

    whisperwood: (mood) => wrap('sc-wood', mood, (p) => {
      const r = rng(37);
      let s = sky('sc-wood', 700, 200, 240);
      s += forest(r, 60, 300, 330, 180, 260, p.far, 'pine');
      s += fog('sc-wood', 300, p.fog, 0.3, 80);
      // light shafts
      for (let i = 0; i < 5; i++) { const x = 300 + i * 260 + r() * 80; s += `<path d="M${f(x)} 0 L${f(x + 60)} 0 L${f(x + 260)} ${H} L${f(x + 140)} ${H} Z" fill="${p.glow}" opacity=".07"/>`; }
      s += forest(r, 40, 400, 440, 220, 320, p.mid, 'pine');
      s += forest(r, 9, 560, 590, 260, 340, p.near, 'pine');
      // big trunks in front with webs
      s += `<path d="M120 ${H} L150 0 L230 0 L250 ${H} Z" fill="${p.front}"/><path d="M1390 ${H} L1420 0 L1490 0 L1520 ${H} Z" fill="${p.front}"/>`;
      let web = '';
      const cx = 1300;
      const cy = 210;
      for (let a = 0; a < 12; a++) { const ang = (a / 12) * Math.PI * 2; web += `<line x1="${cx}" y1="${cy}" x2="${f(cx + Math.cos(ang) * 130)}" y2="${f(cy + Math.sin(ang) * 130)}"/>`; }
      for (let k = 1; k <= 5; k++) web += `<circle cx="${cx}" cy="${cy}" r="${k * 25}" fill="none"/>`;
      s += `<g stroke="#e8e0d0" stroke-width="1.4" opacity=".28">${web}<line x1="${cx + 130}" y1="${cy}" x2="1420" y2="140"/><line x1="${cx}" y1="${cy - 130}" x2="1300" y2="0"/></g>`;
      s += `<path d="M0 ${H} L0 560 Q800 520 1600 560 L1600 ${H} Z" fill="${p.front}"/>`;
      for (let i = 0; i < 30; i++) { const x = r() * W; s += `<path d="M${f(x)} ${H} q -20 -40 -40 -50 M${f(x)} ${H} q 5 -50 0 -60 M${f(x)} ${H} q 20 -40 40 -46" stroke="${p.front}" stroke-width="4" fill="none"/>`; }
      return s;
    }),

    hollow: (mood) => wrap('sc-hollow', mood, (p) => {
      const r = rng(41);
      let s = sky('sc-hollow', 400, 280, 250);
      s += ridge(r, 300, 60, 30, p.far, { wave: 240 });
      s += ridge(r, 380, 50, 20, p.mid, { wave: 200, phase: 1.5 });
      s += `<path d="M0 ${H} L0 470 Q 500 380 900 430 Q 1300 480 1600 440 L1600 ${H} Z" fill="${p.near}"/>`;
      // crooked cottage
      s += `<g fill="${p.front}" transform="rotate(-3 820 430)">
        <rect x="700" y="340" width="230" height="110"/>
        <path d="M680 345 Q 700 300 820 255 Q 930 300 955 345 Z"/>
        <path d="M880 290 L880 240 Q 870 225 885 215 L 915 215 Q 930 225 920 240 L920 300 Z"/>
        <path d="M915 222 q 18 -6 22 -22" stroke="${p.front}" stroke-width="7" fill="none"/>
        <ellipse cx="900" cy="212" rx="14" ry="5"/>
      </g>`;
      s += lamp('sc-hollow', 760, 395, 50) + `<rect x="745" y="380" width="26" height="26" rx="4" fill="${p.light}" transform="rotate(-3 820 430)"/>`;
      s += `<rect x="830" y="385" width="34" height="62" fill="${p.near}" transform="rotate(-3 820 430)"/>`;
      // herbs hanging from the eaves
      for (let i = 0; i < 7; i++) s += `<path d="M${710 + i * 30} 346 l0 ${14 + r() * 14}" stroke="${p.front}" stroke-width="5" stroke-linecap="round"/>`;
      // goat
      s += `<g fill="${p.front}"><ellipse cx="1130" cy="470" rx="46" ry="24"/><rect x="1095" y="480" width="7" height="40"/><rect x="1110" y="482" width="7" height="38"/><rect x="1145" y="482" width="7" height="38"/><rect x="1160" y="480" width="7" height="40"/><path d="M1165 460 L1195 430 L1210 440 L1200 470 Z"/><path d="M1195 432 q 10 -26 -6 -36" stroke="${p.front}" stroke-width="5" fill="none"/><path d="M1205 470 l4 16" stroke="${p.front}" stroke-width="5"/></g>`;
      for (const x of [90, 250, 430, 1350, 1500]) s += roundTree(x, 470 + r() * 20, 140 + r() * 60, p.near, r);
      s += `<path d="M0 ${H} L0 545 Q800 505 1600 550 L1600 ${H} Z" fill="${p.front}"/>`;
      return s;
    }),

    watchtower: (mood) => wrap('sc-tower', mood, (p) => {
      const r = rng(53);
      let s = sky('sc-tower', 1250, 260, 260);
      s += ridge(r, 330, 50, 40, p.far, { wave: 230 });
      s += `<path d="M0 ${H} L0 430 Q 500 260 900 300 Q 1300 340 1600 420 L1600 ${H} Z" fill="${p.mid}"/>`;
      // broken tower
      s += `<path fill="${p.near}" d="M640 330 L650 120 L670 112 L690 90 L700 104 L720 70 L735 98 L760 84 L770 110 L790 120 L800 330 Z"/>`;
      s += `<rect x="700" y="160" width="14" height="30" fill="${p.light}" opacity=".6"/><rect x="740" y="230" width="12" height="26" fill="${p.mid}"/>`;
      // red rag banners
      s += `<path d="M735 98 L735 30" stroke="${p.near}" stroke-width="5"/><path d="M736 32 q 40 6 70 -4 q -18 14 -6 26 q -34 6 -64 -2 Z" fill="#a8322c"/>`;
      s += `<path d="M650 140 L590 160 L600 130 Z" fill="#a8322c" opacity=".85"/>`;
      // camp: tents and fire
      s += `<path d="M0 ${H} L0 470 Q 600 410 1000 430 Q 1300 450 1600 480 L1600 ${H} Z" fill="${p.near}"/>`;
      s += `<path d="M880 440 L940 360 L1000 440 Z M1030 446 L1080 380 L1130 446 Z M500 446 L550 380 L600 446 Z" fill="${p.front}"/>`;
      s += `<circle cx="770" cy="420" r="120" fill="url(#sc-tower-lamp)"/><path d="M745 440 q 10 -40 25 -55 q 0 25 12 30 q 4 -14 0 -24 q 22 20 14 49 Z" fill="${p.light}"/><path d="M735 445 L805 445" stroke="${p.front}" stroke-width="6"/>`;
      s += `<path d="M0 ${H} L0 540 Q800 500 1600 545 L1600 ${H} Z" fill="${p.front}"/>`;
      return s;
    }),

    greyfen: (mood) => wrap('sc-fen', mood, (p) => {
      const r = rng(67);
      let s = sky('sc-fen', 600, 320, 300);
      s += ridge(r, 360, 12, 10, p.far, { wave: 400 });
      // water with reflections
      s += `<rect x="0" y="380" width="${W}" height="${H - 380}" fill="${p.water}"/>`;
      for (let i = 0; i < 22; i++) { const y = 395 + r() * 180; const x = r() * W; s += `<rect x="${f(x)}" y="${f(y)}" width="${f(60 + r() * 220)}" height="2" fill="${p.glow}" opacity="${f(0.08 + r() * 0.12)}"/>`; }
      s += `<ellipse cx="600" cy="420" rx="320" ry="30" fill="${p.glow}" opacity=".12" filter="url(#sc-fen-blur)"/>`;
      // islands with dead trees
      s += `<path d="M120 400 Q 300 370 520 400 Z M980 405 Q 1150 380 1360 405 Z" fill="${p.mid}"/>`;
      s += deadTree(300, 395, 190, p.mid, r) + deadTree(1180, 400, 230, p.mid, r) + deadTree(1290, 405, 150, p.mid, r);
      s += fog('sc-fen', 400, p.fog, 0.35, 45);
      // wisps
      for (const [x, y] of [[720, 330], [860, 300], [1010, 345]]) s += `<circle cx="${x}" cy="${y}" r="38" fill="url(#sc-fen-lamp)"/><circle cx="${x}" cy="${y}" r="5" fill="#e8f6ff"/>`;
      // reeds in front
      s += `<path d="M0 ${H} L0 540 Q800 520 1600 545 L1600 ${H} Z" fill="${p.front}"/>`;
      for (let i = 0; i < 70; i++) { const x = r() * W; const h = 60 + r() * 110; s += `<path d="M${f(x)} ${H} q ${f((r() - 0.5) * 30)} ${f(-h / 2)} ${f((r() - 0.5) * 40)} ${f(-h)}" stroke="${p.front}" stroke-width="${f(2 + r() * 3)}" fill="none"/>`; if (r() < 0.25) s += `<ellipse cx="${f(x + 2)}" cy="${f(H - h + 10)}" rx="4" ry="13" fill="${p.front}"/>`; }
      return s;
    }),

    crypt: (mood) => wrap('sc-crypt', mood, (p) => {
      const stone = mood === 'clear' ? '#2c3a3f' : '#2b2a2c';
      const dark = '#121517';
      let s = `<rect width="${W}" height="${H}" fill="${dark}"/>`;
      // receding arches
      for (let i = 0; i < 5; i++) {
        const k = 1 - i * 0.17;
        const w = 1200 * k;
        const h = 520 * k;
        const x = (W - w) / 2;
        const y = 560 - h;
        const shade = i === 0 ? '#0d1012' : i === 1 ? '#161a1d' : '#1d2226';
        s += `<path d="M${f(x)} 600 L${f(x)} ${f(y + w * 0.25)} Q ${f(W / 2)} ${f(y - w * 0.18)} ${f(x + w)} ${f(y + w * 0.25)} L${f(x + w)} 600 L${f(x + w - 60 * k)} 600 L${f(x + w - 60 * k)} ${f(y + w * 0.27)} Q ${f(W / 2)} ${f(y - w * 0.08)} ${f(x + 60 * k)} ${f(y + w * 0.27)} L${f(x + 60 * k)} 600 Z" fill="${shade}"/>`;
      }
      s += `<rect x="0" y="0" width="${W}" height="${H}" fill="${stone}" opacity=".25"/>`;
      for (const [x, w] of [[120, 70], [1410, 70], [330, 46], [1224, 46], [500, 30], [1070, 30]]) {
        s += `<rect x="${x}" y="40" width="${w}" height="520" fill="#0b0e10"/><rect x="${x - 8}" y="40" width="${w + 16}" height="18" fill="#0b0e10"/><rect x="${x - 8}" y="540" width="${w + 16}" height="20" fill="#0b0e10"/>`;
      }
      // statue holding a bell
      s += `<g fill="#0b0d0e"><rect x="760" y="430" width="80" height="80"/><path d="M770 432 Q 765 330 800 300 Q 835 330 830 432 Z"/><circle cx="800" cy="285" r="22"/><path d="M780 360 q 20 30 40 0 l 6 20 q -26 34 -52 0 Z"/></g>`;
      // tombs with effigies
      s += `<g fill="#0a0c0d"><rect x="220" y="470" width="300" height="70"/><path d="M240 470 q 130 -40 260 0 Z"/><rect x="1080" y="470" width="300" height="70"/><path d="M1100 470 q 130 -40 260 0 Z"/></g>`;
      // candles
      for (const [x, y] of [[300, 465], [460, 465], [1150, 465], [1310, 465], [760, 425], [840, 425]]) s += `<circle cx="${x}" cy="${y - 14}" r="46" fill="url(#sc-crypt-lamp)"/><rect x="${x - 3}" y="${y - 14}" width="6" height="14" fill="#d8cfbd"/><ellipse cx="${x}" cy="${y - 19}" rx="3" ry="6" fill="${p.light}"/>`;
      // floor water
      s += `<rect x="0" y="540" width="${W}" height="60" fill="#0d1416"/><rect x="200" y="556" width="400" height="2" fill="${p.light}" opacity=".15"/><rect x="980" y="566" width="380" height="2" fill="${p.light}" opacity=".12"/>`;
      return s;
    }),

    abbey: (mood) => wrap('sc-abbey', mood, (p) => {
      const r = rng(83);
      let s = sky('sc-abbey', 820, 160, 280);
      s += ridge(r, 380, 40, 30, p.far, { wave: 260 });
      s += `<path d="M0 ${H} L0 470 L300 440 L420 330 L1180 330 L1300 440 L1600 470 L1600 ${H} Z" fill="${p.mid}"/>`;
      // the abbey
      s += `<g fill="${p.near}">
        <rect x="440" y="230" width="720" height="110"/>
        <path d="M430 234 L800 150 L1170 234 Z"/>
        <rect x="740" y="40" width="120" height="300"/>
        <path d="M730 44 L800 -30 L870 44 Z"/>
        <rect x="470" y="190" width="40" height="60"/><path d="M465 192 L490 160 L515 192 Z"/>
        <rect x="1090" y="190" width="40" height="60"/><path d="M1085 192 L1110 160 L1135 192 Z"/>
      </g>`;
      // belfry opening with the great bell
      const bellGlow = mood === 'clear' ? '#ffe7b0' : '#ff7a3a';
      s += `<path d="M765 70 L765 150 L835 150 L835 70 Q 800 45 765 70 Z" fill="${mood === 'clear' ? p.glow : '#3a160c'}" opacity=".9"/>`;
      s += `<path d="M780 90 Q 800 76 820 90 L826 135 L774 135 Z" fill="${p.front}"/><circle cx="800" cy="139" r="5" fill="${p.front}"/>`;
      // rose window and lit windows
      s += `<circle cx="800" cy="215" r="42" fill="${bellGlow}" opacity=".55"/><circle cx="800" cy="215" r="70" fill="url(#sc-abbey-lamp)"/>`;
      for (let i = 0; i < 6; i++) s += `<path d="M${f(510 + i * 110)} 320 L${f(510 + i * 110)} 270 Q ${f(525 + i * 110)} 252 ${f(540 + i * 110)} 270 L${f(540 + i * 110)} 320 Z" fill="${i === 2 || i === 3 ? p.near : bellGlow}" opacity="${i === 2 || i === 3 ? 1 : 0.35}"/>`;
      s += `<path d="M0 ${H} L0 500 L400 470 L1200 470 L1600 500 L1600 ${H} Z" fill="${p.front}"/>`;
      // courtyard wall with gate
      s += `<path d="M300 520 L300 470 L1300 470 L1300 520 Z" fill="${p.front}"/><path d="M720 520 L720 450 Q 800 400 880 450 L880 520 Z" fill="${p.near}"/>`;
      for (let i = 0; i < 20; i++) s += `<rect x="${300 + i * 50}" y="456" width="26" height="16" fill="${p.front}"/>`;
      s += fog('sc-abbey', 470, p.fog, 0.22, 40);
      return s;
    }),
  };

  // Generic hills for places without their own picture.
  SCENES.default = (mood) => wrap('sc-def', mood, (p) => {
    const r = rng(97);
    return sky('sc-def') + ridge(r, 320, 50, 40, p.far) + ridge(r, 400, 40, 20, p.mid, { phase: 2 }) + forest(r, 20, 430, 470, 80, 140, p.near, 'round') + ridge(r, 500, 20, 10, p.front, { phase: 4 });
  });

  window.SCENES = SCENES;
})();
