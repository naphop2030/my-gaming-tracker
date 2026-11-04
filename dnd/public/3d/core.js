// Shared 3D pieces: model loading, animated actors (heroes and monsters), views and particles.
// Models are free CC0 assets by KayKit (Kay Lousberg) and Quaternius; see public/art/CREDITS.md.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

export { THREE };

// ---------- assets ----------
const loader = new GLTFLoader();
const cache = new Map();
export function loadModel(name) {
  if (!cache.has(name)) cache.set(name, loader.loadAsync(`/models/${name}.glb`));
  return cache.get(name);
}

let kitPromise = null;
// One piece of scenery from the world kit (tiles, buildings, trees, graves...).
export async function kitPiece(name) {
  if (!kitPromise) kitPromise = loadModel('world-kit');
  const kit = await kitPromise;
  const src = kit.scene.getObjectByName(name);
  if (!src) return new THREE.Group();
  const piece = src.clone(true);
  piece.position.set(0, 0, 0);
  piece.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return piece;
}

// ---------- who looks like what ----------
const KAYKIT_BODY = /(ArmLeft|ArmRight|Body|Head|Head_Hooded|LegLeft|LegRight)$/;
const KAYKIT_ANIMS = { idle: 'Idle', attack: '1H_Melee_Attack_Chop', cast: 'Spellcast_Shoot', raise: 'Spellcast_Raise', hit: 'Hit_A', death: 'Death_A', dead: 'Death_A_Pose', cheer: 'Cheer', walk: 'Walking_A', block: 'Block', use: 'Use_Item' };

export const CAST = {
  // heroes
  fighter: { model: 'knight', show: ['1H_Sword', 'Round_Shield', 'Knight_Helmet', 'Knight_Cape'], height: 1.8 },
  cleric: { model: 'barbarian', show: ['1H_Axe', 'Barbarian_Round_Shield', 'Barbarian_Hat', 'Barbarian_Cape'], height: 1.8, anims: { cast: 'Spellcast_Raise' } },
  rogue: { model: 'rogue-hooded', show: ['Knife', 'Knife_Offhand', 'Rogue_Cape'], height: 1.7, anims: { attack: '1H_Melee_Attack_Stab' } },
  wizard: { model: 'mage', show: ['2H_Staff', 'Mage_Hat', 'Mage_Cape'], height: 1.75, anims: { attack: '2H_Melee_Attack_Chop' } },
  // monsters
  wolf: { model: 'wolf', height: 1.05, anims: { idle: 'Idle', attack: 'Attack', hit: 'Idle_HitReact_Left', death: 'Death', walk: 'Walk', cheer: 'Idle_2' } },
  spider: { model: 'spider', height: 0.75, anims: { idle: 'Spider_Idle', attack: 'Spider_Attack', death: 'Spider_Death', walk: 'Spider_Walk' } },
  bandit: { model: 'rogue', show: ['Knife', 'Rogue_Cape'], height: 1.7, tint: 0xb59a7a, anims: { attack: '1H_Melee_Attack_Slice_Diagonal' } },
  vesh: { model: 'rogue', show: ['Knife', 'Knife_Offhand', 'Rogue_Cape'], height: 2.05, tint: 0xff8a7a, anims: { attack: '1H_Melee_Attack_Slice_Diagonal' } },
  zombie: { model: 'orc', height: 1.85, tint: 0x9fb894, anims: { idle: 'Idle', attack: 'Punch', hit: 'HitReact', death: 'Death', walk: 'Walk', cheer: 'Yes' } },
  skeleton: { model: 'skeleton-warrior', height: 1.75, weapons: { 'handslot.r': 'Skeleton_Blade', 'handslot.l': 'Skeleton_Shield_Small_A' }, anims: { awaken: 'Skeletons_Awaken_Standing', idle: 'Idle_Combat' } },
  cultist: { model: 'mage', show: ['1H_Wand', 'Mage_Cape'], height: 1.7, tint: 0xc0605a, anims: { attack: 'Spellcast_Shoot' } },
  priest: { model: 'mage', show: ['2H_Staff', 'Mage_Hat', 'Mage_Cape'], height: 2.35, tint: 0xffb08a, glow: 0xff4a10, anims: { attack: 'Spellcast_Shoot' } },
};
export const castFor = (kind) => CAST[kind] || CAST.bandit;

// ---------- actors ----------
export class Actor {
  static async create(kind, opts = {}) {
    const spec = castFor(kind);
    const gltf = await loadModel(spec.model);
    const model = cloneSkinned(gltf.scene);
    // Show only this role's gear (KayKit models ship with every weapon attached).
    model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
    if (spec.show) {
      model.traverse((o) => {
        if (!(o.isMesh || o.isSkinnedMesh || o.isGroup) || o === model) return;
        const name = o.name || '';
        const isPart = spec.show.includes(name) || KAYKIT_BODY.test(name);
        if ((o.isMesh || o.isSkinnedMesh) && !isPart && !(o.parent && (spec.show.includes(o.parent.name) || KAYKIT_BODY.test(o.parent.name)))) o.visible = false;
      });
    }
    // Per-actor materials so tints and hit flashes don't leak onto other actors.
    const mats = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      const cloned = list.map((m) => {
        const c = m.clone();
        if (spec.tint) c.color.multiply(new THREE.Color(spec.tint));
        if (spec.glow) { c.emissive = new THREE.Color(spec.glow); c.emissiveIntensity = 0.18; }
        mats.push(c);
        return c;
      });
      o.material = Array.isArray(o.material) ? cloned : cloned[0];
    });
    if (spec.weapons) {
      for (const [bone, piece] of Object.entries(spec.weapons)) {
        const slot = model.getObjectByName(bone);
        if (slot) slot.add(await kitPiece(piece));
      }
    }
    // Normalize size so every model stands at its intended height with feet on the ground.
    // Measure in the idle pose with exact vertex positions: some models are authored at 100x
    // scale under a rotated armature, so their unposed bounds are meaningless.
    const idle = gltf.animations.find((c) => c.name === ((spec.anims && spec.anims.idle) || 'Idle')) || gltf.animations.find((c) => /idle/i.test(c.name));
    if (idle) {
      const m = new THREE.AnimationMixer(model);
      m.clipAction(idle).play();
      m.update(0);
      m.stopAllAction();
    }
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true);
    const h = Math.max(0.01, box.max.y - box.min.y);
    const s = ((spec.height || 1.8) * (opts.scale || 1)) / h;
    model.scale.setScalar(s);
    model.position.y = -box.min.y * s;
    const group = new THREE.Group(); // positioned by the board / stage
    const inner = new THREE.Group(); // the actor's own bob, lunge and fall
    inner.add(model);
    group.add(inner);
    return new Actor(kind, spec, group, inner, model, gltf.animations, mats);
  }

  constructor(kind, spec, group, inner, model, clips, mats) {
    this.kind = kind;
    this.spec = spec;
    this.group = group;
    this.inner = inner;
    this.model = model;
    this.mats = mats;
    this.mixer = new THREE.AnimationMixer(model);
    this.clips = new Map(clips.map((c) => [c.name, c]));
    this.current = null;
    this.dead = false;
    this.t = Math.random() * 10;
    this.flash = 0;
    this.lunge = 0;
    this.procedural = this.clips.size === 0;
    this.mixer.addEventListener('finished', () => {
      if (this.dead) return;
      this.play('idle');
    });
    this.play(spec.anims && spec.anims.awaken && this.clips.has(spec.anims.awaken) ? 'awaken' : 'idle', { once: !!(spec.anims && spec.anims.awaken) });
  }

  clipFor(role) {
    const name = (this.spec.anims && this.spec.anims[role]) || KAYKIT_ANIMS[role];
    return name && this.clips.get(name);
  }

  play(role, { once = role !== 'idle' && role !== 'walk' && role !== 'dead', fade = 0.18 } = {}) {
    if (this.procedural) {
      if (role === 'attack' || role === 'cast') this.lunge = 1;
      if (role === 'death') this.dead = true;
      return 0.6;
    }
    let clip = this.clipFor(role);
    if (!clip && role === 'cast') clip = this.clipFor('attack');
    if (!clip && role === 'dead') clip = this.clipFor('death');
    if (!clip) { if (role === 'death') this.dead = true; return 0; }
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = once;
    if (role === 'dead') action.time = clip.duration;
    if (this.current && this.current !== action) this.current.crossFadeTo(action, fade, false);
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.play();
    this.current = action;
    if (role === 'death' || role === 'dead') this.dead = true;
    return clip.duration;
  }

  revive() { this.dead = false; this.play('idle'); }

  hitFlash() { this.flash = 1; if (this.procedural || !this.clipFor('hit')) this.shake = 1; }

  update(dt) {
    this.t += dt;
    this.mixer.update(dt);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 3);
      for (const m of this.mats) { if (m.emissive) { m.emissive.setRGB(this.flash * 0.9, this.flash * 0.1, 0); m.emissiveIntensity = 1; } }
      if (this.flash === 0 && this.spec.glow) for (const m of this.mats) { m.emissive.set(this.spec.glow); m.emissiveIntensity = 0.18; }
    }
    // Simple motion for models without animations, and a shake for hit reactions.
    let x = 0;
    let y = 0;
    let tilt = 0;
    if (this.procedural) {
      y = this.dead ? 0 : Math.sin(this.t * 2) * 0.05;
      if (this.lunge > 0) { this.lunge = Math.max(0, this.lunge - dt * 2.2); x = Math.sin(this.lunge * Math.PI) * 0.6; }
      if (this.dead) { this.deadT = Math.min(1, (this.deadT || 0) + dt * 1.5); tilt = this.deadT * Math.PI / 2; y = -this.deadT * 0.2; }
    }
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 3); x += Math.sin(this.t * 60) * 0.06 * this.shake; }
    this.inner.rotation.z = -tilt;
    this.inner.position.set(0, y, x);
  }
}

// ---------- a 3D view that only renders while it's on screen ----------
export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

export class View {
  constructor(container, { shadows = true, alpha = false } = {}) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = shadows && window.innerWidth > 700;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'view3d';
    container.append(this.canvas);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
    this.last = performance.now();
    this.tickers = new Set();
    this.running = false;
    this.loop = this.loop.bind(this);
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }
  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  visible() { return this.container.isConnected && this.container.getClientRects().length > 0 && !document.hidden; }
  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.loop);
  }
  loop() {
    if (!this.visible()) { this.running = false; return; }
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    for (const fn of this.tickers) fn(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.loop);
  }
}

export function lights(scene, mood) {
  const clear = mood === 'clear';
  scene.add(new THREE.HemisphereLight(clear ? 0xdfeeff : 0xe6ddd2, clear ? 0x4a5a3a : 0x3a3029, clear ? 1.3 : 1.15));
  const sun = new THREE.DirectionalLight(clear ? 0xfff2d6 : 0xffe0bd, clear ? 2.6 : 1.9);
  sun.position.set(-12, 22, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const c = sun.shadow.camera;
  c.left = -30; c.right = 30; c.top = 30; c.bottom = -30; c.near = 1; c.far = 80;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  return sun;
}

// ---------- particles ----------
const dotTexture = (() => {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

// Short-lived bursts of glowing points (hits, heals, spells).
export class Bursts {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
  }
  burst(pos, { color = 0xffffff, count = 24, speed = 2.5, up = 1, life = 0.9, size = 0.22, gravity = -3 } = {}) {
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    const v = [];
    for (let i = 0; i < count; i++) {
      p.set([pos.x, pos.y, pos.z], i * 3);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * up, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      v.push(dir);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const mat = new THREE.PointsMaterial({ color, size, map: dotTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    this.list.push({ pts, v, life, age: 0, gravity });
  }
  // A glowing ball flying from a to b (fire bolt, magic missile).
  projectile(a, b, { color = 0xff7a2a, time = 0.45, size = 0.5, onHit } = {}) {
    const mat = new THREE.SpriteMaterial({ map: dotTexture, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const s = new THREE.Sprite(mat);
    s.scale.setScalar(size);
    s.position.copy(a);
    this.scene.add(s);
    const light = new THREE.PointLight(color, 3, 4);
    s.add(light);
    this.list.push({ sprite: s, a: a.clone(), b: b.clone(), time, age: 0, onHit, color });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const it = this.list[i];
      it.age += dt;
      if (it.sprite) {
        const k = Math.min(1, it.age / it.time);
        it.sprite.position.lerpVectors(it.a, it.b, k);
        it.sprite.position.y += Math.sin(k * Math.PI) * 0.6;
        if (k >= 1) {
          this.scene.remove(it.sprite);
          it.sprite.material.dispose();
          this.list.splice(i, 1);
          this.burst(it.b, { color: it.color, count: 30, speed: 3 });
          if (it.onHit) it.onHit();
        }
        continue;
      }
      const pos = it.pts.geometry.attributes.position;
      for (let j = 0; j < it.v.length; j++) {
        it.v[j].y += it.gravity * dt;
        pos.array[j * 3] += it.v[j].x * dt;
        pos.array[j * 3 + 1] += it.v[j].y * dt;
        pos.array[j * 3 + 2] += it.v[j].z * dt;
      }
      pos.needsUpdate = true;
      it.pts.material.opacity = Math.max(0, 1 - it.age / it.life);
      if (it.age >= it.life) {
        this.scene.remove(it.pts);
        it.pts.geometry.dispose();
        it.pts.material.dispose();
        this.list.splice(i, 1);
      }
    }
  }
}

// Gentle falling ash or floating motes over a whole scene.
export function weatherPoints(scene, mood, area = 40, height = 14) {
  const count = mood === 'clear' ? 160 : 700;
  const geo = new THREE.BufferGeometry();
  const p = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) p.set([(Math.random() - 0.5) * area, Math.random() * height, (Math.random() - 0.5) * area], i * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const mat = new THREE.PointsMaterial({
    color: mood === 'clear' ? 0xffe2a0 : 0xd8cfc4, size: mood === 'clear' ? 0.12 : 0.09, map: dotTexture,
    transparent: true, opacity: mood === 'clear' ? 0.7 : 0.8, depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  let t = 0;
  return (dt) => {
    t += dt;
    const a = geo.attributes.position.array;
    for (let i = 0; i < count; i++) {
      if (mood === 'clear') { a[i * 3 + 1] += dt * 0.3; if (a[i * 3 + 1] > height) a[i * 3 + 1] = 0; } else {
        a[i * 3 + 1] -= dt * (0.6 + (i % 7) * 0.08);
        a[i * 3] += Math.sin(t + i) * dt * 0.2;
        if (a[i * 3 + 1] < 0) a[i * 3 + 1] = height;
      }
    }
    geo.attributes.position.needsUpdate = true;
  };
}

// Scenery recipe for each place: [kit piece, x, z, rotation (turns), scale].
// Locations from other adventures fall back to a recipe for their region.
export const DIORAMAS = {
  thornwick: [['building_church_yellow', 0, -0.6, 0, 0.9], ['building_home_A_yellow', -1.5, 0.4, 0.1, 0.8], ['building_home_B_red', 1.4, 0.5, -0.15, 0.8], ['building_tavern_yellow', -1.2, -1.6, 0.25, 0.75], ['building_well_yellow', 0.3, 1.2, 0, 0.7], ['building_windmill_yellow', 2.2, -1.3, 0.3, 0.8], ['tree_single_A', -2.3, 1.4, 0, 0.7]],
  'old-road': [['rock_single_A', 0.6, 0.4, 0, 0.9], ['post_lantern', -0.5, 0.6, 0, 0.9], ['rock_single_C', -0.8, -0.6, 0.3, 0.7], ['hill_single_A', 1.6, -1.2, 0, 0.7]],
  whisperwood: [['trees_B_large', 0, 0, 0, 0.9], ['trees_A_large', -1.6, 0.6, 0.2, 0.8], ['trees_B_medium', 1.5, 0.8, 0.5, 0.8], ['tree_single_B', 0.8, -1.6, 0, 0.8], ['trees_A_large', -0.8, -1.7, 0.6, 0.8]],
  hollow: [['building_home_B_green', 0, 0, 0.1, 0.85], ['hills_A_trees', -1.8, -1.2, 0, 0.7], ['tree_single_A', 1.4, -0.6, 0, 0.7], ['barrel', 0.9, 0.9, 0, 0.8]],
  watchtower: [['building_tower_B_red', 0, -0.3, 0, 0.9], ['tent', -1.4, 0.8, 0.2, 0.8], ['tent', 1.3, 0.9, -0.2, 0.8], ['flag_red', 0.9, -0.9, 0, 0.9], ['crate_A_big', -0.6, 1.2, 0.1, 0.7], ['building_destroyed', 1.8, -1.6, 0, 0.7]],
  greyfen: [['tree_dead_large', 0, -0.4, 0, 0.9], ['tree_dead_medium', 1.4, 0.6, 0.3, 0.9], ['waterplant_A', -0.9, 0.7, 0, 1], ['waterplant_B', 0.6, 1.2, 0, 1], ['waterlily_A', -0.4, 1.5, 0, 1], ['tree_dead_medium', -1.6, -0.9, 0.6, 0.8]],
  crypt: [['crypt', 0, -0.3, 0, 0.9], ['grave_A', -1.3, 0.8, 0.1, 0.9], ['gravestone', 1.2, 0.9, -0.1, 0.9], ['candle_triple', 0.4, 1.0, 0, 1], ['tree_dead_large', -1.6, -1.2, 0, 0.8], ['fence_broken', 1.5, -0.4, 0.25, 0.9]],
  abbey: [['building_church_blue', 0, 0, 0, 1.25], ['building_tower_A_blue', 1.6, -0.9, 0, 1.0], ['wall_straight', -1.7, 0.9, 0.25, 0.9], ['wall_straight', 1.7, 1.1, -0.25, 0.9], ['mountain_B_grass', -2.2, -2.2, 0, 0.8], ['lantern_standing', 0.6, 1.4, 0, 0.9]],
};
const REGION_FALLBACK = { village: 'thornwick', forest: 'whisperwood', marsh: 'greyfen', underground: 'crypt', abbey: 'abbey', ruins: 'watchtower', hills: 'hollow', crossroads: 'old-road' };
export function dioramaFor(id, region) {
  return DIORAMAS[id] || DIORAMAS[REGION_FALLBACK[String(region || '').toLowerCase()]] || [['building_home_A_yellow', 0, 0, 0, 0.8], ['tree_single_A', 1.2, 0.6, 0, 0.7]];
}
export const isWatery = (id, region) => id === 'greyfen' || /marsh|swamp|lake|coast/i.test(region || '');
