// The 3D battle stage: heroes on the left, monsters on the right, on a hex arena dressed like the
// place you're fighting in (painted backdrop, scenery, flickering torches).
// Everything follows the game's combat events: camera moves, melee dashes, spell effects,
// hit-stop and knockback, status visuals (Zzz, stars, poison bubbles…), ash dissolves and a victory orbit.
import { THREE, View, kitPiece, Actor, lights, Bursts, weatherPoints, dioramaFor, isWatery, isSnowy } from './core.js';

const HERO_X = -2.6;
const FOE_X = 2.6;
const CAM_HOME = new THREE.Vector3(-0.2, 3.3, 9.4);
const LOOK_HOME = new THREE.Vector3(0.2, 0.85, -0.4);
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const rand = (a, b) => a + Math.random() * (b - a);

// ---------- little textures drawn once ----------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const TEX = {
  glow: canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.3, 'rgba(255,255,255,.7)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }),
  flame: canvasTex(64, 128, (g) => {
    const r = g.createRadialGradient(32, 90, 2, 32, 80, 60);
    r.addColorStop(0, 'rgba(255,250,210,1)'); r.addColorStop(0.25, 'rgba(255,190,70,.95)'); r.addColorStop(0.6, 'rgba(255,90,20,.6)'); r.addColorStop(1, 'rgba(255,40,0,0)');
    g.fillStyle = r; g.beginPath(); g.moveTo(32, 2); g.quadraticCurveTo(62, 70, 32, 126); g.quadraticCurveTo(2, 70, 32, 2); g.fill();
  }),
  z: canvasTex(64, 64, (g) => { g.font = 'bold 50px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 7; g.strokeStyle = '#1a2a6c'; g.strokeText('Z', 32, 34); g.fillStyle = '#d6e4ff'; g.fillText('Z', 32, 34); }),
  star: canvasTex(64, 64, (g) => {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2; const r = i % 2 ? 12 : 28; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
    g.closePath(); g.fillStyle = '#ffe066'; g.strokeStyle = '#7a5410'; g.lineWidth = 4; g.fill(); g.stroke();
  }),
  bubble: canvasTex(32, 32, (g) => { g.beginPath(); g.arc(16, 16, 12, 0, 7); g.fillStyle = 'rgba(150,240,110,.55)'; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(220,255,200,.9)'; g.stroke(); g.beginPath(); g.arc(12, 12, 3, 0, 7); g.fillStyle = '#fff'; g.fill(); }),
};
const sprite = (tex, color = 0xffffff, additive = true) => new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));

export class Stage {
  constructor(container) {
    this.view = new View(container);
    this.scene = this.view.scene;
    this.camera = this.view.camera;
    this.camera.fov = 30;
    this.camera.position.copy(CAM_HOME);
    this.camera.lookAt(LOOK_HOME);
    this.bursts = new Bursts(this.scene);
    this.heroes = new Map();
    this.foes = new Map();
    this.combatKey = '';
    this.t = 0;
    this.tweens = [];
    this.floaters = []; // short-lived sprites and meshes (trails, Zzz, swooshes…)
    this.shakeAmt = 0;
    this.zoom = 0;
    this.freeze = 0;
    this.focus = LOOK_HOME.clone();
    this.look = LOOK_HOME.clone();
    this.action = null; // { point, w }
    this.intro = null;
    this.orbit = null;
    this.torches = [];
    this.view.tickers.add((dt) => this.tick(dt));
    this.makeMarkers();

    const ray = new THREE.Raycaster();
    this.view.canvas.addEventListener('click', (e) => {
      const rect = this.view.canvas.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
      const hits = ray.intersectObjects([...this.foes.values()].map((a) => a.group), true);
      for (const h of hits) {
        let o = h.object;
        while (o && !o.userData.foe) o = o.parent;
        if (o && this.onTarget) { this.onTarget(o.userData.foe); break; }
      }
    });
  }

  // ---------- markers: turn arrow, target reticle ----------
  makeMarkers() {
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.38, 4), new THREE.MeshStandardMaterial({ color: 0xffd36a, emissive: 0xb07a10, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.4 }));
    this.arrow.rotation.x = Math.PI;
    this.arrow.visible = false;
    this.scene.add(this.arrow);
    this.reticle = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const arc = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.8, 16, 1, i * Math.PI / 2 + 0.25, Math.PI / 2 - 0.5), new THREE.MeshBasicMaterial({ color: 0xff6a50, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.reticle.add(arc);
    }
    this.reticle.rotation.x = -Math.PI / 2;
    this.reticle.visible = false;
    this.scene.add(this.reticle);
  }

  // ---------- arena ----------
  async setArena(loc, mood) {
    const key = `${loc.id}:${mood}`;
    if (this.arenaKey === key) return;
    this.arenaKey = key;
    if (this.arena) this.scene.remove(this.arena);
    for (const t of this.torches) this.view.tickers.delete(t.tick);
    this.torches = [];
    const arena = new THREE.Group();
    this.arena = arena;
    const indoors = loc.id === 'crypt' || /underground|caves/i.test(loc.region || '');
    const snowy = isSnowy(loc.id, loc.region);
    const tmp = new THREE.Scene();
    lights(tmp, mood);
    for (const l of [...tmp.children]) {
      if (l.isDirectionalLight) { l.position.set(-6, 12, 8); Object.assign(l.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 }); if (indoors) l.intensity *= 0.35; }
      if (l.isHemisphereLight && indoors) l.intensity *= 0.45;
      arena.add(l);
    }
    // A rim light from behind makes the fighters pop against the backdrop.
    const rim = new THREE.DirectionalLight(mood === 'clear' ? 0xbfd8ff : 0xffa060, indoors ? 0.6 : 1.1);
    rim.position.set(2, 5, -9);
    arena.add(rim);
    const fogColor = indoors ? 0x120f0c : mood === 'clear' ? 0x3a4656 : 0x3a2e26;
    this.scene.fog = new THREE.Fog(fogColor, 11, 28);
    this.scene.background = new THREE.Color(fogColor);
    this.setBackdrop(loc.scene || loc.id, mood);

    const tile = await kitPiece(isWatery(loc.id, loc.region) ? 'hex_water' : 'hex_grass');
    const box = new THREE.Box3().setFromObject(tile);
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z) / 2;
    const flat = size.x >= size.z;
    for (let q = -5; q <= 5; q++) {
      for (let s = -4; s <= 3; s++) {
        const x = flat ? q * r * 1.5 : (q + (s % 2 ? 0.5 : 0)) * Math.sqrt(3) * r;
        const z = flat ? (s + (q % 2 ? 0.5 : 0)) * Math.sqrt(3) * r : s * r * 1.5;
        const t = tile.clone();
        t.position.set(x, -box.max.y - (Math.abs(x) > 6 ? 0.05 : 0), z);
        // Darker toward the edges so the fighters stand out in the middle.
        const edge = Math.min(1, Math.hypot(x / 7, (z + 0.6) / 4.5));
        const base = new THREE.Color(indoors ? 0x6a6460 : snowy ? 0xe8eef6 : mood !== 'clear' ? 0x9a927e : 0xb8b8a0).multiplyScalar(1 - edge * 0.35);
        setTint(t, base, snowy);
        arena.add(t);
      }
    }
    // Scenery from the location in a ring around the back and sides.
    const recipe = dioramaFor(loc.id, loc.region);
    const spots = [[-5.2, -4.6], [0.4, -5.8], [5.4, -4.4], [-7.6, -1.4], [7.6, -1.6], [-2.6, -6.2], [3.2, -6.4], [-8.2, 2.4], [8.4, 2.2]];
    for (let i = 0; i < spots.length; i++) {
      const [piece, , , rot, sc] = recipe[i % recipe.length];
      const o = await kitPiece(piece);
      o.position.set(spots[i][0], 0, spots[i][1]);
      o.rotation.y = (rot || 0) * Math.PI * 2 + i;
      o.scale.setScalar((sc || 1) * 1.15);
      arena.add(o);
    }
    const extras = indoors ? ['candle_triple', 'gravestone', 'pillar'] : ['rock_single_A', 'rock_single_C', 'tree_single_A'];
    for (const [x, z, k] of [[-6, 4.2, 0], [6.3, 4.4, 1], [-9.5, -3.5, 2], [9.6, -3.2, 2]]) {
      const o = await kitPiece(extras[k]);
      o.position.set(x, 0, z);
      o.rotation.y = x;
      arena.add(o);
    }
    // Torches (or candles indoors) that flicker and spark.
    for (const [x, z] of indoors ? [[-4.4, -2.6], [4.8, -2.7], [0.3, -4.2]] : [[-4.6, -2.8], [5, -2.9]]) this.addTorch(arena, x, z, indoors);
    if (!indoors) {
      const tick = weatherPoints(arena, mood, 24, 9);
      if (this.weatherTick) this.view.tickers.delete(this.weatherTick);
      this.weatherTick = tick;
      this.view.tickers.add(tick);
    }
    this.scene.add(arena);
  }

  // The location's painting becomes the backdrop behind the arena.
  setBackdrop(sceneId, mood) {
    const draw = window.SCENES && (window.SCENES[sceneId] || window.SCENES.default);
    if (!draw) return;
    const token = (this.backdropToken = {});
    const svg = draw(mood).replace('<svg ', '<svg width="1600" height="600" ');
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 1600;
      c.height = 600;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, 1600, 600);
      g.fillStyle = 'rgba(0,0,0,.18)';
      g.fillRect(0, 0, 1600, 600);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      if (this.backdropToken === token) this.scene.background = tex;
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  addTorch(parent, x, z, small) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.9 });
    const h = small ? 0.9 : 1.6;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, h, 8), wood);
    pole.position.y = h / 2;
    pole.castShadow = true;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.1, 0.18, 10), new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.6, metalness: 0.5 }));
    bowl.position.y = h + 0.05;
    const flame = sprite(TEX.flame, 0xffffff);
    flame.position.y = h + 0.38;
    flame.scale.set(0.45, 0.8, 1);
    const light = new THREE.PointLight(0xff9a40, small ? 4 : 7, small ? 5 : 8, 1.6);
    light.position.y = h + 0.4;
    g.add(pole, bowl, flame, light);
    parent.add(g);
    let spark = 0;
    const tick = (dt) => {
      const f = 0.8 + Math.sin(this.t * 13 + x) * 0.08 + Math.sin(this.t * 7.3 + z) * 0.12 + Math.random() * 0.06;
      light.intensity = (small ? 4 : 7) * f;
      flame.scale.set(0.42 + f * 0.06, 0.7 + f * 0.18, 1);
      spark -= dt;
      if (spark <= 0) {
        spark = rand(0.12, 0.3);
        const p = g.position.clone().add(new THREE.Vector3(rand(-0.08, 0.08), h + 0.45, rand(-0.08, 0.08)));
        this.floater(sprite(TEX.glow, 0xffa040), p, { vel: new THREE.Vector3(rand(-0.2, 0.2), rand(0.6, 1.2), rand(-0.2, 0.2)), life: rand(0.6, 1.1), size: 0.08 });
      }
    };
    this.view.tickers.add(tick);
    this.torches.push({ tick });
  }

  // ---------- cast ----------
  hpTag(a) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 18;
    const tex = new THREE.CanvasTexture(c);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    tex.colorSpace = THREE.SRGBColorSpace;
    s.scale.set(1.1, 0.155, 1);
    s.position.y = (a.spec.height || 1.8) * 1.12 + 0.25;
    s.userData = { c, tex, last: -1 };
    a.group.add(s);
    a.hpSprite = s;
  }
  drawHp(a, hp, max) {
    const s = a.hpSprite;
    if (!s) return;
    const pct = max ? Math.max(0, Math.min(1, hp / max)) : 0;
    if (s.userData.last === pct) return;
    s.userData.last = pct;
    const g = s.userData.c.getContext('2d');
    g.clearRect(0, 0, 128, 18);
    g.fillStyle = 'rgba(10,14,50,.85)';
    g.fillRect(0, 0, 128, 18);
    g.strokeStyle = '#eef2ff';
    g.lineWidth = 2;
    g.strokeRect(1, 1, 126, 16);
    g.fillStyle = pct > 0.5 ? '#6fd36a' : pct > 0.25 ? '#ffd76a' : '#ff6a50';
    g.fillRect(4, 4, 120 * pct, 10);
    s.userData.tex.needsUpdate = true;
    s.visible = hp > 0;
  }

  async addActor(kind, pos, facing, id, isFoe) {
    const a = await Actor.create(kind);
    a.group.position.copy(pos);
    a.home = pos.clone();
    a.group.rotation.y = facing;
    if (isFoe) { a.group.userData.foe = id; this.hpTag(a); }
    const aura = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.78, 40), new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.035;
    a.group.add(aura);
    a.aura = aura;
    a.st = new Set();
    a.fxTimers = {};
    (isFoe ? this.foes : this.heroes).set(id, a);
    this.scene.add(a.group);
    return a;
  }

  async sync(A, init, targetId, onTarget) {
    this.onTarget = onTarget;
    const mood = A.ambience === 'clear' ? 'clear' : 'ash';
    await this.setArena(A.location, mood);
    const key = A.combat.monsters.map((m) => m.id).join(',');
    // A monster joined mid-fight (summoned): add it with a flourish.
    if (this.combatKey && key !== this.combatKey && key.startsWith(this.combatKey)) {
      const known = new Set(this.foes.keys());
      const fresh = A.combat.monsters.filter((m) => !known.has(m.id));
      this.combatKey = key;
      await Promise.all(fresh.map(async (m, i) => {
        const a = await this.addActor(m.key, new THREE.Vector3(FOE_X + 1.8, 0, 1.6 - i * 1.4), -Math.PI / 2, m.id, true);
        this.bursts.burst(a.group.position.clone().setY(0.5), { color: 0xff7a2a, count: 50, speed: 2.2, up: 3 });
        this.ring(a.group.position, 0xff7a2a);
      }));
    }
    if (key !== this.combatKey) {
      this.combatKey = key;
      for (const a of [...this.heroes.values(), ...this.foes.values()]) this.scene.remove(a.group);
      this.heroes.clear();
      this.foes.clear();
      this.floaters.forEach((f) => this.scene.remove(f.obj));
      this.floaters = [];
      this.orbit = null;
      const heroes = A.party;
      await Promise.all(heroes.map((h, i) => this.addActor(h.cls, new THREE.Vector3(HERO_X - (i % 2) * 0.8, 0, (i - (heroes.length - 1) / 2) * 1.3 - 0.6), Math.PI / 2, h.id, false)));
      const foes = A.combat.monsters;
      await Promise.all(foes.map((m, i) => this.addActor(m.key, new THREE.Vector3(FOE_X + (i % 2) * 0.8 + (m.boss ? 0.6 : 0), 0, (i - (foes.length - 1) / 2) * 1.45 - 0.6), -Math.PI / 2, m.id, true)));
      // Intro: a sweeping shot onto the battlefield (closer on a boss).
      this.intro = { t: 0, dur: 2.0, boss: foes.some((m) => m.boss) };
    }
    // Keep poses, HP tags and status effects in line with the state.
    for (const m of A.combat.monsters) {
      const a = this.foes.get(m.id);
      if (!a) continue;
      if (m.hp <= 0 && !a.dead) a.play('dead');
      if (m.hp > 0 && a.group.visible === false) this.unfade(a);
      this.drawHp(a, m.hp, m.maxHp);
      a.st = new Set((m.status || []).map((s) => s.id));
    }
    const cur = init.list.find((e) => e.id === init.current);
    for (const h of A.party) {
      const a = this.heroes.get(h.id);
      if (!a) continue;
      if (h.hp <= 0 && !a.dead) a.play('dead');
      if (h.hp > 0 && a.dead) a.revive();
      a.st = new Set((h.status || []).map((s) => s.id));
      if (h.blessed) a.st.add('blessed');
      this.setGhost(a, a.st.has('hidden'));
    }
    const tgt = this.foes.get(targetId);
    this.target = tgt && !tgt.dead ? tgt : null;
    this.active = cur ? (this.heroes.get(cur.owner) || this.foes.get(cur.ref)) : null;
    if (this.active && this.active.dead) this.active = null;
    this.focus.set(this.active ? LOOK_HOME.x + this.active.group.position.x * 0.18 : LOOK_HOME.x, LOOK_HOME.y, LOOK_HOME.z);
    this.view.start();
  }

  // ---------- combat events ----------
  onFx(fx) {
    const hero = (id) => this.heroes.get(id);
    const foe = (id) => this.foes.get(id);
    const chest = (a) => a.group.position.clone().add(new THREE.Vector3(0, 1.1 * (a.spec.height || 1.8) / 1.8, 0));
    switch (fx.t) {
      case 'dmg': case 'miss': {
        const target = fx.t === 'dmg' || !fx.from ? foe(fx.id) : hero(fx.id);
        const attacker = fx.by ? hero(fx.by) : fx.from ? foe(fx.from) : null;
        if (fx.t === 'miss' && fx.from) { // a monster missed a hero
          const m = foe(fx.from);
          if (m) { m.play('attack'); if (target) this.lunge(m, target); }
          if (target) { target.play('block'); setTimeout(() => this.ring(chest(target), 0x9cc4ff, 0.6), 260); }
          return;
        }
        const ranged = fx.style === 'fire' || fx.style === 'arcane' || fx.style === 'holy' || fx.style === 'poison';
        if (attacker) attacker.play(ranged ? 'cast' : 'attack');
        if (attacker && target && !ranged) this.lunge(attacker, target);
        if (attacker && target) this.actionCam(attacker, target, fx.crit ? 0.9 : 0.45);
        if (!target) return;
        const land = () => {
          if (fx.t !== 'dmg') { this.puff(chest(target)); return; }
          target.play('hit');
          target.hitFlash();
          this.freeze = fx.crit ? 0.14 : 0.07;
          if (fx.crit) { this.shake(0.3); this.zoom = Math.max(this.zoom, 1); }
          if (!ranged) this.swoosh(chest(target), fx.crit ? 0xffd34d : 0xffffff, fx.style === 'stab');
          this.impact(chest(target), fx.style === 'fire' ? 0xff8a3a : fx.style === 'arcane' ? 0xc8a0ff : fx.style === 'holy' ? 0xfff0b0 : fx.style === 'poison' ? 0x8ae05a : fx.crit ? 0xffd34d : 0xff6a50, fx.crit ? 1.6 : 1);
          this.knockback(target, attacker, fx.crit ? 0.55 : 0.32);
        };
        if (fx.style === 'fire' && attacker) {
          setTimeout(() => this.projectile(chest(attacker), chest(target), { color: 0xff7a2a, size: 0.7, curve: 0.6, trail: 0xff9a40, onHit: land }), 250);
        } else if (fx.style === 'arcane' && attacker) {
          for (let i = 0; i < 3; i++) setTimeout(() => this.projectile(chest(attacker), chest(target), { color: 0xc090ff, size: 0.32, curve: rand(0.6, 1.4), side: rand(-1.4, 1.4), trail: 0xb68cff, time: 0.5, onHit: i === 2 ? land : () => this.impact(chest(target), 0xc8a0ff, 0.6) }), 220 + i * 120);
        } else if (fx.style === 'holy') {
          this.beam(target);
          setTimeout(land, 300);
        } else {
          setTimeout(land, attacker ? 260 : 0);
        }
        return;
      }
      case 'kill': {
        const a = foe(fx.id);
        if (!a) return;
        setTimeout(() => { a.play('death'); this.shake(0.15); }, 300);
        setTimeout(() => this.fadeOut(a), 1500);
        return;
      }
      case 'hurt': {
        const m = fx.from && foe(fx.from);
        const h = hero(fx.id);
        if (m && fx.style === 'fire') {
          m.play('cast');
          if (h) this.projectile(chest(m), chest(h), { color: 0xff6a20, size: 0.6, curve: 0.8, trail: 0xff8a3a, time: 0.4 });
        } else if (m) { m.play('attack'); if (h) this.lunge(m, h); }
        if (m && h) this.actionCam(m, h, fx.crit ? 0.8 : 0.3);
        if (h) {
          setTimeout(() => {
            h.play('hit');
            h.hitFlash();
            this.freeze = fx.crit ? 0.12 : 0.06;
            this.impact(chest(h), fx.style === 'fire' ? 0xff8a3a : 0xff4a3a, fx.crit ? 1.4 : 0.9);
            if (fx.style !== 'fire') this.swoosh(chest(h), 0xffb0a0, false);
            if (m) this.knockback(h, m, fx.crit ? 0.45 : 0.25);
            if (fx.crit) this.shake(0.3);
          }, m ? 320 : 0);
        }
        return;
      }
      case 'down': { const h = hero(fx.id); if (h) setTimeout(() => { h.play('death'); this.shake(0.15); }, 380); return; }
      case 'heal': {
        const h = hero(fx.id);
        if (!h) return;
        if (h.dead) h.revive();
        this.column(h.group.position, 0x7ee08a);
        this.bursts.burst(h.group.position.clone().setY(0.3), { color: 0x9cf2a6, count: 30, speed: 1.1, up: 3, gravity: 1.5, life: 1.3 });
        h.play('raise');
        return;
      }
      case 'defend': { const h = hero(fx.id); if (h) { h.play('block'); this.ring(chest(h), 0x9cc4ff, 1); } return; }
      case 'burst': {
        const m = foe(fx.id);
        const col = fx.style === 'arcane' ? 0x6ad0c0 : fx.style === 'slam' ? 0xc8a070 : 0xff5a10;
        if (m) {
          m.play(fx.style === 'slam' ? 'attack' : 'cast');
          if (fx.style === 'slam') { const g = m.group.position.clone().setY(0.1); this.ring(g, col, 3.5, true); this.ring(g, 0xffffff, 2.2, true); this.bursts.burst(g, { color: col, count: 80, speed: 4, up: 1.2, life: 1.1, size: 0.3 }); } else this.explosion(chest(m), col, 2.6);
          for (const h of this.heroes.values()) if (!h.dead) setTimeout(() => this.impact(chest(h), col, 1.2), 250);
        }
        this.shake(0.6);
        this.zoom = Math.max(this.zoom, 0.8);
        return;
      }
      case 'warn': {
        const m = foe(fx.id);
        if (m) { m.play('cast'); this.actionCam(m, m, 0.7); this.bursts.burst(chest(m), { color: 0xffa040, count: 40, speed: 0.9, up: 3, gravity: 1, life: 1.6 }); }
        return;
      }
      case 'cast': {
        const h = fx.by && hero(fx.by);
        if (!h) return;
        h.play('cast');
        const col = fx.style === 'holy' ? 0xffe9a0 : fx.style === 'fire' ? 0xff8a3a : 0xb68cff;
        this.ring(h.group.position.clone().setY(0.05), col, 1.4, true);
        const living = [...this.foes.values()].filter((f) => !f.dead);
        if (fx.spell === 'burning-hands') {
          this.actionCam(h, living[0] || h, 0.5);
          this.spray(chest(h), living.map(chest), 0xff8a3a, 0.6);
        } else if (fx.spell === 'fireball' && living.length) {
          const c = living.reduce((acc, f) => acc.add(f.group.position), new THREE.Vector3()).divideScalar(living.length).setY(0.6);
          this.zoom = Math.max(this.zoom, 0.6);
          this.projectile(chest(h), c, { color: 0xff6a20, size: 1.1, curve: 2.2, trail: 0xffa040, time: 0.7, onHit: () => { this.explosion(c, 0xff6a20, 3.2); this.shake(0.6); } });
        } else if (fx.spell === 'sleep') {
          for (const f of living) for (let i = 0; i < 10; i++) this.floater(sprite(TEX.glow, 0xc8a8ff), chest(f).add(new THREE.Vector3(rand(-0.5, 0.5), rand(0.8, 1.4), rand(-0.5, 0.5))), { vel: new THREE.Vector3(0, -0.6, 0), life: 1.4, size: 0.12, delay: i * 0.08 });
        } else if (fx.spell === 'bless') {
          for (const x of this.heroes.values()) if (!x.dead) this.column(x.group.position, 0xffe9a0);
        } else if (fx.spell === 'spirit-weapon') {
          this.impact(chest(h).add(new THREE.Vector3(0, 0.8, 0)), 0xfff0b0, 1.4);
        }
        return;
      }
      case 'status': {
        const a = hero(fx.id) || foe(fx.id);
        if (a) this.ring(chest(a), fx.status === 'poison' ? 0x8ae05a : fx.status === 'sleep' ? 0x9cb8ff : 0xffd76a, 0.9);
        return;
      }
      case 'heal-foe': {
        const a = foe(fx.id);
        if (!a) return;
        setTimeout(() => {
          this.unfade(a);
          a.revive();
          a.play(a.clipFor('awaken') ? 'awaken' : 'idle');
          this.bursts.burst(a.group.position.clone().setY(0.4), { color: 0xd8d0c0, count: 40, speed: 1.6, up: 2.5 });
          this.shake(0.2);
        }, 900);
        return;
      }
      case 'victory': {
        for (const h of this.heroes.values()) if (!h.dead) h.play('cheer');
        const alive = [...this.heroes.values()].filter((h) => !h.dead);
        const c = alive.length ? alive.reduce((acc, h) => acc.add(h.group.position), new THREE.Vector3()).divideScalar(alive.length) : new THREE.Vector3(HERO_X, 0, 0);
        this.orbit = { t: 0, center: c.setY(1) };
        this.confetti(c);
        return;
      }
      case 'level': { const h = hero(fx.id); if (h) { this.column(h.group.position, 0xffd36a); this.bursts.burst(h.group.position.clone().setY(0.2), { color: 0xffd36a, count: 60, speed: 2, up: 4, gravity: 0.5, life: 1.6 }); } return; }
      default: return;
    }
  }

  // ---------- movement ----------
  lunge(attacker, target) {
    if (attacker.dead || attacker.lunging) return;
    attacker.lunging = true;
    const home = attacker.home || attacker.group.position.clone();
    const dir = target.group.position.clone().sub(home);
    const dist = dir.length();
    const stop = home.clone().add(dir.normalize().multiplyScalar(Math.max(0, dist - 1.1)));
    this.tween(attacker.group.position, home, stop, 0.2, () => {
      setTimeout(() => this.tween(attacker.group.position, stop, home, 0.32, () => { attacker.lunging = false; }), 400);
    });
  }
  knockback(target, from, amount) {
    if (target.lunging || target.knocked || target.dead) return;
    const home = target.home || target.group.position.clone();
    const dir = from ? home.clone().sub(from.home || from.group.position).setY(0).normalize() : new THREE.Vector3(target === this.heroes.get([...this.heroes.keys()][0]) ? -1 : 1, 0, 0);
    const back = home.clone().add(dir.multiplyScalar(amount));
    target.knocked = true;
    this.tween(target.group.position, home, back, 0.08, () => this.tween(target.group.position, back, home, 0.3, () => { target.knocked = false; }));
  }
  tween(vec, from, to, dur, done) { this.tweens.push({ vec, from: from.clone(), to: to.clone(), t: 0, dur, done }); }
  shake(amount) { this.shakeAmt = Math.max(this.shakeAmt, amount); }
  actionCam(a, b, w) {
    const p = a.group.position.clone().add(b.group.position).multiplyScalar(0.5).setY(1);
    this.action = { point: p, w: Math.min(1, w + 0.2), hold: 0.9 };
    this.zoom = Math.max(this.zoom, w * 0.7);
  }

  // ---------- effects ----------
  floater(obj, pos, { vel = new THREE.Vector3(), life = 1, size = 0.3, grow = 0, spin = 0, delay = 0, gravity = 0, opacity = 1, update } = {}) {
    obj.position.copy(pos);
    if (obj.isSprite) obj.scale.setScalar(size);
    obj.visible = delay <= 0;
    this.scene.add(obj);
    this.floaters.push({ obj, vel, life, age: -delay, size, grow, spin, gravity, opacity, update });
  }
  impact(pos, color, scale = 1) {
    this.floater(sprite(TEX.glow, color), pos, { life: 0.25, size: 0.5 * scale, grow: 5 * scale });
    this.bursts.burst(pos, { color, count: Math.round(18 * scale), speed: 2.6 * scale, life: 0.6 });
  }
  puff(pos) { this.floater(sprite(TEX.glow, 0xdddddd), pos, { life: 0.3, size: 0.3, grow: 2, opacity: 0.6 }); }
  swoosh(pos, color, stab) {
    const geo = stab ? new THREE.PlaneGeometry(1.4, 0.08) : new THREE.RingGeometry(0.5, 0.64, 28, 1, 0, 2.3);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(geo, mat);
    m.lookAt(this.camera.position);
    m.position.copy(pos);
    m.lookAt(this.camera.position);
    m.rotateZ(rand(-0.8, 0.8));
    this.floater(m, pos, { life: 0.28, grow: 3, update: (f, k) => { mat.opacity = 1 - k; } });
  }
  ring(pos, color, scale = 1, flat = false) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 40), mat);
    if (flat) m.rotation.x = -Math.PI / 2; else m.lookAt(this.camera.position);
    this.floater(m, pos, { life: 0.5, grow: 4 * scale, update: (f, k) => { mat.opacity = 0.9 * (1 - k); } });
  }
  column(pos, color) {
    const geo = new THREE.CylinderGeometry(0.4, 0.55, 5, 20, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(geo, mat);
    this.floater(m, pos.clone().setY(2.5), { life: 0.9, update: (f, k) => { mat.opacity = 0.6 * (1 - k); m.scale.set(1 - k * 0.6, 1, 1 - k * 0.6); } });
  }
  explosion(pos, color, size) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), mat);
    this.floater(ball, pos, { life: 0.55, update: (f, k) => { ball.scale.setScalar(0.4 + k * size); mat.opacity = 0.85 * (1 - k); } });
    this.ring(pos.clone().setY(0.06), color, size * 1.4, true);
    this.floater(sprite(TEX.glow, 0xffe0a0), pos, { life: 0.3, size: 1, grow: 12 });
    this.bursts.burst(pos, { color, count: 70, speed: 4.5, up: 1.4, life: 1, size: 0.3 });
  }
  spray(from, targets, color, dur) {
    let t = 0;
    const tick = (dt) => {
      t += dt;
      for (const to of targets) {
        for (let i = 0; i < 2; i++) {
          const dir = to.clone().sub(from).add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.3, 0.5), rand(-0.6, 0.6)));
          this.floater(sprite(TEX.flame, color), from.clone(), { vel: dir.multiplyScalar(rand(1.6, 2.2)), life: 0.55, size: 0.35, grow: 1.4 });
        }
      }
      if (t > dur) this.view.tickers.delete(tick);
    };
    this.view.tickers.add(tick);
    setTimeout(() => { for (const to of targets) this.impact(to, color, 1.1); this.shake(0.25); }, dur * 600);
  }
  projectile(from, to, { color, size = 0.5, curve = 0.6, side = 0, trail, time = 0.45, onHit } = {}) {
    const s = sprite(TEX.glow, color);
    s.scale.setScalar(size);
    const light = new THREE.PointLight(color, 3, 4);
    s.add(light);
    const mid = from.clone().add(to).multiplyScalar(0.5).add(new THREE.Vector3(0, curve, side));
    const curveObj = new THREE.QuadraticBezierCurve3(from.clone(), mid, to.clone());
    let lastTrail = 0;
    this.floater(s, from, {
      life: time,
      size,
      update: (f, k) => {
        s.position.copy(curveObj.getPoint(Math.min(1, k)));
        if (trail && f.age - lastTrail > 0.016) {
          lastTrail = f.age;
          this.floater(sprite(TEX.glow, trail), s.position, { life: 0.35, size: size * 0.7, grow: -size * 1.5 });
        }
        if (k >= 1 && !f.hit) { f.hit = true; this.impact(to, color, size + 0.4); if (onHit) onHit(); }
      },
    });
  }
  beam(target) {
    const geo = new THREE.CylinderGeometry(0.45, 0.45, 8, 20, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    this.floater(m, target.group.position.clone().setY(4), { life: 0.6, update: (f, k) => { mat.opacity = 0.8 * (1 - k); } });
  }
  confetti(center) {
    const colors = [0xffd36a, 0xff7a6a, 0x7ee08a, 0x9cc4ff, 0xffffff, 0xd0a0ff];
    for (let i = 0; i < 70; i++) {
      const s = sprite(TEX.glow, colors[i % colors.length], false);
      this.floater(s, center.clone().add(new THREE.Vector3(rand(-2, 2), rand(3, 4.5), rand(-2, 2))), { vel: new THREE.Vector3(rand(-0.6, 0.6), rand(-0.4, 0.6), rand(-0.6, 0.6)), gravity: -1.2, life: rand(2, 3.2), size: rand(0.09, 0.16), delay: rand(0, 0.6) });
    }
    for (let i = 0; i < 3; i++) setTimeout(() => this.bursts.burst(center.clone().add(new THREE.Vector3(rand(-2.5, 2.5), rand(3, 4), rand(-1.5, 1))), { color: colors[i], count: 50, speed: 2.5, gravity: -1.5, life: 1.4 }), 300 + i * 450);
  }

  // Defeated monsters crumble to ash and fade away.
  fadeOut(a) {
    a.fading = { t: 0 };
    for (const m of a.mats) { m.transparent = true; }
  }
  unfade(a) {
    a.fading = null;
    a.group.visible = true;
    a.inner.position.y = 0;
    for (const m of a.mats) { m.opacity = 1; }
  }
  setGhost(a, on) {
    if (a.ghost === on) return;
    a.ghost = on;
    for (const m of a.mats) { m.transparent = on; m.opacity = on ? 0.35 : 1; m.needsUpdate = true; }
  }

  // Status visuals, refreshed every frame.
  statusFx(a, dt) {
    const head = () => a.group.position.clone().add(new THREE.Vector3(0, (a.spec.height || 1.8) * 1.12, 0));
    const T = a.fxTimers;
    const every = (k, s) => { T[k] = (T[k] || 0) - dt; if (T[k] <= 0) { T[k] = s; return true; } return false; };
    if (a.dead) { if (a.stars) { a.group.remove(a.stars); a.stars = null; } return; }
    if (a.st.has('sleep') && every('z', 0.6)) this.floater(sprite(TEX.z, 0xffffff, false), head().add(new THREE.Vector3(0.2, 0, 0)), { vel: new THREE.Vector3(0.25, 0.5, 0), life: 1.6, size: 0.28, grow: 0.2 });
    if (a.st.has('poison') && every('p', 0.22)) this.floater(sprite(TEX.bubble, 0xffffff, false), a.group.position.clone().add(new THREE.Vector3(rand(-0.35, 0.35), rand(0.4, 1.2), rand(-0.3, 0.3))), { vel: new THREE.Vector3(0, 0.6, 0), life: 0.9, size: 0.14 });
    if (a.st.has('charging') && every('c', 0.06)) {
      const ang = this.t * 6;
      this.floater(sprite(TEX.flame, 0xff8a3a), a.group.position.clone().add(new THREE.Vector3(Math.cos(ang) * 0.8, 0.3, Math.sin(ang) * 0.8)), { vel: new THREE.Vector3(-Math.cos(ang) * 0.6, 1.4, -Math.sin(ang) * 0.6), life: 0.8, size: 0.3, grow: -0.2 });
    }
    // stun: stars circling the head
    if (a.st.has('stun') && !a.stars) {
      a.stars = new THREE.Group();
      for (let i = 0; i < 3; i++) { const s = sprite(TEX.star, 0xffffff, false); s.scale.setScalar(0.18); a.stars.add(s); }
      a.group.add(a.stars);
    } else if (!a.st.has('stun') && a.stars) { a.group.remove(a.stars); a.stars = null; }
    if (a.stars) {
      a.stars.position.y = (a.spec.height || 1.8) * 1.08;
      a.stars.children.forEach((s, i) => { const ang = this.t * 4 + (i * Math.PI * 2) / 3; s.position.set(Math.cos(ang) * 0.35, Math.sin(this.t * 6 + i) * 0.04, Math.sin(ang) * 0.35); });
    }
    // spiritual weapon: a glowing hammer circling the cleric
    if (a.st.has('spirit') && !a.hammer) {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0xfff0b0, emissive: 0xffd36a, emissiveIntensity: 1.2, transparent: true, opacity: 0.85 });
      const head2 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.2), mat);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 8), mat);
      handle.position.y = -0.3;
      g.add(head2, handle, new THREE.PointLight(0xffe0a0, 2, 3));
      a.hammer = g;
      this.scene.add(g);
    } else if (!a.st.has('spirit') && a.hammer) { this.scene.remove(a.hammer); a.hammer = null; }
    if (a.hammer) {
      const ang = this.t * 2;
      a.hammer.position.copy(a.group.position).add(new THREE.Vector3(Math.cos(ang) * 0.9, 1.6 + Math.sin(this.t * 3) * 0.15, Math.sin(ang) * 0.9));
      a.hammer.rotation.z = Math.sin(this.t * 4) * 0.6;
    }
    // bless: golden aura underfoot
    const targetAura = a.st.has('blessed') ? 0.55 + Math.sin(this.t * 4) * 0.2 : 0;
    a.aura.material.opacity += (targetAura - a.aura.material.opacity) * Math.min(1, dt * 6);
  }

  // Where a fighter is on screen (for floating damage numbers).
  rect(kind, id) {
    const a = (kind === 'foe' ? this.foes : this.heroes).get(id);
    if (!a || !this.view.visible() || this.view.container.hidden) return null;
    const p = a.group.position.clone().add(new THREE.Vector3(0, (a.spec.height || 1.8) * 1.05, 0));
    p.project(this.camera);
    if (p.z > 1) return null;
    const r = this.view.canvas.getBoundingClientRect();
    const x = r.left + ((p.x + 1) / 2) * r.width;
    const y = r.top + ((1 - p.y) / 2) * r.height;
    return { left: x - 40, top: y - 10, width: 80, height: 90 };
  }

  // ---------- frame ----------
  tick(dt) {
    this.t += dt;
    // hit-stop: the world freezes for a heartbeat on impact
    const adt = this.freeze > 0 ? 0 : dt;
    this.freeze = Math.max(0, this.freeze - dt);
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t = Math.min(1, tw.t + adt / tw.dur);
      tw.vec.lerpVectors(tw.from, tw.to, ease(tw.t));
      if (tw.t >= 1) { this.tweens.splice(i, 1); if (tw.done) tw.done(); }
    }
    for (const a of [...this.heroes.values(), ...this.foes.values()]) {
      a.update(adt);
      this.statusFx(a, dt);
      if (a.fading) {
        a.fading.t = Math.min(1, a.fading.t + dt * 0.8);
        const k = a.fading.t;
        for (const m of a.mats) m.opacity = 1 - k;
        a.inner.position.y = -0.4 * k;
        if (Math.random() < 0.6) this.floater(sprite(TEX.glow, 0x3a3430, false), a.group.position.clone().add(new THREE.Vector3(rand(-0.4, 0.4), rand(0.1, 0.9), rand(-0.3, 0.3))), { vel: new THREE.Vector3(rand(-0.2, 0.2), rand(0.5, 1), 0), life: 1, size: 0.12, opacity: 0.8 });
        if (k >= 1) { a.group.visible = false; a.fading = null; }
      }
    }
    this.bursts.update(adt);
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.age += dt;
      if (f.age < 0) continue;
      f.obj.visible = true;
      const k = Math.min(1, f.age / f.life);
      f.vel.y += f.gravity * dt;
      f.obj.position.addScaledVector(f.vel, dt);
      if (f.grow) { if (f.obj.isSprite) f.obj.scale.setScalar(Math.max(0.01, f.size + f.grow * k)); else f.obj.scale.setScalar(Math.max(0.01, 1 + f.grow * k)); }
      if (f.obj.material && f.obj.isSprite) f.obj.material.opacity = f.opacity * (1 - k * k);
      if (f.update) f.update(f, k);
      if (k >= 1) {
        this.scene.remove(f.obj);
        if (f.obj.material) f.obj.material.dispose();
        if (f.obj.geometry) f.obj.geometry.dispose();
        this.floaters.splice(i, 1);
      }
    }
    // markers
    if (this.active && !this.active.dead && !this.orbit) {
      this.arrow.visible = true;
      this.arrow.position.copy(this.active.group.position).add(new THREE.Vector3(0, (this.active.spec.height || 1.8) * 1.12 + 0.5 + Math.sin(this.t * 5) * 0.08, 0));
      this.arrow.rotation.y += dt * 2.5;
    } else this.arrow.visible = false;
    if (this.target && !this.target.dead && !this.orbit) {
      this.reticle.visible = true;
      this.reticle.position.copy(this.target.group.position).setY(0.05);
      this.reticle.rotation.z += dt * 1.6;
      const s = 1 + Math.sin(this.t * 5) * 0.06;
      this.reticle.scale.set(s, s, s);
    } else this.reticle.visible = false;

    // camera: intro sweep, victory orbit, action focus, zoom punch, shake
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.2);
    this.zoom = Math.max(0, this.zoom - dt * 0.9);
    if (this.action) { this.action.hold -= dt; if (this.action.hold <= 0) { this.action.w -= dt * 1.5; if (this.action.w <= 0) this.action = null; } }
    const look = this.focus.clone();
    if (this.action) look.lerp(this.action.point, Math.max(0, Math.min(1, this.action.w)) * 0.6);
    this.look.lerp(look, Math.min(1, dt * 3));
    const pos = CAM_HOME.clone();
    pos.x += Math.sin(this.t * 0.25) * 0.35 + (this.look.x - LOOK_HOME.x) * 0.5;
    if (this.intro) {
      this.intro.t += dt;
      const k = ease(Math.min(1, this.intro.t / this.intro.dur));
      const ang = (1 - k) * 1.2;
      const start = new THREE.Vector3(Math.sin(ang) * 11, 6 - k * 2.7, Math.cos(ang) * 11 * (this.intro.boss ? 0.8 : 1));
      pos.lerpVectors(start, pos, k);
      if (k >= 1) this.intro = null;
    }
    if (this.orbit) {
      this.orbit.t += dt;
      const ang = 0.9 + this.orbit.t * 0.55;
      const c = this.orbit.center;
      const op = new THREE.Vector3(c.x + Math.sin(ang) * 7.5, 3, c.z + Math.cos(ang) * 7.5);
      const k = Math.min(1, this.orbit.t * 1.5);
      pos.lerp(op, k);
      this.look.lerp(c, k);
    }
    const dir = this.look.clone().sub(pos);
    pos.addScaledVector(dir.normalize(), this.zoom * 2);
    pos.x += (Math.random() - 0.5) * this.shakeAmt;
    pos.y += (Math.random() - 0.5) * this.shakeAmt;
    this.camera.position.copy(pos);
    this.camera.lookAt(this.look);
  }
}

function setTint(obj, color, plain) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    if (plain) { o.material.map = null; o.material.color = new THREE.Color(color); } // snow: no grass texture
    else o.material.color.multiply(new THREE.Color(color));
  });
}
