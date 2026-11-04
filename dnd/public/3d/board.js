// The 3D world map: a hex-tile game board with a little diorama for every place you know about,
// stepping-stone roads, fog over unexplored land, and the party's miniature walking between places.
import { THREE, View, kitPiece, Actor, lights, weatherPoints, dioramaFor, isWatery } from './core.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const S = 0.34; // world units per map unit (the adventure map is 100 x 70)
const toWorld = (x, y) => new THREE.Vector3((x - 50) * S, 0, (y - 35) * S);
const HALF_W = 50 * S + 1.5;
const HALF_D = 35 * S + 1.5;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

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

    // table under the board
    const table = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 + 4, 0.6, HALF_D * 2 + 4), new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.9 }));
    table.position.y = -0.55;
    table.receiveShadow = true;
    scene.add(table);

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

  // Builds instanced copies of a kit piece; `shade` (0..1) darkens tiles for fog of war,
  // and `tint` recolors them (ash-covered grass).
  instanced(piece, placements, tint) {
    const group = new THREE.Group();
    piece.updateMatrixWorld(true);
    const m4 = new THREE.Matrix4();
    const levels = [1, 0.62, 0.34];
    piece.traverse((mesh) => {
      if (!mesh.isMesh) return;
      levels.forEach((shade, li) => {
        const list = placements.filter((p) => p.level === li);
        if (!list.length) return;
        const mat = mesh.material.clone();
        if (tint) mat.color.multiply(new THREE.Color(tint));
        mat.color.multiplyScalar(shade);
        const inst = new THREE.InstancedMesh(mesh.geometry, mat, list.length);
        inst.receiveShadow = true;
        list.forEach((p, i) => { m4.makeTranslation(p.x, 0, p.z).multiply(mesh.matrixWorld); inst.setMatrixAt(i, m4); });
        inst.instanceMatrix.needsUpdate = true;
        group.add(inst);
      });
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

    // Tiles: lit near places you know, dark (fog of war) elsewhere.
    const grassP = [];
    const waterP = [];
    const rand = rng(7);
    const decor = [];
    const roads = [];
    for (const e of A.world.edges) {
      const a = known.find((n) => n.id === e.a);
      const b = known.find((n) => n.id === e.b);
      if (a && b) roads.push({ pts: roadPoints(a, b), ok: e.ok });
    }
    const nearRoad = (x, z) => roads.some((rd) => rd.pts.some((p) => Math.hypot(p.x - x, p.z - z) < 0.9));
    for (const [x, z] of this.tiles()) {
      const d = Math.min(99, ...knownPos.map(({ p }) => Math.hypot(p.x - x, p.z - z)));
      const level = d < 3.4 ? 0 : d < 6 ? 1 : 2;
      const light = [1, 0.62, 0.34][level];
      const isWater = water.some((w) => Math.hypot(w.x - x, w.z - z) < 2.6);
      (isWater ? waterP : grassP).push({ x, z, level });
      // scattered scenery away from places and roads
      const dPlace = Math.min(99, ...knownPos.map(({ p }) => Math.hypot(p.x - x, p.z - z)));
      if (!isWater && dPlace > 2.4 && !nearRoad(x, z) && rand() < 0.16) {
        const edge = Math.abs(x) > HALF_W - 3 || Math.abs(z) > HALF_D - 3;
        const pick = edge && rand() < 0.6 ? (rand() < 0.5 ? 'mountain_A_grass_trees' : 'mountain_B_grass') : ['trees_A_large', 'trees_B_medium', 'hills_A_trees', 'tree_single_B', 'rock_single_A', 'trees_B_large'][Math.floor(rand() * 6)];
        decor.push({ pick, x, z, rot: rand() * Math.PI * 2, s: 0.75 + rand() * 0.3, dim: light < 0.9 });
      }
    }
    add(this.instanced(this.grass, grassP, mood === 'clear' ? null : 0xaaa79c));
    if (waterP.length) add(this.instanced(this.water, waterP, mood === 'clear' ? null : 0x9a9a8a));
    for (const d of decor) {
      const o = await kitPiece(d.pick);
      o.position.set(d.x, this.tileTop, d.z);
      o.rotation.y = d.rot;
      o.scale.setScalar(d.s);
      if (d.dim) setDim(o, true);
      add(o);
    }

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
    }

    // Drifting clouds.
    this.clouds = [];
    for (let i = 0; i < 5; i++) {
      const c = await kitPiece(i % 2 ? 'cloud_big' : 'cloud_small');
      c.position.set((rand() - 0.5) * HALF_W * 2, 6 + rand() * 2, (rand() - 0.5) * HALF_D * 2);
      c.scale.setScalar(1.2 + rand());
      c.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.85; } });
      this.clouds.push(add(c));
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
    for (const c of this.clouds || []) { c.position.x += dt * 0.25; if (c.position.x > HALF_W + 4) c.position.x = -HALF_W - 4; }
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
