// Builds the game's 3D models from free CC0 asset packs into small web-ready files in public/models/.
//
// Sources (all CC0, public domain):
//   KayKit by Kay Lousberg (kaylousberg.com), on GitHub:
//     git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
//     git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0
//     git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0
//     git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Halloween-Bits-1.0
//   Quaternius (quaternius.com), via:
//     git clone --depth 1 https://github.com/trebeljahr/quaternius-showcase   (Ultimate Animals, Easy Enemies)
//     git clone --depth 1 https://github.com/511action/descent-3d-assets      (Ultimate Monsters: Orc)
//
// Put all the clones in one folder, then:   node scripts/build-models.mjs <that folder>
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, resample, quantize, weld, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) { console.error('Usage: node scripts/build-models.mjs <folder with the asset pack clones>'); process.exit(1); }
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'public', 'models');
fs.mkdirSync(out, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// Find a model file anywhere under the source folder (gltf/glb only, not the FBX copies).
const index = new Map();
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/fbx|\.git|node_modules/i.test(e.name)) walk(p); } else if (/\.(gltf|glb)$/i.test(e.name)) {
      const key = e.name.replace(/\.(gltf|glb)$/i, '');
      if (!index.has(key)) index.set(key, p);
    }
  }
})(src);
const find = (name) => { const p = index.get(name); if (!p) throw new Error(`Model not found: ${name}`); return p; };

const KAYKIT_ANIMS = ['Idle', 'Idle_Combat', '1H_Melee_Attack_Chop', '1H_Melee_Attack_Stab', '1H_Melee_Attack_Slice_Diagonal', '2H_Melee_Attack_Chop',
  'Spellcast_Shoot', 'Spellcast_Raise', 'Hit_A', 'Death_A', 'Death_A_Pose', 'Cheer', 'Walking_A', 'Block', 'Use_Item', 'Skeletons_Awaken_Standing'];

const CHARACTERS = {
  knight: { file: 'Knight', keep: KAYKIT_ANIMS },
  barbarian: { file: 'Barbarian', keep: KAYKIT_ANIMS },
  rogue: { file: 'Rogue', keep: KAYKIT_ANIMS },
  'rogue-hooded': { file: 'Rogue_Hooded', keep: KAYKIT_ANIMS },
  mage: { file: 'Mage', keep: KAYKIT_ANIMS },
  'skeleton-warrior': { file: 'Skeleton_Warrior', keep: KAYKIT_ANIMS },
  wolf: { file: 'Wolf' },
  spider: { file: 'Spider' },
  orc: { file: 'Orc' },
};

// Props for the world board and battle stages, merged into one file (they share one texture).
const KIT = ['hex_grass', 'hex_water', 'building_home_A_yellow', 'building_home_B_red', 'building_home_B_green', 'building_tavern_yellow',
  'building_well_yellow', 'building_windmill_yellow', 'building_church_yellow', 'building_church_blue', 'building_tower_A_blue',
  'building_tower_B_red', 'building_destroyed', 'tent', 'flag_red', 'wall_straight', 'trees_A_large', 'trees_B_large', 'trees_B_medium',
  'tree_single_A', 'tree_single_B', 'mountain_A_grass_trees', 'mountain_B_grass', 'hills_A_trees', 'hill_single_A', 'rock_single_A',
  'rock_single_C', 'cloud_big', 'cloud_small', 'crypt', 'grave_A', 'gravestone', 'candle_triple', 'tree_dead_large', 'tree_dead_medium',
  'lantern_standing', 'post_lantern', 'shrine_candles', 'fence_broken', 'skull', 'waterplant_A', 'waterplant_B', 'waterlily_A', 'pillar',
  'arch_gate', 'Skeleton_Blade', 'Skeleton_Shield_Small_A', 'barrel', 'crate_A_big'];

// Drops animation tracks that only hold a bone still at its resting pose (most bones, most of the time).
function dropStillTracks(doc) {
  const rest = (node, path) => (path === 'translation' ? node.getTranslation() : path === 'rotation' ? node.getRotation() : path === 'scale' ? node.getScale() : null);
  let dropped = 0;
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode();
      const r = node && rest(node, ch.getTargetPath());
      const out = ch.getSampler() && ch.getSampler().getOutput();
      if (!r || !out) continue;
      const el = [];
      let still = true;
      for (let i = 0; i < out.getCount() && still; i++) {
        out.getElement(i, el);
        for (let k = 0; k < r.length; k++) if (Math.abs(el[k] - r[k]) > 1e-4) { still = false; break; }
      }
      if (still) { const smp = ch.getSampler(); ch.dispose(); if (!smp.listParents().some((p) => p.propertyType === 'AnimationChannel')) smp.dispose(); dropped++; }
    }
  }
  return dropped;
}

async function optimize(doc, { anims } = {}) {
  if (anims) for (const a of doc.getRoot().listAnimations()) if (!anims.includes(a.getName())) a.dispose();
  await doc.transform(resample());
  dropStillTracks(doc);
  await doc.transform(dedup(), prune(), weld(), quantize(), dedup(), prune({ keepLeaves: false }), unpartition());
}

// Write, read back and prune again: animation samplers that lost their channels only
// show up as unused data after a round trip.
async function writeClean(file, doc) {
  await io.write(file, doc);
  const again = await io.read(file);
  await again.transform(prune({ keepLeaves: false }));
  await io.write(file, again);
}

const sizes = [];
for (const [key, c] of Object.entries(CHARACTERS)) {
  const doc = await io.read(find(c.file));
  // Quaternius animation names look like "AnimalArmature|Attack": keep just "Attack".
  for (const a of doc.getRoot().listAnimations()) a.setName(a.getName().replace(/^.*\|/, ''));
  await optimize(doc, { anims: c.keep });
  const file = path.join(out, `${key}.glb`);
  await writeClean(file, doc);
  sizes.push([`${key}.glb`, fs.statSync(file).size]);
}

const kit = new (await import('@gltf-transform/core')).Document();
kit.createBuffer();
const kitScene = kit.createScene('kit');
for (const name of KIT) {
  const doc = await io.read(find(name));
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const group = doc.createNode(name);
  for (const child of scene.listChildren()) group.addChild(child);
  scene.addChild(group);
  const map = mergeDocuments(kit, doc);
  const merged = map.get(group);
  for (const s of kit.getRoot().listScenes()) if (s !== kitScene) { s.listChildren().forEach((n) => s.removeChild(n)); s.dispose(); }
  kitScene.addChild(merged);
}
kit.getRoot().setDefaultScene(kitScene);
// mergeDocuments leaves one buffer per source; glb wants one.
const [firstBuffer, ...rest] = kit.getRoot().listBuffers();
for (const b of rest) { for (const a of kit.getRoot().listAccessors()) if (a.getBuffer() === b) a.setBuffer(firstBuffer); b.dispose(); }
await optimize(kit);
await writeClean(path.join(out, 'world-kit.glb'), kit);
sizes.push(['world-kit.glb', fs.statSync(path.join(out, 'world-kit.glb')).size]);

for (const [f, s] of sizes) console.log(`${f.padEnd(24)} ${(s / 1024).toFixed(0)} KB`);
console.log(`total ${(sizes.reduce((a, [, s]) => a + s, 0) / 1024 / 1024).toFixed(2)} MB`);
