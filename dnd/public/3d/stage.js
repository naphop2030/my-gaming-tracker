// The 3D battle stage: heroes on the left, monsters on the right, on a little hex arena
// dressed like the place you're fighting in. Animations follow the game's combat events.
import { THREE, View, kitPiece, Actor, lights, Bursts, weatherPoints, dioramaFor, isWatery } from './core.js';

const HERO_X = -2.6;
const FOE_X = 2.6;

export class Stage {
  constructor(container) {
    this.view = new View(container);
    this.scene = this.view.scene;
    this.camera = this.view.camera;
    this.camera.fov = 30;
    this.camera.position.set(-0.2, 3.3, 9.4);
    this.camera.lookAt(0.2, 0.85, -0.4);
    this.bursts = new Bursts(this.scene);
    this.heroes = new Map();
    this.foes = new Map();
    this.combatKey = '';
    this.ready = Promise.resolve();
    this.view.tickers.add((dt) => this.tick(dt));
    this.t = 0;

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

  async setArena(locId, region, mood) {
    const key = `${locId}:${mood}`;
    if (this.arenaKey === key) return;
    this.arenaKey = key;
    if (this.arena) this.scene.remove(this.arena);
    const arena = new THREE.Group();
    this.arena = arena;
    const tmp = new THREE.Scene();
    lights(tmp, mood);
    for (const l of [...tmp.children]) { if (l.isDirectionalLight) { l.position.set(-6, 12, 8); l.shadow.camera.left = -10; l.shadow.camera.right = 10; l.shadow.camera.top = 10; l.shadow.camera.bottom = -10; } arena.add(l); }
    const indoors = locId === 'crypt' || /underground/i.test(region || '');
    const sky = indoors ? 0x15130f : mood === 'clear' ? 0x9fbfdc : 0x4a3a30;
    this.scene.background = new THREE.Color(sky);
    this.scene.fog = new THREE.Fog(sky, 10, 26);

    const tile = await kitPiece(isWatery(locId, region) ? 'hex_water' : 'hex_grass');
    const box = new THREE.Box3().setFromObject(tile);
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z) / 2;
    const flat = size.x >= size.z;
    for (let q = -4; q <= 4; q++) {
      for (let s = -3; s <= 3; s++) {
        const x = flat ? q * r * 1.5 : (q + (s % 2 ? 0.5 : 0)) * Math.sqrt(3) * r;
        const z = flat ? (s + (q % 2 ? 0.5 : 0)) * Math.sqrt(3) * r : s * r * 1.5;
        const t = tile.clone();
        t.position.set(x, -box.max.y, z);
        if (indoors) setTint(t, 0x6a6460);
        arena.add(t);
      }
    }
    // Scenery from the location around the back of the arena.
    const recipe = dioramaFor(locId, region);
    const spots = [[-5.2, -4.6], [0.4, -5.6], [5.4, -4.4], [-7.4, -1.6], [7.4, -1.8], [-2.6, -5.8], [3.2, -6]];
    for (let i = 0; i < Math.min(spots.length, recipe.length + 2); i++) {
      const [piece, , , rot, sc] = recipe[i % recipe.length];
      const o = await kitPiece(piece);
      o.position.set(spots[i][0], 0, spots[i][1]);
      o.rotation.y = (rot || 0) * Math.PI * 2 + i;
      o.scale.setScalar((sc || 1) * 1.15);
      arena.add(o);
    }
    if (!indoors) { const before = this.scene.children.length; const tick = weatherPoints(arena, mood, 22, 8); if (this.weatherTick) this.view.tickers.delete(this.weatherTick); this.weatherTick = tick; this.view.tickers.add(tick); void before; }
    if (indoors) {
      const glow = new THREE.PointLight(0xffb060, 25, 14);
      glow.position.set(0, 3, 1);
      arena.add(glow);
    }
    this.scene.add(arena);
  }

  ring(color) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.03;
    return m;
  }

  async sync(A, init, targetId, onTarget) {
    this.onTarget = onTarget;
    const mood = A.ambience === 'clear' ? 'clear' : 'ash';
    await this.setArena(A.location.id, A.location.region, mood);
    // A new fight: rebuild the cast.
    const key = A.combat.monsters.map((m) => m.id).join(',');
    if (key !== this.combatKey) {
      this.combatKey = key;
      for (const a of [...this.heroes.values(), ...this.foes.values()]) this.scene.remove(a.group);
      this.heroes.clear();
      this.foes.clear();
      const heroes = A.party;
      await Promise.all(heroes.map(async (h, i) => {
        const a = await Actor.create(h.cls);
        a.group.position.set(HERO_X - (i % 2) * 0.8, 0, (i - (heroes.length - 1) / 2) * 1.3 - 0.6);
        a.group.rotation.y = Math.PI / 2;
        a.ringMesh = this.ring(0xffd36a);
        a.group.add(a.ringMesh);
        this.heroes.set(h.id, a);
        this.scene.add(a.group);
      }));
      const foes = A.combat.monsters;
      await Promise.all(foes.map(async (m, i) => {
        const a = await Actor.create(m.key);
        a.group.position.set(FOE_X + (i % 2) * 0.8 + (m.boss ? 0.6 : 0), 0, (i - (foes.length - 1) / 2) * 1.45 - 0.6);
        a.group.rotation.y = -Math.PI / 2;
        a.group.userData.foe = m.id;
        a.ringMesh = this.ring(0xe0614f);
        a.group.add(a.ringMesh);
        this.foes.set(m.id, a);
        this.scene.add(a.group);
      }));
    }
    // Keep poses in line with the state (people joining mid-fight, reloads).
    for (const m of A.combat.monsters) {
      const a = this.foes.get(m.id);
      if (!a) continue;
      if (m.hp <= 0 && !a.dead) a.play('dead');
      a.ringMesh.material.opacity = m.id === targetId && m.hp > 0 ? 0.9 : 0;
    }
    const cur = init.list.find((e) => e.id === init.current);
    for (const h of A.party) {
      const a = this.heroes.get(h.id);
      if (!a) continue;
      if (h.hp <= 0 && !a.dead) a.play('dead');
      if (h.hp > 0 && a.dead) a.revive();
      a.ringMesh.material.opacity = cur && cur.owner === h.id ? 0.9 : 0;
    }
    this.view.start();
  }

  // Combat events from the game, in order.
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
          if (m) m.play('attack');
          if (target) target.play('block');
          return;
        }
        if (attacker) attacker.play(fx.style === 'fire' || fx.style === 'arcane' || fx.style === 'holy' ? 'cast' : 'attack');
        if (!target) return;
        const land = () => {
          if (fx.t === 'dmg') { target.play('hit'); target.hitFlash(); this.bursts.burst(chest(target), { color: fx.crit ? 0xffd34d : 0xff5a3a, count: fx.crit ? 40 : 22 }); }
        };
        if ((fx.style === 'fire' || fx.style === 'arcane') && attacker) {
          const n = fx.style === 'arcane' ? 3 : 1;
          for (let i = 0; i < n; i++) setTimeout(() => this.bursts.projectile(chest(attacker), chest(target), { color: fx.style === 'fire' ? 0xff7a2a : 0xb68cff, time: 0.4, size: fx.style === 'fire' ? 0.7 : 0.35, onHit: i === n - 1 ? land : null }), 250 + i * 110);
        } else if (fx.style === 'holy') {
          this.beam(target);
          setTimeout(land, 300);
        } else {
          setTimeout(land, 280);
        }
        return;
      }
      case 'kill': { const a = foe(fx.id); if (a) setTimeout(() => { a.play('death'); this.bursts.burst(a.group.position.clone().setY(0.5), { color: 0x2a2420, count: 30, speed: 1.5, gravity: 1 }); }, 300); return; }
      case 'hurt': {
        const m = fx.from && foe(fx.from);
        const h = hero(fx.id);
        if (m) m.play('attack');
        if (h) setTimeout(() => { h.play('hit'); h.hitFlash(); this.bursts.burst(chest(h), { color: 0xff3a2a, count: 20 }); }, m ? 300 : 0);
        return;
      }
      case 'down': { const h = hero(fx.id); if (h) setTimeout(() => h.play('death'), 350); return; }
      case 'heal': {
        const h = hero(fx.id);
        if (!h) return;
        if (h.dead) h.revive();
        this.bursts.burst(h.group.position.clone().setY(0.3), { color: 0x7ee08a, count: 36, speed: 1.2, up: 3, gravity: 1.5, life: 1.3 });
        h.play('raise');
        return;
      }
      case 'defend': { const h = hero(fx.id); if (h) h.play('block'); return; }
      case 'victory': for (const h of this.heroes.values()) if (!h.dead) h.play('cheer'); return;
      case 'level': { const h = hero(fx.id); if (h) this.bursts.burst(h.group.position.clone().setY(0.2), { color: 0xffd36a, count: 60, speed: 2, up: 4, gravity: 0.5, life: 1.6 }); return; }
      default: return;
    }
  }

  beam(target) {
    const geo = new THREE.CylinderGeometry(0.45, 0.45, 8, 20, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(target.group.position).setY(4);
    this.scene.add(m);
    let t = 0;
    const tick = (dt) => {
      t += dt;
      mat.opacity = Math.max(0, 0.8 - t * 1.4);
      if (t > 0.6) { this.scene.remove(m); geo.dispose(); mat.dispose(); this.view.tickers.delete(tick); }
    };
    this.view.tickers.add(tick);
  }

  tick(dt) {
    this.t += dt;
    for (const a of [...this.heroes.values(), ...this.foes.values()]) a.update(dt);
    this.bursts.update(dt);
    // slow cinematic sway
    this.camera.position.x = -0.2 + Math.sin(this.t * 0.25) * 0.35;
    this.camera.lookAt(0.2, 0.85, -0.4);
  }
}

function setTint(obj, color) {
  obj.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiply(new THREE.Color(color)); } });
}
