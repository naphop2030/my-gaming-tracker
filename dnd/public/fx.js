// Visual and sound effects for adventure mode: weather particles, combat hits,
// dice rolls, banners, and small synthesized sounds (no audio files needed).
(() => {
  'use strict';
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };
  const rand = (a, b) => a + Math.random() * (b - a);
  let fast = false; // when lots of effects are queued, play them quicker
  const wait = (ms) => new Promise((r) => setTimeout(r, fast ? ms / 2 : ms));

  // ================= weather =================
  class Weather {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.parts = [];
      this.kinds = '';
      this.running = false;
      this.loop = this.loop.bind(this);
      new ResizeObserver(() => this.resize()).observe(canvas);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) this.start(); });
    }
    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.w = this.canvas.clientWidth;
      this.h = this.canvas.clientHeight;
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.seed(true);
    }
    set(kinds) {
      const key = kinds.filter(Boolean).join(',');
      if (key === this.kinds) return;
      this.kinds = key;
      this.seed(true);
      this.start();
    }
    seed() {
      if (!this.w) return;
      const area = (this.w * this.h) / (1200 * 220);
      this.parts = [];
      for (const kind of this.kinds.split(',').filter(Boolean)) {
        const count = { ash: 90, clear: 26, fog: 7, fireflies: 22, embers: 30, wisps: 3, drips: 10, smoke: 10 }[kind] || 0;
        for (let i = 0; i < Math.round(count * Math.max(0.4, Math.min(2, area))); i++) this.parts.push(this.spawn(kind, true));
      }
    }
    spawn(kind, anywhere) {
      const w = this.w;
      const h = this.h;
      const p = { kind, x: rand(0, w), y: anywhere ? rand(0, h) : 0, t: rand(0, 100) };
      switch (kind) {
        case 'ash': Object.assign(p, { y: anywhere ? p.y : -10, r: rand(0.8, 2.4), vy: rand(10, 28), vx: rand(-8, 6), a: rand(0.35, 0.8) }); break;
        case 'clear': Object.assign(p, { y: anywhere ? p.y : h + 10, r: rand(0.8, 1.8), vy: -rand(4, 10), vx: rand(-3, 3), a: rand(0.3, 0.7) }); break;
        case 'fog': Object.assign(p, { y: rand(h * 0.45, h * 0.95), r: rand(120, 260), vx: rand(4, 12) * (Math.random() < 0.5 ? -1 : 1), a: rand(0.05, 0.12) }); break;
        case 'fireflies': Object.assign(p, { y: rand(h * 0.35, h), r: rand(1.2, 2.4), vx: rand(-8, 8), vy: rand(-6, 6) }); break;
        case 'embers': Object.assign(p, { y: anywhere ? p.y : h + 5, x: rand(w * 0.25, w * 0.75), r: rand(0.8, 2), vy: -rand(18, 40), vx: rand(-8, 8), a: rand(0.5, 1) }); break;
        case 'wisps': Object.assign(p, { x: rand(w * 0.3, w * 0.8), y: rand(h * 0.35, h * 0.65), r: rand(3, 5), ox: 0, oy: 0 }); p.bx = p.x; p.by = p.y; break;
        case 'drips': Object.assign(p, { y: anywhere ? rand(-h, 0) : -rand(0, h), vy: 0, r: 1.6, delay: rand(0, 4) }); break;
        case 'smoke': Object.assign(p, { y: anywhere ? p.y : h + 20, r: rand(18, 40), vy: -rand(6, 14), vx: rand(2, 8), a: rand(0.04, 0.09) }); break;
        default: break;
      }
      return p;
    }
    start() {
      if (this.running || reduced || !this.kinds) { if (reduced) this.drawStatic(); return; }
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(this.loop);
    }
    drawStatic() {
      const { ctx } = this;
      ctx.clearRect(0, 0, this.w, this.h);
      for (const p of this.parts) if (p.kind === 'ash' || p.kind === 'clear') this.drawPart(p);
    }
    loop(now) {
      if (document.hidden || !this.canvas.isConnected || !this.canvas.offsetParent) { this.running = false; return; }
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      const { ctx, w, h } = this;
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < this.parts.length; i++) {
        const p = this.parts[i];
        p.t += dt;
        switch (p.kind) {
          case 'ash': p.x += (p.vx + Math.sin(p.t * 1.3) * 10) * dt; p.y += p.vy * dt; if (p.y > h + 5) this.parts[i] = this.spawn('ash'); break;
          case 'clear': p.x += (p.vx + Math.sin(p.t) * 4) * dt; p.y += p.vy * dt; if (p.y < -5) this.parts[i] = this.spawn('clear'); break;
          case 'fog': p.x += p.vx * dt; if (p.x > w + p.r) p.x = -p.r; if (p.x < -p.r) p.x = w + p.r; break;
          case 'fireflies': p.vx += rand(-20, 20) * dt; p.vy += rand(-20, 20) * dt; p.vx *= 0.98; p.vy *= 0.98; p.x += p.vx * dt; p.y += p.vy * dt; if (p.x < 0 || p.x > w || p.y < h * 0.2 || p.y > h) this.parts[i] = this.spawn('fireflies', true); break;
          case 'embers': p.x += (p.vx + Math.sin(p.t * 3) * 12) * dt; p.y += p.vy * dt; p.a -= dt * 0.25; if (p.y < -5 || p.a <= 0) this.parts[i] = this.spawn('embers'); break;
          case 'wisps': p.x = p.bx + Math.sin(p.t * 0.7) * 40; p.y = p.by + Math.sin(p.t * 1.3) * 14; break;
          case 'drips': if (p.delay > 0) { p.delay -= dt; break; } p.vy += 600 * dt; p.y += p.vy * dt; if (p.y > h - 8) { p.splash = 0.3; this.parts[i] = Object.assign(this.spawn('drips'), { y: -5, delay: rand(0.5, 4), sx: p.x, splash: 0.3 }); } break;
          case 'smoke': p.x += p.vx * dt; p.y += p.vy * dt; p.r += dt * 6; if (p.y < -p.r) this.parts[i] = this.spawn('smoke'); break;
          default: break;
        }
        this.drawPart(this.parts[i]);
      }
      requestAnimationFrame(this.loop);
    }
    drawPart(p) {
      const { ctx } = this;
      switch (p.kind) {
        case 'ash': ctx.fillStyle = `rgba(205,195,185,${p.a})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); break;
        case 'clear': ctx.fillStyle = `rgba(255,226,160,${p.a * (0.6 + 0.4 * Math.sin(p.t * 2))})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); break;
        case 'fog': {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
          g.addColorStop(0, `rgba(210,205,200,${p.a})`); g.addColorStop(1, 'rgba(210,205,200,0)');
          ctx.fillStyle = g; ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2); break;
        }
        case 'fireflies': {
          const a = Math.max(0, Math.sin(p.t * 2.2)) * 0.9;
          ctx.fillStyle = `rgba(214,255,120,${a})`; ctx.shadowColor = 'rgba(214,255,120,.9)'; ctx.shadowBlur = 8;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); ctx.shadowBlur = 0; break;
        }
        case 'embers': ctx.fillStyle = `rgba(255,${Math.round(120 + 80 * Math.sin(p.t * 9))},50,${Math.max(0, p.a)})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); break;
        case 'wisps': {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 26);
          g.addColorStop(0, 'rgba(225,245,255,.9)'); g.addColorStop(0.25, 'rgba(160,215,255,.35)'); g.addColorStop(1, 'rgba(160,215,255,0)');
          ctx.fillStyle = g; ctx.fillRect(p.x - 26, p.y - 26, 52, 52); break;
        }
        case 'drips':
          if (p.splash > 0) { p.splash -= 0.016; ctx.strokeStyle = `rgba(170,200,210,${p.splash * 2})`; ctx.beginPath(); ctx.ellipse(p.sx, this.h - 8, (0.3 - p.splash) * 40, (0.3 - p.splash) * 8, 0, 0, 7); ctx.stroke(); }
          if (p.delay <= 0) { ctx.fillStyle = 'rgba(170,200,210,.7)'; ctx.fillRect(p.x, p.y, 1.6, 7); }
          break;
        case 'smoke': {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
          g.addColorStop(0, `rgba(180,170,160,${p.a})`); g.addColorStop(1, 'rgba(180,170,160,0)');
          ctx.fillStyle = g; ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2); break;
        }
        default: break;
      }
    }
  }

  // ================= sound =================
  let audio = null;
  let muted = store.get('dnd.mute') === '1';
  function ac() {
    if (muted) return null;
    if (!audio) {
      try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    }
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }
  function tone(freq, dur, { type = 'sine', vol = 0.15, at = 0, slide = 0 } = {}) {
    const a = ac();
    if (!a) return;
    const t = a.currentTime + at;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function noise(dur, { vol = 0.15, at = 0, freq = 1200, q = 1 } = {}) {
    const a = ac();
    if (!a) return;
    const t = a.currentTime + at;
    const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = a.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(a.destination);
    src.start(t);
  }
  const SOUNDS = {
    dice() { for (let i = 0; i < 7; i++) noise(0.04, { at: i * 0.07 + Math.random() * 0.03, vol: 0.25, freq: 2500 + Math.random() * 1500, q: 4 }); },
    land(ok) { if (ok) { tone(523, 0.18, { vol: 0.1 }); tone(784, 0.3, { vol: 0.1, at: 0.1 }); } else { tone(196, 0.35, { type: 'triangle', vol: 0.12, slide: -60 }); } },
    hit() { tone(140, 0.18, { type: 'triangle', vol: 0.22, slide: -80 }); noise(0.12, { vol: 0.2, freq: 900 }); },
    crit() { tone(110, 0.3, { type: 'sawtooth', vol: 0.12, slide: -60 }); noise(0.2, { vol: 0.25, freq: 700 }); },
    miss() { noise(0.18, { vol: 0.12, freq: 3000, q: 0.7 }); },
    fire() { noise(0.35, { vol: 0.22, freq: 500, q: 0.5 }); tone(90, 0.3, { type: 'sawtooth', vol: 0.05 }); },
    arcane() { [880, 1175, 1568].forEach((f, i) => tone(f, 0.2, { vol: 0.06, at: i * 0.06 })); },
    holy() { tone(659, 0.5, { vol: 0.07 }); tone(988, 0.5, { vol: 0.05, at: 0.05 }); },
    heal() { tone(587, 0.25, { vol: 0.08 }); tone(880, 0.4, { vol: 0.07, at: 0.12 }); },
    hurt() { tone(220, 0.2, { type: 'square', vol: 0.06, slide: -100 }); },
    coins() { for (let i = 0; i < 4; i++) tone(1800 + i * 220, 0.08, { vol: 0.05, at: i * 0.06, type: 'triangle' }); },
    level() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, { vol: 0.09, at: i * 0.11, type: 'triangle' })); },
    victory() { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.5, { vol: 0.08, at: i * 0.09, type: 'triangle' })); },
    defeat() { [330, 262, 196].forEach((f, i) => tone(f, 0.6, { vol: 0.09, at: i * 0.25, type: 'triangle' })); },
    combat() { tone(98, 0.25, { type: 'triangle', vol: 0.2 }); tone(98, 0.25, { type: 'triangle', vol: 0.2, at: 0.22 }); tone(131, 0.4, { type: 'triangle', vol: 0.2, at: 0.44 }); },
    bell() { [262, 524, 786].forEach((f, i) => tone(f, 2.4, { vol: 0.1 / (i + 1) })); },
    quest() { tone(784, 0.15, { vol: 0.06 }); tone(1047, 0.25, { vol: 0.06, at: 0.1 }); },
  };
  const play = (name, arg) => { try { if (!muted && SOUNDS[name]) SOUNDS[name](arg); } catch { /* ignore */ } };

  // ================= on-screen effects =================
  let layer = null; // fixed overlay that survives re-renders
  function overlay() {
    if (!layer || !layer.isConnected) {
      layer = document.createElement('div');
      layer.className = 'fx-layer';
      document.body.append(layer);
    }
    return layer;
  }
  function rectOf(sel) {
    const el = document.querySelector(sel);
    if (!el || !el.offsetParent) return null;
    return el.getBoundingClientRect();
  }
  function floatText(sel, text, cls) {
    const r = rectOf(sel);
    if (!r) return;
    const n = document.createElement('div');
    n.className = `fx-float ${cls || ''}`;
    n.textContent = text;
    n.style.left = `${r.left + r.width / 2}px`;
    n.style.top = `${r.top + r.height * 0.35}px`;
    overlay().append(n);
    setTimeout(() => n.remove(), 1500);
  }
  function burst(sel, cls, count = 10) {
    const r = rectOf(sel);
    if (!r || reduced) return;
    for (let i = 0; i < count; i++) {
      const s = document.createElement('div');
      s.className = `fx-spark ${cls}`;
      s.style.left = `${r.left + r.width / 2 + rand(-r.width * 0.3, r.width * 0.3)}px`;
      s.style.top = `${r.top + r.height / 2 + rand(-r.height * 0.3, r.height * 0.3)}px`;
      s.style.setProperty('--dx', `${rand(-60, 60)}px`);
      s.style.setProperty('--dy', `${rand(-90, -20)}px`);
      s.style.animationDelay = `${rand(0, 0.15)}s`;
      overlay().append(s);
      setTimeout(() => s.remove(), 1200);
    }
  }
  function strike(sel, style) {
    const r = rectOf(sel);
    if (!r) return;
    const s = document.createElement('div');
    s.className = `fx-strike ${style}`;
    Object.assign(s.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    overlay().append(s);
    setTimeout(() => s.remove(), 700);
  }
  function pulse(sel, cls, ms = 600) {
    const el = document.querySelector(sel);
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }
  async function banner(text, cls, icon, ms = 1500) {
    const b = document.createElement('div');
    b.className = `fx-banner ${cls}`;
    if (icon) {
      const i = document.createElement('span');
      i.className = 'ico';
      i.style.setProperty('--i', `url(/art/icons/${icon}.svg)`);
      b.append(i);
    }
    b.append(document.createTextNode(text));
    overlay().append(b);
    await wait(ms);
    b.classList.add('out');
    setTimeout(() => b.remove(), 400);
  }
  async function diceRoll(fx) {
    const box = document.createElement('div');
    box.className = 'fx-dice';
    const die = document.createElement('div');
    die.className = 'die';
    const num = document.createElement('b');
    die.append(num);
    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.textContent = fx.label ? `${fx.who ? `${fx.who}: ` : ''}${fx.label}` : 'Rolling…';
    const res = document.createElement('div');
    res.className = 'res';
    box.append(cap, die, res);
    overlay().append(box);
    play('dice');
    let use3d = false;
    try { use3d = !!window.Dice3D && localStorage.getItem('dnd.3d') !== '0' && fx.nat !== undefined; } catch { use3d = !!window.Dice3D && fx.nat !== undefined; }
    if (use3d) {
      die.classList.add('die3d');
      await window.Dice3D.roll(die, fx.nat, reduced ? 200 : 1000);
    } else {
      const spins = reduced ? 1 : 10;
      for (let i = 0; i < spins; i++) { num.textContent = String(1 + Math.floor(Math.random() * 20)); await wait(55 + i * 8); }
      num.textContent = String(fx.nat !== undefined ? fx.nat : fx.total);
    }
    die.classList.add('landed', fx.ok ? 'ok' : 'bad');
    if (fx.nat === 20) die.classList.add('nat20');
    if (fx.nat === 1) die.classList.add('nat1');
    res.textContent = fx.nat !== undefined ? `${fx.nat} ${fx.bonus >= 0 ? '+' : '−'} ${Math.abs(fx.bonus)} = ${fx.total} vs DC ${fx.dc} · ${fx.ok ? 'Success!' : 'Failure'}` : `${fx.total} vs DC ${fx.dc} · ${fx.ok ? 'Success!' : 'Failure'}`;
    res.className = `res ${fx.ok ? 'ok' : 'bad'}`;
    play('land', fx.ok);
    await wait(1300);
    box.classList.add('out');
    setTimeout(() => box.remove(), 400);
  }

  // Plays one effect; resolves when the next one may start.
  async function run(fx, ctx) {
    try { if (window.FX3D) window.FX3D.onFx(fx); } catch { /* 3D is optional */ }
    const foe = (id) => `[data-foe="${id}"]`;
    const hero = (id) => `[data-hero="${id}"]`;
    switch (fx.t) {
      case 'check': await diceRoll(fx); return;
      case 'dmg':
        strike(foe(fx.id), fx.style || 'slash');
        pulse(foe(fx.id), 'fx-shake');
        floatText(foe(fx.id), fx.crit ? `CRIT −${fx.n}` : `−${fx.n}`, fx.crit ? 'crit' : 'dmg');
        play(fx.crit ? 'crit' : (fx.style === 'fire' ? 'fire' : fx.style === 'arcane' ? 'arcane' : fx.style === 'holy' ? 'holy' : 'hit'));
        await wait(520); return;
      case 'miss':
        floatText(fx.from ? hero(fx.id) : foe(fx.id), 'Miss', 'miss');
        play('miss');
        await wait(380); return;
      case 'kill':
        burst(foe(fx.id), 'dark', 14);
        floatText(foe(fx.id), '☠', 'kill');
        await wait(420); return;
      case 'hurt':
        pulse(hero(fx.id), 'fx-shake');
        floatText(hero(fx.id), fx.crit ? `CRIT −${fx.n}` : `−${fx.n}`, fx.crit ? 'crit' : 'dmg');
        if (fx.id === ctx.meId) pulse('#adventure', 'fx-hurt', 700);
        play('hurt');
        await wait(480); return;
      case 'down':
        floatText(hero(fx.id), 'Down!', 'crit');
        await wait(400); return;
      case 'heal':
        burst(hero(fx.id), 'green', 12);
        floatText(hero(fx.id), `+${fx.n}`, 'heal');
        play('heal');
        await wait(450); return;
      case 'defend':
        pulse(hero(fx.id), 'fx-defend', 900);
        await wait(250); return;
      case 'gold':
        floatText('#advGold', `+${fx.n}`, 'gold');
        play('coins');
        await wait(250); return;
      case 'item': {
        const r = rectOf('#advStory') || { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
        const i = document.createElement('div');
        i.className = 'fx-item';
        i.style.setProperty('--i', `url(/art/icons/${fx.icon}.svg)`);
        i.style.left = `${r.left + r.width / 2}px`;
        i.style.top = `${r.top + r.height / 2}px`;
        overlay().append(i);
        setTimeout(() => i.remove(), 1300);
        play('coins');
        await wait(500); return;
      }
      case 'level':
        burst(hero(fx.id), 'gold', 22);
        play('level');
        await banner(`${ctx.nameOf(fx.id)} reached level ${ctx.levelOf(fx.id)}!`, 'gold', 'level', 1500); return;
      case 'quest': play('quest'); return;
      case 'combat': play('combat'); await banner('Combat!', 'red', 'combat', 900); return;
      case 'victory': play('victory'); await banner('Victory!', 'gold', 'level', 1300); return;
      case 'defeat': play('defeat'); await banner('Defeated…', 'dark', 'skull', 1800); return;
      case 'ending': play('bell'); await banner('The Bell Sings Again', 'gold', 'bell', 2400); return;
      default: return;
    }
  }

  const queue = [];
  let busy = false;
  // Effects that matter even when they arrive late.
  const KEEP = new Set(['level', 'ending', 'victory', 'defeat']);
  async function pump(ctx) {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const { fx, at } = queue.shift();
      // Skip effects that are out of date, so the screen never lags behind the game.
      if (Date.now() - at > 4000 && !KEEP.has(fx.t)) continue;
      fast = queue.length > 5;
      try { await run(fx, ctx); } catch { /* an effect failing must never break the game */ }
    }
    fast = false;
    busy = false;
  }

  window.FX = {
    Weather,
    enqueue(list, ctx) {
      const at = Date.now();
      queue.push(...list.map((fx) => ({ fx, at })));
      if (queue.length > 40) queue.splice(0, queue.length - 40);
      pump(ctx);
    },
    get muted() { return muted; },
    setMuted(v) { muted = !!v; store.set('dnd.mute', muted ? '1' : '0'); if (!muted) play('coins'); },
    reduced,
  };
})();
