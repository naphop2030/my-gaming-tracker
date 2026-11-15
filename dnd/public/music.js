// Original background music, composed live in the browser (no audio files, nothing to license).
// Each theme has a mode, tempo, chord progression and band: pad, harp, lute, bass, bells and drums.
// Melodies are built from short motifs that repeat and vary, so they sound like tunes, not noise.
(() => {
  'use strict';
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };
  const MODES = {
    ionian: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10],
    harmonic: [0, 2, 3, 5, 7, 8, 11],
  };
  // prog: chord roots as scale degrees (0-based), one per bar.
  const THEMES = {
    title: { bpm: 76, root: 50, mode: 'dorian', prog: [0, 6, 3, 4], pad: 0.5, harp: 'arp', lute: 'melody', bass: 0.5, bells: 0.15, drums: 0, density: 0.5 },
    town: { bpm: 100, root: 55, mode: 'mixolydian', prog: [0, 3, 6, 0, 0, 3, 4, 0], pad: 0.35, harp: 'arp', lute: 'melody', bass: 0.6, bells: 0, drums: 'folk', density: 0.65 },
    wild: { bpm: 72, root: 57, mode: 'aeolian', prog: [0, 5, 2, 6], pad: 0.55, harp: 'sparse', lute: 'sparse', bass: 0.4, bells: 0.1, drums: 0, density: 0.35 },
    dark: { bpm: 58, root: 52, mode: 'phrygian', prog: [0, 1, 0, 6], pad: 0.6, harp: 0, lute: 0, bass: 0.6, bells: 0.5, drums: 'heart', density: 0.25 },
    clear: { bpm: 92, root: 53, mode: 'lydian', prog: [0, 1, 4, 0], pad: 0.4, harp: 'arp', lute: 'melody', bass: 0.5, bells: 0.2, drums: 'folk', density: 0.6 },
    battle: { bpm: 138, root: 50, mode: 'aeolian', prog: [0, 0, 5, 6, 0, 0, 3, 4], pad: 0.3, harp: 0, lute: 'riff', bass: 0.9, bells: 0, drums: 'battle', density: 0.8 },
    boss: { bpm: 150, root: 48, mode: 'harmonic', prog: [0, 0, 5, 4, 0, 1, 5, 4], pad: 0.45, harp: 0, lute: 'riff', bass: 1, bells: 0.3, drums: 'boss', density: 0.85 },
  };

  let ctx = null;
  let master = null;
  let reverb = null;
  let bus = null; // current theme's gain (for crossfades)
  let theme = null;
  let want = 'title';
  let timer = null;
  let step = 0;
  let nextTime = 0;
  let rng = null;
  let motif = null;
  let enabled = store.get('dnd.music') !== '0';
  let volume = Number(store.get('dnd.musicVol') || 0.32);

  function mulberry(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  function init() {
    if (ctx) return true;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return false; }
    master = ctx.createGain();
    master.gain.value = enabled ? volume : 0;
    master.connect(ctx.destination);
    // A soft hall reverb from generated noise.
    reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.6;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    reverb.connect(wet).connect(master);
    return true;
  }

  // ---------- instruments ----------
  function out(g, rev = 0.35) {
    g.connect(bus);
    if (rev) { const s = ctx.createGain(); s.gain.value = rev; g.connect(s).connect(reverb); }
  }
  function env(g, t, a, peak, d, sustain = 0) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001), t + a + d);
  }
  function pad(midis, t, dur, vol) {
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(g);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * 0.06, t + 0.8);
    g.gain.setValueAtTime(vol * 0.06, t + dur - 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
    for (const m of midis) {
      for (const [type, det] of [['triangle', -6], ['sawtooth', 7]]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = freq(m);
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = type === 'sawtooth' ? 0.35 : 1;
        o.connect(og).connect(lp);
        o.start(t);
        o.stop(t + dur + 0.7);
      }
    }
    out(g, 0.6);
  }
  function pluck(m, t, vol, bright = 2600, decay = 0.7) {
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(bright, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + decay);
    for (const [type, mult, gv] of [['triangle', 1, 1], ['square', 1, 0.18], ['sine', 2, 0.25]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq(m) * mult;
      const og = ctx.createGain();
      og.gain.value = gv;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + decay + 0.1);
    }
    lp.connect(g);
    env(g, t, 0.004, vol * 0.16, decay);
    out(g, 0.35);
  }
  function harp(m, t, vol) {
    const g = ctx.createGain();
    for (const [mult, gv] of [[1, 1], [2, 0.3], [3, 0.08]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq(m) * mult;
      const og = ctx.createGain();
      og.gain.value = gv;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 1.6);
    }
    env(g, t, 0.006, vol * 0.11, 1.5);
    out(g, 0.5);
  }
  function bass(m, t, dur, vol) {
    const g = ctx.createGain();
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq(m);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
    env(g, t, 0.01, vol * 0.2, dur);
    out(g, 0.1);
  }
  function bell(m, t, vol) {
    const g = ctx.createGain();
    for (const [mult, gv] of [[1, 1], [2.76, 0.4], [5.4, 0.2]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq(m) * mult;
      const og = ctx.createGain();
      og.gain.value = gv;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 3);
    }
    env(g, t, 0.005, vol * 0.08, 2.8);
    out(g, 0.8);
  }
  let noiseBuf = null;
  function noise(t, dur, vol, type, f, q = 1) {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    fl.Q.value = q;
    const g = ctx.createGain();
    env(g, t, 0.002, vol, dur);
    s.connect(fl).connect(g);
    out(g, 0.15);
    s.start(t);
    s.stop(t + dur + 0.05);
  }
  function drum(t, vol, hi = 140, lo = 55, dur = 0.35) {
    const g = ctx.createGain();
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(hi, t);
    o.frequency.exponentialRampToValueAtTime(lo, t + dur);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
    env(g, t, 0.003, vol * 0.5, dur);
    out(g, 0.15);
    noise(t, 0.05, vol * 0.08, 'lowpass', 1800);
  }

  // ---------- composition ----------
  function scaleNote(T, degree, octave = 0) {
    const sc = MODES[T.mode];
    const n = ((degree % 7) + 7) % 7;
    const oct = Math.floor(degree / 7);
    return T.root + sc[n] + 12 * (oct + octave);
  }
  function chordOf(T, deg) { return [scaleNote(T, deg), scaleNote(T, deg + 2), scaleNote(T, deg + 4)]; }

  // A motif: rhythm (16 steps) + scale-degree offsets; phrases go A A' B A.
  function makeMotif(T, r) {
    const rhythm = [];
    const notes = [];
    let deg = Math.floor(r() * 3) * 2;
    for (let s = 0; s < 16; s++) {
      const strong = s % 4 === 0;
      const play = strong ? r() < 0.85 : r() < T.density * (s % 2 === 0 ? 0.6 : 0.3);
      rhythm.push(play);
      if (play) { deg += Math.round((r() - 0.5) * 4); deg = Math.max(-2, Math.min(9, deg)); }
      notes.push(deg);
    }
    return { rhythm, notes };
  }

  function scheduleStep(T, s, t) {
    const sec16 = 60 / T.bpm / 4;
    const bar = Math.floor(s / 16);
    const inBar = s % 16;
    const deg = T.prog[bar % T.prog.length];
    const chord = chordOf(T, deg);
    if (inBar === 0) {
      if (T.pad) pad(chord.map((m) => m - 12), t, sec16 * 16, T.pad);
      if (T.bells && rng() < T.bells) bell(chord[Math.floor(rng() * 3)] + 12, t + sec16 * 8 * Math.floor(rng() * 2), 1);
      if (bar % 4 === 0) motif = makeMotif(T, rng);
    }
    // bass
    if (T.bass) {
      if (T.drums === 'battle' || T.drums === 'boss') { if (inBar % 2 === 0) bass(chord[0] - 24 + (inBar % 8 === 6 ? 7 : 0), t, sec16 * 1.6, T.bass); } else if (inBar === 0 || inBar === 8) bass(chord[0] - 24, t, sec16 * 7, T.bass);
    }
    // harp
    if (T.harp === 'arp' && inBar % 2 === 0) {
      const idx = [0, 1, 2, 1, 0, 2, 1, 2][(inBar / 2) % 8];
      harp(chord[idx] + 12, t, 0.8);
    } else if (T.harp === 'sparse' && inBar % 4 === 0 && rng() < 0.6) harp(chord[Math.floor(rng() * 3)] + 12, t, 0.9);
    // lute melody / riff
    if (T.lute && motif) {
      const phraseBar = bar % 4;
      const variant = phraseBar === 2 ? 2 : phraseBar === 1 ? 1 : 0; // A A' B A
      let play = motif.rhythm[inBar];
      let d = motif.notes[inBar] + (variant === 2 ? 2 : 0) + (variant === 1 && inBar >= 12 ? -1 : 0);
      if (T.lute === 'sparse') play = play && inBar % 4 === 0 && rng() < 0.7;
      if (T.lute === 'riff') { play = inBar % 2 === 0 || motif.rhythm[inBar]; d = [0, 0, 2, 0, 4, 2, 0, -1][(inBar / 2 | 0) % 8] + (variant === 2 ? 1 : 0); }
      if (play) pluck(scaleNote(T, deg + d, 1), t, T.lute === 'riff' ? 0.9 : 1, T.lute === 'riff' ? 3200 : 2400, T.lute === 'riff' ? 0.35 : 0.8);
    }
    // drums
    if (T.drums === 'folk') {
      if (inBar % 8 === 0) drum(t, 0.7);
      if (inBar % 8 === 4) drum(t, 0.4, 220, 120, 0.15);
      if (inBar % 2 === 1) noise(t, 0.04, 0.03, 'highpass', 6000);
    } else if (T.drums === 'heart') {
      if (inBar === 0 || inBar === 3) drum(t, 0.6, 90, 40, 0.4);
    } else if (T.drums === 'battle' || T.drums === 'boss') {
      if (inBar % 4 === 0) drum(t, 0.9, 120, 45, 0.3);
      if (inBar % 8 === 4) noise(t, 0.12, 0.12, 'bandpass', 1400, 0.8);
      if (inBar % 2 === 1) noise(t, 0.03, 0.04, 'highpass', 7000);
      if (T.drums === 'boss' && (inBar === 14 || inBar === 15)) drum(t, 0.7, 180, 90, 0.15);
    }
  }

  function tick() {
    if (!ctx || !theme) return;
    const T = THEMES[theme];
    const sec16 = 60 / T.bpm / 4;
    while (nextTime < ctx.currentTime + 0.25) {
      try { scheduleStep(T, step, nextTime); } catch { /* keep going */ }
      step += 1;
      nextTime += sec16;
    }
  }

  function startTheme(name) {
    if (!ctx || !THEMES[name]) return;
    const old = bus;
    if (old) {
      old.gain.cancelScheduledValues(ctx.currentTime);
      old.gain.setValueAtTime(old.gain.value, ctx.currentTime);
      old.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
      setTimeout(() => old.disconnect(), 2000);
    }
    bus = ctx.createGain();
    bus.gain.setValueAtTime(0, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.5);
    bus.connect(master);
    theme = name;
    rng = mulberry(name.length * 7919 + 13);
    motif = null;
    step = 0;
    nextTime = ctx.currentTime + 0.1;
    if (!timer) timer = setInterval(tick, 60);
  }

  // Audio can only start after the player clicks or presses a key.
  function unlock() {
    if (!enabled) return;
    if (!init()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (theme !== want) startTheme(want);
  }
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else if (enabled) ctx.resume();
  });

  window.Music = {
    themes: Object.keys(THEMES),
    play(name) {
      if (!THEMES[name]) return;
      want = name;
      if (ctx && enabled && theme !== name) startTheme(name);
    },
    get enabled() { return enabled; },
    setEnabled(v) {
      enabled = !!v;
      store.set('dnd.music', enabled ? '1' : '0');
      if (enabled) { unlock(); if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.2); } else if (master) master.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
    },
    get volume() { return volume; },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      store.set('dnd.musicVol', String(volume));
      if (master && enabled) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.1);
    },
  };
})();
