// The 3D world map: a hex-tile game board with a little diorama for every place you know about,
// stepping-stone roads, fog over unexplored land, and the party's miniature walking between places.
import { THREE, View, kitPiece, Actor, lights, weatherPoints, dioramaFor, isWatery } from './core.js';
import { makeDie } from './dice.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const S = 0.34; // world units per map unit (the adventure map is 100 x 70)
const toWorld = (x, y) => new THREE.Vector3((x - 50) * S, 0, (y - 35) * S);
const HALF_W = 50 * S + 1.5;
const HALF_D = 35 * S + 1.5;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Smooth value noise, for patches of meadow, dry grass and forest.
function hash(x, z) { const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return h - Math.floor(h); }
function noise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, z) => noise(x, z) * 0.65 + noise(x * 2.3 + 7, z * 2.3 + 3) * 0.35;

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Wood planks for the table, drawn once.
const woodTex = () => canvasTex(1024, 1024, (g, w, h) => {
  const r = rng(5);
  const planks = 6;
  for (let i = 0; i < planks; i++) {
    const y0 = (i * h) / planks;
    const base = [92 + r() * 20, 60 + r() * 12, 36 + r() * 8];
    g.fillStyle = `rgb(${base.map(Math.round).join(',')})`;
    g.fillRect(0, y0, w, h / planks);
    for (let k = 0; k < 60; k++) {
      const y = y0 + r() * (h / planks);
      g.strokeStyle = `rgba(${r() < 0.5 ? '40,24,12' : '150,110,70'},${0.08 + r() * 0.12})`;
      g.lineWidth = 1 + r() * 3;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= w; x += 64) g.lineTo(x, y + Math.sin(x / 140 + k) * 4 * r());
      g.stroke();
    }
    for (let k = 0; k < 2; k++) { // knots
      const x = r() * w, y = y0 + 20 + r() * (h / planks - 40);
      g.fillStyle = 'rgba(40,22,10,.45)';
      g.beginPath(); g.ellipse(x, y, 10 + r() * 14, 5 + r() * 5, 0, 0, 7); g.fill();
    }
    g.fillStyle = 'rgba(20,10,4,.7)';
    g.fillRect(0, y0, w, 3);
  }
});
const softTex = canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(0.5, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
const flameTex = canvasTex(32, 64, (g) => { const r = g.createRadialGradient(16, 44, 1, 16, 40, 30); r.addColorStop(0, 'rgba(255,250,210,1)'); r.addColorStop(0.35, 'rgba(255,180,60,.9)'); r.addColorStop(1, 'rgba(255,60,0,0)'); g.fillStyle = r; g.beginPath(); g.moveTo(16, 0); g.quadraticCurveTo(32, 36, 16, 63); g.quadraticCurveTo(0, 36, 16, 0); g.fill(); });

// Curved road between two places (same curve as the 2D map).
function roadPoints(a, b, step = 0.42) {
  const A = toWorld(a.x, a.y);
  const B = toWorld(b.x, b.y);
  const mx = (a.x + b.x) / 2 + (a.y - b.y) * 0.08;
  const my = (a.y + b.y) / 2 + (b.x - a.x) * 0.08;
  const M = toWorld(mx, my);
  const curve = new THREE.QuadraticBezierCurve3(A, M, B);
  const n = Math.max(2, Math.round(curve.getLength() / step));
  return curve.getSpacedPoints(n);
}

// Darker copies of materials for fog-of-war (cached so they're shared).
const dimCache = new WeakMap();
function dimmed(mat) {
  if (!dimCache.has(mat)) {
    const d = mat.clone();
    d.color = d.color.clone().multiplyScalar(0.32);
    dimCache.set(mat, d);
  }
  return dimCache.get(mat);
}
function setDim(obj, dim) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.userData.mat) o.userData.mat = o.material;
    o.material = dim ? dimmed(o.userData.mat) : o.userData.mat;
  });
}

export class Board {
  constructor(container, labels) {
    this.view = new View(container);
    this.labels = labels;
    this.scene = this.view.scene;
    this.camera = this.view.camera;
    this.ready = this.build();
    this.key = '';
    this.here = null;
    this.dioramas = new Map();
    this.pins = new Map();
    this.walk = null;
    this.ctx = null;
  }

  async build() {
    const scene = this.scene;
    this.controls = new OrbitControls(this.camera, this.view.canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, minDistance: 7, maxDistance: 34, minPolarAngle: 0.35, maxPolarAngle: 1.12, screenSpacePanning: false });
    this.camera.position.set(0, 14, 12);
    this.controls.target.set(0, 0, 0);
    this.controls.addEventListener('change', () => {
      const t = this.controls.target;
      t.x = Math.max(-HALF_W, Math.min(HALF_W, t.x));
      t.z = Math.max(-HALF_D, Math.min(HALF_D, t.z));
      t.y = 0;
    });

    // The board sits on a wooden table in a dim, candle-lit room.
    scene.background = canvasTex(512, 512, (g) => { const r = g.createRadialGradient(256, 300, 40, 256, 256, 360); r.addColorStop(0, '#3a2a1e'); r.addColorStop(1, '#0b0705'); g.fillStyle = r; g.fillRect(0, 0, 512, 512); });
    const wood = woodTex();
    wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
    wood.repeat.set(2, 2);
    const table = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 + 26, 0.6, HALF_D * 2 + 22), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.75 }));
    table.position.y = -0.85;
    table.receiveShadow = true;
    scene.add(table);
    // a dark wooden frame around the board, like a real game box
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.6, metalness: 0.05 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.35, metalness: 0.8 });
    const fw = 0.7;
    for (const [w, d, x, z] of [[HALF_W * 2 + fw * 2, fw, 0, -HALF_D - fw / 2], [HALF_W * 2 + fw * 2, fw, 0, HALF_D + fw / 2], [fw, HALF_D * 2, -HALF_W - fw / 2, 0], [fw, HALF_D * 2, HALF_W + fw / 2, 0]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.75, d), frameMat);
      b.position.set(x, -0.2, z);
      b.castShadow = b.receiveShadow = true;
      scene.add(b);
      const long = w > d;
      const t = new THREE.Mesh(new THREE.BoxGeometry(long ? w + 0.02 : w * 0.25, 0.05, long ? d * 0.25 : d + 0.02), trimMat);
      t.position.set(x, 0.19, z);
      scene.add(t);
    }
    const under = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2, 0.5, HALF_D * 2), new THREE.MeshStandardMaterial({ color: 0x2a1c12 }));
    under.position.y = -0.45;
    scene.add(under);
    this.addTableProps();

    this.grass = await kitPiece('hex_grass');
    this.water = await kitPiece('hex_water');
    const box = new THREE.Box3().setFromObject(this.grass);
    const size = box.getSize(new THREE.Vector3());
    this.tileTop = box.max.y;
    this.flatTop = size.x >= size.z; // corners point along x
    this.r = Math.max(size.x, size.z) / 2;

    // Click a place on the board to travel there.
    const ray = new THREE.Raycaster();
    let down = null;
    this.view.canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    this.view.canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
      const rect = this.view.canvas.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
      const hits = ray.intersectObjects([...this.dioramas.values()], true);
      for (const h of hits) {
        let o = h.object;
        while (o && !o.userData.loc) o = o.parent;
        if (o) { this.ctx && this.ctx.pick(o.userData.loc); break; }
      }
    });
    this.view.tickers.add((dt) => this.tick(dt));
  }

  // Things lying on the table around the board: candles, dice, coins and a rolled-up map.
  async addTableProps() {
    const scene = this.scene;
    const y = -0.55;
    this.candles = [];
    for (const [x, z] of [[-HALF_W - 4, -HALF_D + 1], [HALF_W + 4.5, -HALF_D - 1.5], [HALF_W + 3, HALF_D + 2.5]]) {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      const wax = new THREE.MeshStandardMaterial({ color: 0xeee2c8, roughness: 0.6 });
      const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.12, 20), new THREE.MeshStandardMaterial({ color: 0x8a6a30, metalness: 0.8, roughness: 0.35 }));
      dish.position.y = 0.06;
      g.add(dish);
      const flames = [];
      for (const [dx, dz, h] of [[0, 0, 1.6], [0.35, 0.2, 1.1], [-0.3, 0.25, 0.8]]) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, h, 12), wax);
        c.position.set(dx, 0.12 + h / 2, dz);
        c.castShadow = true;
        g.add(c);
        const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        fl.position.set(dx, 0.12 + h + 0.2, dz);
        fl.scale.set(0.22, 0.42, 1);
        g.add(fl);
        flames.push(fl);
      }
      const light = new THREE.PointLight(0xffa850, 18, 16, 1.6);
      light.position.y = 2.2;
      g.add(light);
      scene.add(g);
      this.candles.push({ light, flames, seed: x * 3.1 + z });
    }
    // a pair of d20s, mid-roll forever
    for (const [x, z, s, col] of [[HALF_W + 3, -HALF_D + 4, 0.55, 0x8c1f1a], [HALF_W + 4.4, -HALF_D + 5.2, 0.45, 0x2a3f8c]]) {
      const { mesh } = makeDie();
      mesh.material = mesh.material.clone();
      mesh.material.color = new THREE.Color(col);
      mesh.scale.setScalar(s);
      mesh.position.set(x, y + s * 0.8, z);
      mesh.rotation.set(x, z, s * 10);
      mesh.castShadow = true;
      scene.add(mesh);
    }
    // gold coins, a few stacked
    const coin = new THREE.CylinderGeometry(0.28, 0.28, 0.06, 18);
    const gold = new THREE.MeshStandardMaterial({ color: 0xe0b040, metalness: 0.9, roughness: 0.3 });
    const r = rng(19);
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(coin, gold);
      const stack = i < 6;
      m.position.set(-HALF_W - 3 + (stack ? 0 : (r() - 0.5) * 3), y + 0.03 + (stack ? i * 0.065 : 0), HALF_D + 1 + (stack ? 0 : (r() - 0.5) * 2.5));
      if (!stack) m.rotation.set((r() - 0.5) * 0.2, 0, (r() - 0.5) * 0.2);
      m.castShadow = true;
      scene.add(m);
    }
    // a rolled-up parchment
    const scroll = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 4, 20), new THREE.MeshStandardMaterial({ color: 0xd9c49a, roughness: 0.9 }));
    scroll.rotation.set(0, 0.4, Math.PI / 2);
    scroll.position.set(-HALF_W - 3.2, y + 0.35, -HALF_D + 5);
    scroll.castShadow = true;
    scene.add(scroll);
    const ribbon = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.05, 6, 20), new THREE.MeshStandardMaterial({ color: 0x8a1f1a }));
    ribbon.position.copy(scroll.position);
    ribbon.rotation.set(0, 0.4 + Math.PI / 2, 0);
    scene.add(ribbon);
  }

  tiles() {
    // Hex centers covering the board.
    const out = [];
    const r = this.r * 1.0;
    if (this.flatTop) {
      const dx = r * 1.5;
      const dz = Math.sqrt(3) * r;
      for (let c = 0, x = -HALF_W; x <= HALF_W; c++, x += dx) for (let z = -HALF_D + (c % 2 ? dz / 2 : 0); z <= HALF_D; z += dz) out.push([x, z]);
    } else {
      const dx = Math.sqrt(3) * r;
      const dz = r * 1.5;
      for (let row = 0, z = -HALF_D; z <= HALF_D; row++, z += dz) for (let x = -HALF_W + (row % 2 ? dx / 2 : 0); x <= HALF_W; x += dx) out.push([x, z]);
    }
    return out;
  }

  // Builds instanced copies of a kit piece. Each placement has a color `c` (patches of meadow,
  // dry grass, ash, and darker tiles for fog of war).
  instanced(piece, placements) {
    const group = new THREE.Group();
    piece.updateMatrixWorld(true);
    const m4 = new THREE.Matrix4();
    piece.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material.clone(), placements.length);
      inst.receiveShadow = true;
      placements.forEach((p, i) => {
        m4.makeTranslation(p.x, p.y || 0, p.z).multiply(mesh.matrixWorld);
        inst.setMatrixAt(i, m4);
        inst.setColorAt(i, p.c);
      });
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
    });
    return group;
  }

  async rebuild(A) {
    const scene = this.scene;
    for (const o of this.dynamic || []) scene.remove(o);
    this.dynamic = [];
    const add = (o) => { scene.add(o); this.dynamic.push(o); return o; };
    const mood = A.ambience === 'clear' ? 'clear' : 'ash';
    const known = A.world.nodes;
    const knownPos = known.map((n) => ({ n, p: toWorld(n.x, n.y) }));
    const water = known.filter((n) => isWatery(n.id, n.region)).map((n) => toWorld(n.x, n.y));

    if (this.mood !== mood) {
      this.mood = mood;
      if (this.lightsGroup) scene.remove(this.lightsGroup);
      this.lightsGroup = new THREE.Group();
      const tmp = new THREE.Scene();
      lights(tmp, mood);
      for (const l of [...tmp.children]) this.lightsGroup.add(l);
      scene.add(this.lightsGroup);
      const sky = mood === 'clear' ? 0x9fbfdc : 0x4a3a30;
      scene.background = new THREE.Color(sky);
      scene.fog = new THREE.Fog(sky, 28, 70);
      if (this.weather) this.view.tickers.delete(this.weather.tick), scene.remove(this.weather.pts);
      const before = scene.children.length;
      const tick = weatherPoints(scene, mood, HALF_W * 2, 12);
      this.weather = { tick, pts: scene.children[before] };
      this.view.tickers.add(tick);
    }

    // Tiles: lit near places you know, dark (fog of war) elsewhere. The grass varies in
    // patches, forests grow in clumps, and mountains crowd the edges of the board.
    const grassP = [];
    const waterP = [];
    const rand = rng(7);
    const decor = [];
    const roads = [];
    this.mistSpots = [];
    this.waterSpots = [];
    for (const e of A.world.edges) {
      const a = known.find((n) => n.id === e.a);
      const b = known.find((n) => n.id === e.b);
      if (a && b) roads.push({ pts: roadPoints(a, b), ok: e.ok });
    }
    const nearRoad = (x, z) => roads.some((rd) => rd.pts.some((p) => Math.hypot(p.x - x, p.z - z) < 0.9));
    const ash = mood !== 'clear';
    const lush = new THREE.Color(ash ? 0x8c9a70 : 0x86c060);
    const dry = new THREE.Color(ash ? 0xb0a080 : 0xd8c070);
    const grey = new THREE.Color(ash ? 0x8a8478 : 0x9ab070);
    for (const [x, z] of this.tiles()) {
      const d = Math.min(99, ...knownPos.map(({ p }) => Math.hypot(p.x - x, p.z - z)));
      const level = d < 3.4 ? 0 : d < 6 ? 1 : 2;
      const light = [1, 0.62, 0.34][level];
      const isWater = water.some((w) => Math.hypot(w.x - x, w.z - z) < 2.6);
      const n1 = fbm(x * 0.18, z * 0.18);
      const n2 = noise(x * 0.5 + 40, z * 0.5);
      const c = lush.clone().lerp(dry, Math.max(0, Math.min(1, (n1 - 0.35) * 2))).lerp(grey, n2 * 0.35).multiplyScalar(light * (0.92 + hash(x, z) * 0.16));
      const edge = Math.max(Math.abs(x) / HALF_W, Math.abs(z) / HALF_D);
      if (isWater) { waterP.push({ x, z, c: new THREE.Color(ash ? 0x9a9a8a : 0xffffff).multiplyScalar(light) }); if (level < 2) this.waterSpots.push(new THREE.Vector3(x, this.tileTop + 0.05, z)); continue; }
      // the very edge rises into hills so the board doesn't just stop
      const raise = edge > 0.93 ? 0.12 : 0;
      grassP.push({ x, z, y: raise, c });
      if (level === 2 && rand() < 0.22) this.mistSpots.push(new THREE.Vector3(x, this.tileTop + 0.4, z));
      const dPlace = d;
      if (dPlace < 2.4 || nearRoad(x, z)) continue;
      const forest = fbm(x * 0.22 + 11, z * 0.22 - 5);
      let pick = null;
      if (edge > 0.86 && rand() < 0.7) pick = ['mountain_A_grass_trees', 'mountain_B_grass', 'mountain_C_grass_trees', 'mountain_A', 'hills_C_trees'][Math.floor(rand() * 5)];
      else if (forest > 0.62 && rand() < 0.75) pick = ['trees_A_large', 'trees_B_large', 'trees_A_medium', 'trees_B_medium'][Math.floor(rand() * 4)];
      else if (forest > 0.5 && rand() < 0.35) pick = ['trees_A_small', 'trees_B_small', 'tree_single_A', 'tree_single_B'][Math.floor(rand() * 4)];
      else if (n2 > 0.7 && rand() < 0.45) pick = ['hills_A_trees', 'hills_B_trees', 'hill_single_A', 'hill_single_B', 'hill_single_C'][Math.floor(rand() * 5)];
      else if (rand() < 0.07) pick = ['rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D', 'rock_single_E'][Math.floor(rand() * 5)];
      if (pick) decor.push({ pick, x, z, y: raise, rot: Math.floor(rand() * 6) * (Math.PI / 3), s: 0.85 + rand() * 0.25, dim: light < 0.9 });
    }
    add(this.instanced(this.grass, grassP));
    if (waterP.length) add(this.instanced(this.water, waterP));
    for (const d of decor) {
      const o = await kitPiece(d.pick);
      o.position.set(d.x, this.tileTop + d.y, d.z);
      o.rotation.y = d.rot;
      o.scale.setScalar(d.s);
      if (d.dim) setDim(o, true);
      add(o);
    }
    // Mist curls over the land you haven't explored.
    this.mist = [];
    for (const p of this.mistSpots) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: ash ? 0x6a5e54 : 0xb8c4d0, transparent: true, opacity: 0.5, depthWrite: false }));
      sp.position.copy(p);
      sp.scale.setScalar(3 + rand() * 2);
      sp.userData = { base: p.clone(), ph: rand() * 10 };
      this.mist.push(add(sp));
    }
    this.sparkles = [];
    this.smoke = [];

    // Roads as stepping stones.
    const stone = new THREE.CylinderGeometry(0.1, 0.12, 0.06, 7);
    const pts = roads.flatMap((rd) => rd.pts.slice(1, -1).map((p) => ({ p, ok: rd.ok })));
    if (pts.length) {
      const inst = new THREE.InstancedMesh(stone, new THREE.MeshStandardMaterial({ roughness: 0.9 }), pts.length);
      const m4 = new THREE.Matrix4();
      pts.forEach(({ p, ok }, i) => {
        m4.makeTranslation(p.x, this.tileTop + 0.03, p.z);
        inst.setMatrixAt(i, m4);
        inst.setColorAt(i, new THREE.Color(ok ? 0xc9a676 : 0xb0473b));
      });
      inst.receiveShadow = true;
      add(inst);
    }

    // Dioramas for places you know about; unvisited ones stay in shadow.
    this.dioramas.clear();
    for (const { n, p } of knownPos) {
      const g = new THREE.Group();
      g.position.set(p.x, this.tileTop, p.z);
      g.userData.loc = n.id;
      for (const [piece, dx, dz, rot, s] of dioramaFor(n.id, n.region)) {
        const o = await kitPiece(piece);
        o.position.set(dx, 0, dz);
        o.rotation.y = (rot || 0) * Math.PI * 2;
        o.scale.setScalar(s || 1);
        g.add(o);
      }
      if (!n.visited) setDim(g, true);
      add(g);
      this.dioramas.set(n.id, g);
      // chimney smoke and campfire smoke
      const smokeAt = { thornwick: [[-1.5, 1.5, 0.4], [1.4, 1.4, 0.5], [-1.2, 1.4, -1.6]], watchtower: [[0, 0.3, 0.4]], hollow: [[0.2, 1.4, 0]] }[n.id];
      if (smokeAt && n.visited) for (const [dx, dy, dz] of smokeAt) this.smoke.push({ at: new THREE.Vector3(p.x + dx, this.tileTop + dy, p.z + dz), t: rand() });
    }

    // Drifting clouds, high above the board; they fade away when the camera gets close.
    this.clouds = [];
    for (let i = 0; i < 6; i++) {
      const c = await kitPiece(i % 2 ? 'cloud_big' : 'cloud_small');
      c.position.set((rand() - 0.5) * HALF_W * 2, 9 + rand() * 2.5, (rand() - 0.5) * HALF_D * 2);
      c.scale.setScalar(0.8 + rand() * 0.5);
      const mats = [];
      c.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.55; o.material.depthWrite = false; mats.push(o.material); } });
      c.userData.mats = mats;
      this.clouds.push(add(c));
    }
    // A few birds wheeling over the board.
    this.birds = [];
    const birdMat = new THREE.MeshBasicMaterial({ color: ash ? 0x1a1410 : 0x2a2a30, side: THREE.DoubleSide });
    for (let f = 0; f < 2; f++) {
      const center = new THREE.Vector3((rand() - 0.5) * HALF_W, 4.5 + f, (rand() - 0.5) * HALF_D);
      for (let i = 0; i < 4; i++) {
        const g = new THREE.Group();
        for (const side of [-1, 1]) {
          const wing = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0.08), new THREE.Vector3(side * 0.32, 0, -0.05), new THREE.Vector3(0, 0, -0.1)]), birdMat);
          wing.userData.side = side;
          g.add(wing);
        }
        g.userData = { center, r: 3 + f * 1.5 + i * 0.35, sp: (0.35 + rand() * 0.1) * (f ? -1 : 1), ph: i * 0.35 + rand() * 0.2, h: rand() * 0.5 };
        this.birds.push(add(g));
      }
    }
  }

  async setLeader(cls) {
    if (this.leaderCls === cls) return;
    this.leaderCls = cls;
    if (this.leader) this.scene.remove(this.leader.group);
    if (!cls) { this.leader = null; return; }
    const a = await Actor.create(cls, { scale: 0.85 });
    if (this.leaderCls !== cls) return;
    this.leader = a;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 32), new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    a.group.add(ring);
    this.ring = ring;
    this.scene.add(a.group);
    this.placeLeader(this.here, true);
  }

  standSpot(id) {
    const n = this.nodes && this.nodes.find((x) => x.id === id);
    if (!n) return new THREE.Vector3();
    return toWorld(n.x, n.y).add(new THREE.Vector3(0, this.tileTop, 1.25));
  }

  placeLeader(id, instant) {
    if (!this.leader || !id) return;
    const to = this.standSpot(id);
    if (instant || !this.prevHere || this.prevHere === id) {
      this.leader.group.position.copy(to);
      this.leader.group.rotation.y = 0;
      return;
    }
    const a = this.nodes.find((x) => x.id === this.prevHere);
    const b = this.nodes.find((x) => x.id === id);
    const path = a && b ? roadPoints(a, b, 0.3).map((p) => p.add(new THREE.Vector3(0, this.tileTop, 0))) : [to];
    path[0] = this.leader.group.position.clone();
    path.push(to);
    this.walk = { path, t: 0, dur: Math.min(3, 0.6 + path.length * 0.06) };
    this.leader.play('walk');
  }

  async update(A, ctx) {
    this.ctx = ctx;
    await this.ready;
    this.nodes = A.world.nodes;
    const key = JSON.stringify([A.world.nodes.map((n) => [n.id, n.visited]), A.world.edges, A.ambience]);
    if (key !== this.key) {
      this.key = key;
      const token = (this.buildToken = {});
      await this.rebuild(A);
      if (token !== this.buildToken) return;
    }
    const lead = A.party.find((p) => p.id === ctx.meId) || A.party[0];
    await this.setLeader(lead ? lead.cls : null);
    const here = A.location.id;
    if (here !== this.here) {
      this.prevHere = this.here;
      this.here = here;
      this.placeLeader(here, !this.prevHere);
      const target = toWorld(...(() => { const n = A.world.nodes.find((x) => x.id === here); return n ? [n.x, n.y] : [50, 35]; })());
      this.camGoal = target;
      if (!this.prevHere) {
        this.controls.target.copy(target);
        this.camera.position.copy(target).add(new THREE.Vector3(0, 13, 11));
      }
    }
    this.renderPins(A, ctx);
    this.view.start();
  }

  renderPins(A, ctx) {
    const exits = new Map(A.exits.map((x) => [x.to, x]));
    const seen = new Set();
    for (const n of A.world.nodes) {
      seen.add(n.id);
      let pin = this.pins.get(n.id);
      if (!pin) {
        pin = document.createElement('button');
        pin.type = 'button';
        pin.className = 'pin3d';
        pin.onclick = () => this.ctx && this.ctx.pick(n.id);
        this.labels.append(pin);
        this.pins.set(n.id, pin);
      }
      const exit = exits.get(n.id);
      pin.className = `pin3d${n.here ? ' here' : ''}${exit && exit.ok && !A.combat ? ' go' : ''}${exit && !exit.ok ? ' locked' : ''}${n.visited ? '' : ' unknown'}`;
      pin.textContent = n.visited ? n.name : `${n.name}?`;
      if (n.here) { const s = document.createElement('small'); s.textContent = 'You are here'; pin.append(s); }
      pin.title = exit && exit.ok ? `Travel to ${n.name}` : exit ? exit.locked : n.name;
      pin.dataset.x = n.x;
      pin.dataset.y = n.y;
    }
    for (const [id, pin] of this.pins) if (!seen.has(id)) { pin.remove(); this.pins.delete(id); }
  }

  puff(at, color, life, size, glint) {
    this.puffs = this.puffs || [];
    if (this.puffs.length > 80) return;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color, transparent: true, opacity: 0, depthWrite: false, blending: glint ? THREE.AdditiveBlending : THREE.NormalBlending }));
    sp.position.copy(at);
    sp.scale.setScalar(size);
    this.scene.add(sp);
    this.puffs.push({ sp, age: 0, life, size, glint });
  }

  tick(dt) {
    this.controls.update();
    if (this.camGoal) {
      const t = this.controls.target;
      const delta = this.camGoal.clone().sub(t);
      if (delta.length() < 0.02) this.camGoal = null;
      else { const step = delta.multiplyScalar(Math.min(1, dt * 2.5)); t.add(step); this.camera.position.add(step); }
    }
    if (this.leader) {
      this.leader.update(dt);
      if (this.ring) this.ring.material.opacity = 0.55 + Math.sin(performance.now() / 300) * 0.3;
      if (this.walk) {
        const w = this.walk;
        w.t = Math.min(1, w.t + dt / w.dur);
        const f = w.t * (w.path.length - 1);
        const i = Math.min(w.path.length - 2, Math.floor(f));
        const p = w.path[i].clone().lerp(w.path[i + 1], f - i);
        const dir = w.path[i + 1].clone().sub(w.path[i]);
        if (dir.lengthSq() > 1e-6) this.leader.group.rotation.y = Math.atan2(dir.x, dir.z);
        this.leader.group.position.copy(p);
        if (w.t >= 1) { this.walk = null; this.leader.play('idle'); this.leader.group.rotation.y = 0; }
      }
    }
    this.t = (this.t || 0) + dt;
    const t = this.t;
    const cam = this.camera.position;
    for (const c of this.clouds || []) {
      c.position.x += dt * 0.25;
      if (c.position.x > HALF_W + 4) c.position.x = -HALF_W - 4;
      const near = Math.max(0, Math.min(1, (c.position.distanceTo(cam) - 5) / 8));
      for (const m of c.userData.mats) m.opacity = 0.55 * near;
      c.visible = near > 0.02;
    }
    for (const m of this.mist || []) {
      const u = m.userData;
      m.position.set(u.base.x + Math.sin(t * 0.15 + u.ph) * 0.8, u.base.y + Math.sin(t * 0.4 + u.ph) * 0.12, u.base.z + Math.cos(t * 0.12 + u.ph) * 0.6);
      m.material.opacity = 0.35 + Math.sin(t * 0.3 + u.ph) * 0.15;
    }
    for (const b of this.birds || []) {
      const u = b.userData;
      const a = t * u.sp + u.ph;
      b.position.set(u.center.x + Math.cos(a) * u.r, u.center.y + u.h + Math.sin(t * 0.7 + u.ph) * 0.3, u.center.z + Math.sin(a) * u.r * 0.7);
      b.rotation.y = -a + (u.sp > 0 ? Math.PI : 0);
      const flap = Math.sin(t * 9 + u.ph * 5) * 0.6;
      for (const w of b.children) w.rotation.z = w.userData.side * flap;
    }
    for (const c of this.candles || []) {
      const f = 0.85 + Math.sin(t * 11 + c.seed) * 0.07 + Math.sin(t * 6.3 + c.seed * 2) * 0.08 + Math.random() * 0.05;
      c.light.intensity = 18 * f;
      for (const fl of c.flames) fl.scale.set(0.2 + f * 0.04, 0.36 + f * 0.1, 1);
    }
    // puffs of smoke and glints on the water
    for (const sm of this.smoke || []) {
      sm.t -= dt;
      if (sm.t <= 0) { sm.t = 0.5 + Math.random() * 0.4; this.puff(sm.at, 0x9a948c, 1.8 + Math.random(), 0.45); }
    }
    if (this.waterSpots && this.waterSpots.length && Math.random() < dt * 4) {
      const w = this.waterSpots[Math.floor(Math.random() * this.waterSpots.length)];
      this.puff(w.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2)), 0xfff6d0, 0.6, 0.12, true);
    }
    for (let i = (this.puffs || []).length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      const k = p.age / p.life;
      if (p.glint) { p.sp.material.opacity = Math.sin(Math.min(1, k) * Math.PI) * 0.9; }
      else {
        p.sp.position.y += dt * 0.5;
        p.sp.position.x += dt * 0.15;
        p.sp.scale.setScalar(p.size * (0.4 + k));
        p.sp.material.opacity = 0.4 * (1 - k);
      }
      if (k >= 1) { this.scene.remove(p.sp); p.sp.material.dispose(); this.puffs.splice(i, 1); }
    }
    // keep HTML labels over their places
    const rect = this.view.canvas.getBoundingClientRect();
    const v = new THREE.Vector3();
    for (const pin of this.pins.values()) {
      v.copy(toWorld(Number(pin.dataset.x), Number(pin.dataset.y))).setY(2.3);
      v.project(this.camera);
      const hidden = v.z > 1;
      pin.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * rect.width}px, ${((1 - v.y) / 2) * rect.height}px)`;
      pin.style.visibility = hidden ? 'hidden' : 'visible';
    }
  }
}
