'use strict';
// Adventure engine: the game acts as the Dungeon Master.
// Runs exploration (locations, scenes, skill checks, travel events), the party (levels,
// class talents, equipment), and automated combat (status effects, monster special moves).
// Adventure content lives in ./adventures/*.js (see the comments in ashen-vale.js).
const crypto = require('crypto');
const { roll } = require('./dice');

const ADVENTURES = {};
for (const a of [require('./adventures/ashen-vale')]) ADVENTURES[a.id] = a;

const LOG_LIMIT = 150;
// Difficulty, chosen by the host: monster health, monster damage, XP and how much gold a defeat costs.
const DIFFICULTY = {
  story: { name: 'Story', hp: 0.7, dmg: 0.7, xp: 1, goldLoss: 0, desc: 'Gentler fights and no gold lost on defeat. For enjoying the tale.' },
  normal: { name: 'Normal', hp: 1, dmg: 1, xp: 1, goldLoss: 0.5, desc: 'The adventure as designed.' },
  hard: { name: 'Hard', hp: 1.3, dmg: 1.25, xp: 1.2, goldLoss: 0.5, desc: 'Tougher, hungrier monsters, and 20% more XP.' },
};
const diff = (adv) => DIFFICULTY[adv.difficulty] || DIFFICULTY.normal;
const bump = (adv, key, n = 1) => { adv.stats = adv.stats || {}; adv.stats[key] = (adv.stats[key] || 0) + n; };
function meet(adv, key, defeated) {
  adv.bestiary = adv.bestiary || {};
  const b = adv.bestiary[key] || (adv.bestiary[key] = { seen: 0, defeated: 0 });
  if (defeated) b.defeated += 1; else b.seen += 1;
}
let ICON_FILES = new Set();
try {
  ICON_FILES = new Set(require('fs').readdirSync(require('path').join(__dirname, 'public', 'art', 'icons')).map((f) => f.replace(/\.svg$/, '')));
} catch { /* no icons installed */ }
const icon = (name, fallback) => (name && ICON_FILES.has(name) ? name : fallback);
const XP_LEVELS = [0, 300, 900, 2700, 6500];
const MAX_LEVEL = 5;
const EVENT_CHANCE = 0.35;

const SKILLS = {
  athletics: 'str', acrobatics: 'dex', stealth: 'dex', sleight: 'dex',
  arcana: 'int', history: 'int', investigation: 'int', religion: 'int', nature: 'int',
  insight: 'wis', medicine: 'wis', perception: 'wis', survival: 'wis',
  persuasion: 'cha', intimidation: 'cha', deception: 'cha',
};
const SKILL_NAMES = { sleight: 'Sleight of Hand' };
const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

const CLASSES = {
  fighter: {
    name: 'Fighter', hitDie: 10, ac: 16, saves: ['str', 'con'], main: 'str',
    abilities: { str: 16, dex: 12, con: 15, int: 8, wis: 12, cha: 10 },
    skills: ['athletics', 'intimidation', 'perception', 'survival'],
    weapon: { name: 'Longsword', ability: 'str', dmg: '1d8' },
    desc: 'Tough and well armored. Hits hard, catches a second wind, and later strikes twice.',
  },
  rogue: {
    name: 'Rogue', hitDie: 8, ac: 14, saves: ['dex', 'int'], main: 'dex',
    abilities: { str: 10, dex: 16, con: 14, int: 12, wis: 10, cha: 13 },
    skills: ['stealth', 'sleight', 'acrobatics', 'deception', 'investigation', 'persuasion'],
    weapon: { name: 'Shortsword', ability: 'dex', dmg: '1d6' },
    desc: 'Sneaky and skilled. Sneak attack, hiding and poison, and the best at locks, lies and lurking.',
  },
  wizard: {
    name: 'Wizard', hitDie: 6, ac: 12, saves: ['int', 'wis'], main: 'int',
    abilities: { str: 8, dex: 14, con: 13, int: 16, wis: 12, cha: 10 },
    skills: ['arcana', 'history', 'investigation', 'religion'],
    weapon: { name: 'Quarterstaff', ability: 'str', dmg: '1d6' },
    desc: 'Fragile but powerful. Fire Bolt and Magic Missile, later Burning Hands, Sleep and Fireball.',
  },
  cleric: {
    name: 'Cleric', hitDie: 8, ac: 16, saves: ['wis', 'cha'], main: 'wis',
    abilities: { str: 14, dex: 10, con: 14, int: 10, wis: 16, cha: 12 },
    skills: ['religion', 'insight', 'medicine', 'persuasion'],
    weapon: { name: 'Mace', ability: 'str', dmg: '1d6' },
    desc: 'Armored healer. Cures and revives friends, blesses the party, and burns the wicked.',
  },
};

// Talents learned on level up.
const TALENTS = {
  'action-surge': { name: 'Action Surge', desc: 'Once per rest, attack twice in one turn.' },
  'shield-bash': { name: 'Shield Bash', desc: 'Twice per rest, an attack that stuns the target for a turn.' },
  'extra-attack': { name: 'Extra Attack', desc: 'Your Attack strikes twice.' },
  hide: { name: 'Hide', desc: 'Slip out of sight: enemies can\'t target you, and your next attack hits harder.' },
  'poison-blade': { name: 'Poisoned Blade', desc: 'Once per rest, an attack that poisons the target for 3 turns.' },
  'uncanny-dodge': { name: 'Uncanny Dodge', desc: 'Halve the first hit you take each round.' },
  'burning-hands': { name: 'Burning Hands', desc: 'Spell: flames hit every enemy (3d6, half on a save).' },
  sleep: { name: 'Sleep', desc: 'Spell: the weakest enemies fall asleep for 2 turns.' },
  fireball: { name: 'Fireball', desc: 'Spell: a huge blast hits every enemy (6d6, half on a save).' },
  bless: { name: 'Bless', desc: 'Spell: the whole party gets +2 to hit for 3 rounds.' },
  'spirit-weapon': { name: 'Spiritual Weapon', desc: 'Spell: a floating hammer strikes an enemy every turn for 3 rounds.' },
  'mass-cure': { name: 'Mass Cure', desc: 'Spell: heal the whole party and revive the fallen.' },
  asi: { name: 'Training', desc: '+2 to your main ability.' },
};
const LEARN = {
  fighter: { 2: 'action-surge', 3: 'shield-bash', 4: 'asi', 5: 'extra-attack' },
  rogue: { 2: 'hide', 3: 'poison-blade', 4: 'asi', 5: 'uncanny-dodge' },
  wizard: { 2: 'burning-hands', 3: 'sleep', 4: 'asi', 5: 'fireball' },
  cleric: { 2: 'bless', 3: 'spirit-weapon', 4: 'asi', 5: 'mass-cure' },
};
const talentsOf = (c) => Object.entries(LEARN[c.cls]).filter(([lv]) => c.level >= Number(lv)).map(([, t]) => t);
const has = (c, t) => talentsOf(c).includes(t);
const SLOTS = [0, 2, 3, 4, 4, 5];

const rid = () => crypto.randomBytes(5).toString('base64url');
const mod = (score) => Math.floor((score - 10) / 2);
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
const dice = (expr) => roll(expr).total;
const d20 = () => crypto.randomInt(1, 21);
const pick = (list) => list[crypto.randomInt(list.length)];
const chance = (p) => Math.random() < p;
const content = (adv) => ADVENTURES[adv.id];
const str = (v, max) => String(v ?? '').slice(0, max);

class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

function list() {
  return Object.values(ADVENTURES).map((a) => ({ id: a.id, title: a.title, blurb: a.blurb }));
}
const exists = (id) => !!ADVENTURES[id];

function create(id, opts = {}) {
  const A = ADVENTURES[id];
  if (!A) fail('Unknown adventure.');
  const adv = {
    id, location: A.start, prev: null, scene: null, difficulty: DIFFICULTY[opts.difficulty] ? opts.difficulty : 'normal', stats: {}, bestiary: {},
    flags: {}, visited: { [A.start]: true },
    inventory: { ...(A.startItems || {}) }, gold: A.startGold || 0,
    party: {}, journal: [], log: [], combat: null, ended: null,
  };
  log(adv, 'story', A.intro);
  logPlace(adv, A.start);
  return adv;
}

// ---------- helpers ----------
function log(adv, kind, text, extra) {
  adv.log.push({ id: rid(), kind, text, ...extra });
  if (adv.log.length > LOG_LIMIT) adv.log.splice(0, adv.log.length - LOG_LIMIT);
}

function test(adv, cond) {
  if (!cond) return true;
  if (Array.isArray(cond)) return cond.every((c) => test(adv, c));
  const neg = cond.startsWith('!');
  const c = neg ? cond.slice(1) : cond;
  let v;
  if (c.startsWith('item:')) {
    const id = c.slice(5);
    v = (adv.inventory[id] || 0) > 0 || Object.values(adv.party).some((h) => h.gear && Object.values(h.gear).includes(id));
  } else v = !!adv.flags[c];
  return neg ? !v : v;
}

const fill = (text, actor) => String(text).replace(/\{name\}/g, actor ? actor.name : 'The party');
const itemDef = (A, id) => A.items[id] || {};
const itemName = (A, id) => itemDef(A, id).name || id;
const itemIcon = (A, id) => icon(itemDef(A, id).icon || id, itemDef(A, id).slot === 'weapon' ? 'attack' : itemDef(A, id).slot === 'armor' ? 'defend' : 'potion');
const prof = (c) => (c.level >= 5 ? 3 : 2);
const fullUses = (cls, level) => ({
  secondWind: cls === 'fighter' ? 1 : 0,
  surge: cls === 'fighter' && level >= 2 ? 1 : 0,
  bash: cls === 'fighter' && level >= 3 ? 2 : 0,
  poison: cls === 'rogue' && level >= 3 ? 1 : 0,
  slots: cls === 'wizard' || cls === 'cleric' ? SLOTS[Math.min(level, MAX_LEVEL)] : 0,
});

// Old saved heroes get the newer fields.
function ensureHero(c) {
  if (!c.gear) c.gear = { weapon: null, armor: null, trinket: null };
  if (!c.status) c.status = {};
  const full = fullUses(c.cls, c.level);
  for (const k of Object.keys(full)) if (c.uses[k] === undefined) c.uses[k] = full[k];
  return c;
}

// Equipment bonuses for a hero: { atk, dmg, ac, spell, check, vs, extra }.
function gearBonus(adv, c) {
  const A = content(adv);
  const b = { atk: 0, dmg: 0, ac: 0, spell: 0, check: 0, extra: null, vs: null };
  for (const id of Object.values(c.gear || {})) {
    if (!id) continue;
    const it = itemDef(A, id);
    b.atk += it.atk || 0;
    b.dmg += it.dmg || 0;
    b.ac += it.ac || 0;
    b.spell += it.spell || 0;
    b.check += it.check || 0;
    if (it.extra) { b.extra = it.extra; b.vs = it.vs || null; }
  }
  return b;
}

function acOf(adv, c) {
  const A = content(adv);
  let bonus = 0;
  for (const [id, n] of Object.entries(adv.inventory)) if (n > 0 && A.items[id] && A.items[id].acBonus) bonus += A.items[id].acBonus;
  for (const id of Object.values(c.gear || {})) if (id && A.items[id] && A.items[id].acBonus) bonus += A.items[id].acBonus; // party charms worn
  return CLASSES[c.cls].ac + bonus + gearBonus(adv, c).ac;
}

function skillBonus(c, skill) {
  const b = mod(c.abilities[SKILLS[skill]]);
  return CLASSES[c.cls].skills.includes(skill) ? b + prof(c) : b;
}

function checkBonus(adv, c, check) {
  let b;
  if (check.skill) b = skillBonus(c, check.skill);
  else {
    b = mod(c.abilities[check.ability]);
    if (check.save && CLASSES[c.cls].saves.includes(check.ability)) b += prof(c);
  }
  return b + gearBonus(adv, c).check;
}

function checkLabel(check) {
  if (check.skill) return SKILL_NAMES[check.skill] || check.skill[0].toUpperCase() + check.skill.slice(1);
  return `${ABILITY_NAMES[check.ability]}${check.save ? ' save' : ''}`;
}

function idOf(adv, c) { return Object.keys(adv.party).find((id) => adv.party[id] === c) || null; }
function heroes(adv) { return Object.entries(adv.party).map(([id, c]) => ({ id, c: ensureHero(c) })); }
const alive = (adv) => heroes(adv).filter((h) => h.c.hp > 0);
const blessBonus = (adv) => (adv.combat && adv.combat.bless > 0 ? 2 : 0);

// ---------- characters ----------
function makeHero(name, cls) {
  const C = CLASSES[cls];
  const hp = C.hitDie + mod(C.abilities.con);
  return ensureHero({ name, cls, level: 1, xp: 0, abilities: { ...C.abilities }, maxHp: hp, hp, uses: fullUses(cls, 1), defending: false });
}

function levelUp(adv, c, quiet) {
  c.level += 1;
  const C = CLASSES[c.cls];
  const gain = Math.max(1, Math.floor(C.hitDie / 2) + 1 + mod(c.abilities.con));
  c.maxHp += gain;
  c.hp += gain;
  const prev = fullUses(c.cls, c.level - 1);
  const next = fullUses(c.cls, c.level);
  for (const k of Object.keys(next)) c.uses[k] = (c.uses[k] || 0) + (next[k] - prev[k]);
  const learned = LEARN[c.cls][c.level];
  if (learned === 'asi') c.abilities[C.main] = Math.min(20, c.abilities[C.main] + 2);
  if (quiet) { c.hp = c.maxHp; return; }
  const what = learned ? ` Learned: ${TALENTS[learned].name}${learned === 'asi' ? ` (+2 ${C.main.toUpperCase()})` : ''}.` : '';
  log(adv, 'level', `${c.name} reaches level ${c.level}! (+${gain} max HP)${what}`, { fx: { t: 'level', id: idOf(adv, c), name: c.name, level: c.level, learned: learned ? TALENTS[learned].name : null } });
}

function giveXp(adv, amount) {
  if (!amount) return;
  amount = Math.round(amount * diff(adv).xp);
  const list = heroes(adv);
  if (!list.length) return;
  log(adv, 'loot', `Each hero gains ${amount} XP.`, { fx: { t: 'xp', n: amount } });
  for (const { c } of list) {
    c.xp += amount;
    while (c.level < MAX_LEVEL && c.xp >= XP_LEVELS[c.level]) levelUp(adv, c);
  }
}

function giveXpTo(adv, hero, amount) {
  // Level a single late-joining hero up silently to match the party.
  hero.xp += amount;
  while (hero.level < MAX_LEVEL && hero.xp >= XP_LEVELS[hero.level]) levelUp(adv, hero, true);
}

function restAll(adv) {
  for (const { c } of heroes(adv)) {
    c.hp = c.maxHp;
    c.uses = fullUses(c.cls, c.level);
    c.defending = false;
    c.status = {};
  }
}

function setQuest(adv, q) {
  let entry = adv.journal.find((x) => x.id === q.id);
  if (!entry) {
    entry = { id: q.id, title: q.title || q.id, text: '', done: false };
    adv.journal.push(entry);
    log(adv, 'quest', `New quest: ${entry.title}`, { fx: { t: 'quest' } });
  } else if (q.done && !entry.done) {
    log(adv, 'quest', `Quest complete: ${entry.title}`, { fx: { t: 'quest', done: true } });
  } else {
    log(adv, 'quest', `Journal updated: ${entry.title}`);
  }
  if (q.title) entry.title = q.title;
  if (q.text) entry.text = q.text;
  if (q.done) entry.done = true;
}

// ---------- world ----------
function pathsFrom(adv, loc) {
  const A = content(adv);
  return A.paths
    .filter((p) => p.a === loc || p.b === loc)
    .map((p) => ({ to: p.a === loc ? p.b : p.a, ok: test(adv, p.when), locked: p.locked || 'The way is blocked.', hidden: !!p.hidden }))
    .filter((p) => p.ok || !p.hidden);
}

function knownLocations(adv) {
  const known = new Set(Object.keys(adv.visited));
  for (const loc of Object.keys(adv.visited)) for (const p of pathsFrom(adv, loc)) known.add(p.to);
  return known;
}

function locationDesc(adv, id) {
  const L = content(adv).locations[id];
  return [L.desc, ...(L.descIf || []).filter((d) => test(adv, d.when)).map((d) => d.text)].join(' ');
}

function logPlace(adv, id) {
  const L = content(adv).locations[id];
  log(adv, 'place', locationDesc(adv, id), { title: L.name, fx: { t: 'travel' } });
}

// The coach runs between towns with a coach stop that the party has already visited.
const COACH_PRICE = 8;
function coachStops(adv) {
  const A = content(adv);
  return Object.keys(A.locations).filter((id) => id !== adv.location && A.locations[id].coach && adv.visited[id]);
}

// Is there something here the party hasn't done yet? (a "!" on the map)
function hasNews(adv, id) {
  const L = content(adv).locations[id];
  if (!adv.visited[id]) return false;
  return (L.actions || []).some((a) => test(adv, a.when) && !adv.flags[`seen:${a.scene}`]);
}

function moveTo(room, to, encounters) {
  const adv = room.adventure;
  adv.prev = adv.location;
  adv.location = to;
  adv.visited[to] = true;
  bump(adv, 'journeys');
  adv.scene = null;
  logPlace(adv, to);
  if (encounters && !maybeEncounter(room)) maybeEvent(room);
}

function maybeEncounter(room, chanceScale = 1) {
  const adv = room.adventure;
  const L = content(adv).locations[adv.location];
  if (!L.encounters || L.safe) return false;
  const enc = L.encounters.find((e) => test(adv, e.when));
  if (!enc || Math.random() >= enc.chance * chanceScale) return false;
  startCombat(room, pick(enc.groups), { text: 'Ambush!' });
  return true;
}

// Something happens on the road: a random, non-combat scene.
function maybeEvent(room, force) {
  const adv = room.adventure;
  const A = content(adv);
  if (!A.events || (!force && !chance(EVENT_CHANCE))) return false;
  const options = A.events.filter((e) => (!e.where || e.where.includes(adv.location)) && test(adv, e.when) && !(e.once && adv.flags[`seen:${e.scene}`]));
  if (!options.length) return false;
  const ev = pick(options);
  log(adv, 'travel', 'On the way, something catches your eye…');
  enterScene(adv, ev.scene);
  return true;
}

// ---------- scenes & outcomes ----------
function enterScene(adv, id) {
  const S = content(adv).scenes[id];
  if (!S) fail(`Missing scene "${id}".`);
  adv.scene = id;
  adv.flags[`seen:${id}`] = true;
  log(adv, 'story', S.text, { title: S.title });
}

function addItem(adv, id, n = 1) {
  const A = content(adv);
  adv.inventory[id] = (adv.inventory[id] || 0) + n;
  log(adv, 'loot', `Found: ${itemName(A, id)}${n > 1 ? ` ×${n}` : ''}`, { fx: { t: 'item', icon: itemIcon(A, id), name: itemName(A, id), n } });
}

function apply(room, actor, o) {
  const adv = room.adventure;
  if (!o) { adv.scene = null; return; }
  if (o.text) log(adv, 'story', fill(o.text, actor));
  for (const f of [].concat(o.set || [])) adv.flags[f] = true;
  for (const f of [].concat(o.unset || [])) delete adv.flags[f];
  if (o.gold) {
    adv.gold = Math.max(0, adv.gold + o.gold);
    if (o.gold > 0) bump(adv, 'gold', o.gold);
    log(adv, 'loot', o.gold > 0 ? `+${o.gold} gold` : `${o.gold} gold`, o.gold > 0 ? { fx: { t: 'gold', n: o.gold } } : undefined);
  }
  for (const [id, n] of Object.entries(o.give || {})) addItem(adv, id, n);
  for (const [id, n] of Object.entries(o.take || {})) adv.inventory[id] = Math.max(0, (adv.inventory[id] || 0) - n);
  if (o.damage && actor) {
    const dmg = dice(o.damage);
    actor.hp = Math.max(1, actor.hp - dmg); // story damage hurts, but never knocks anyone out
    log(adv, 'hurt', `${actor.name} takes ${dmg} damage.`, { fx: { t: 'hurt', id: idOf(adv, actor), n: dmg } });
  }
  if (o.damageAll) {
    for (const { id, c } of heroes(adv)) {
      const dmg = dice(o.damageAll);
      c.hp = Math.max(1, c.hp - dmg);
      log(adv, 'hurt', `${c.name} takes ${dmg} damage.`, { fx: { t: 'hurt', id, n: dmg } });
    }
  }
  if (o.healAll) restAll(adv);
  if (o.healParty) {
    for (const { id, c } of heroes(adv)) {
      const amount = Math.min(c.maxHp - c.hp, o.healParty === 'half' || o.healParty === true ? Math.ceil(c.maxHp / 2) : dice(o.healParty));
      if (amount > 0) { c.hp += amount; log(adv, 'heal', `${c.name} recovers ${amount} HP.`, { fx: { t: 'heal', id, n: amount } }); }
    }
  }
  if (o.restoreSlots) {
    for (const { c } of heroes(adv)) c.uses = { ...c.uses, ...Object.fromEntries(Object.entries(fullUses(c.cls, c.level)).filter(([k]) => k !== 'secondWind')) };
    log(adv, 'heal', 'Spells and special abilities are restored.');
  }
  if (o.quest) setQuest(adv, o.quest);
  if (o.xp) giveXp(adv, o.xp);
  if (o.end) {
    adv.ended = { title: o.end.title, text: o.end.text, at: Date.now() };
    log(adv, 'ending', o.end.text, { title: o.end.title, fx: { t: 'ending' } });
  }
  if (o.goto) moveTo(room, o.goto, false);
  if (o.combat) {
    adv.scene = null;
    startCombat(room, o.combat, { win: o.win, flee: o.flee });
    return;
  }
  if (o.scene && o.scene !== adv.scene) enterScene(adv, o.scene);
  else if (!o.scene) adv.scene = null;
}

// ---------- combat ----------
function startCombat(room, monsterIds, opts = {}) {
  const adv = room.adventure;
  const A = content(adv);
  // Scale fights to the party: small parties face fewer, weaker monsters.
  const n = Math.max(1, alive(adv).length);
  const scale = (n === 1 ? 0.6 : n === 2 ? 0.9 : 0.9 + (n - 2) * 0.2) * diff(adv).hp;
  monsterIds = monsterIds.slice();
  const limit = n === 1 ? 2 : n + 1;
  while (monsterIds.length > limit) {
    // drop the weakest monster first, so bosses always stay
    let weakest = 0;
    monsterIds.forEach((k, i) => { if ((A.monsters[k].xp || 0) < (A.monsters[monsterIds[weakest]].xp || 0)) weakest = i; });
    monsterIds.splice(weakest, 1);
  }
  const counts = {};
  for (const k of monsterIds) counts[k] = (counts[k] || 0) + 1;
  const seen = {};
  const monsters = monsterIds.map((key) => {
    if (!A.monsters[key]) fail(`Unknown monster "${key}".`);
    seen[key] = (seen[key] || 0) + 1;
    return newMonster(A, key, counts[key] > 1 ? `${A.monsters[key].name} ${seen[key]}` : A.monsters[key].name, scale);
  });
  for (const m of monsters) meet(adv, m.key);
  adv.combat = { monsters, win: opts.win || null, canFlee: opts.flee !== false, atkAdj: n === 1 ? -1 : 0, bless: 0, scale };
  for (const { c } of heroes(adv)) { c.status = {}; c.defending = false; }
  log(adv, 'combat', `${opts.text ? `${opts.text} ` : ''}Combat begins: ${monsters.map((m) => m.name).join(', ')}.`, { title: 'Combat', fx: { t: 'combat' } });

  const order = [];
  for (const { id, c } of alive(adv)) order.push({ id: rid(), name: c.name, value: d20() + mod(c.abilities.dex), owner: id });
  for (const m of monsters) order.push({ id: rid(), name: m.name, value: d20() + (A.monsters[m.key].init || 0), owner: null, ref: m.id });
  order.sort((a, b) => b.value - a.value || (a.owner ? -1 : 1));
  room.initiative = { list: order, current: null, round: 1 };
  log(adv, 'roll', `Initiative: ${order.map((e) => `${e.name} ${e.value}`).join(', ')}`);
  runFrom(room, 0);
}

function newMonster(A, key, name, scale) {
  const hp = Math.max(1, Math.round(A.monsters[key].hp * scale));
  return { id: rid(), key, name, hp, maxHp: hp, status: {}, turns: 0, used: {} };
}

function critDice(expr) {
  return expr.replace(/(\d*)d(\d+)/g, (m, c, s) => `${(Number(c) || 1) * 2}d${s}`);
}

// Damage to a monster, with sleep waking and "won't stay down" specials.
function hurtMonster(room, m, dmg, src = {}) {
  const adv = room.adventure;
  const M = content(adv).monsters[m.key];
  bump(adv, 'dealt', Math.min(dmg, m.hp));
  m.hp = Math.max(0, m.hp - dmg);
  if (m.status.sleep && dmg > 0) { delete m.status.sleep; log(adv, 'combat', `${m.name} wakes up!`); }
  if (m.hp > 0) return;
  if (M.fortitude && !m.used.fortitude && !src.crit && !src.radiant && chance(0.5)) {
    m.used.fortitude = true;
    m.hp = 1;
    log(adv, 'combat', `${m.name} refuses to fall, and staggers on with 1 HP!`);
    return;
  }
  log(adv, 'hit', `${m.name} is defeated!`, { fx: { t: 'kill', id: m.id } });
  bump(adv, 'kills');
  meet(adv, m.key, true);
  if (M.reassemble && !m.used.reassemble && !src.radiant && chance(0.4)) {
    m.used.reassemble = true;
    m.hp = Math.max(1, Math.ceil(m.maxHp / 2));
    log(adv, 'combat', `…but ${m.name}'s bones rattle back together! (Holy damage stops this.)`, { fx: { t: 'heal-foe', id: m.id } });
  }
}

function hurtHero(room, heroId, c, dmg, text, fxExtra = {}) {
  const adv = room.adventure;
  if (dmg > 0) dmg = Math.max(1, Math.round(dmg * diff(adv).dmg));
  // Uncanny Dodge: halve the first hit each round.
  if (has(c, 'uncanny-dodge') && c.dodgeRound !== room.initiative.round && dmg > 1) {
    c.dodgeRound = room.initiative.round;
    dmg = Math.ceil(dmg / 2);
    text += ' (Uncanny Dodge halves it)';
  }
  bump(adv, 'taken', Math.min(dmg, c.hp));
  c.hp = Math.max(0, c.hp - dmg);
  log(adv, 'hurt', `${text.replace('{dmg}', dmg)}`, { fx: { t: 'hurt', id: heroId, n: dmg, ...fxExtra } });
  if (c.hp === 0) { bump(adv, 'downs'); c.status = {}; log(adv, 'hurt', `${c.name} falls unconscious!`, { fx: { t: 'down', id: heroId } }); }
  return dmg;
}

function monsterTurn(room, m) {
  const adv = room.adventure;
  const A = content(adv);
  const M = A.monsters[m.key];
  m.turns += 1;

  // Boss tricks: call for help when badly hurt, then a fire burst every few turns.
  if (M.summon && !m.used.summon && m.hp <= m.maxHp * M.summon.at) {
    m.used.summon = true;
    const extra = newMonster(A, M.summon.key, `${A.monsters[M.summon.key].name} (summoned)`, adv.combat.scale);
    adv.combat.monsters.push(extra);
    meet(adv, extra.key);
    room.initiative.list.push({ id: rid(), name: extra.name, value: 0, owner: null, ref: extra.id });
    log(adv, 'combat', `${m.name} ${M.summon.text || 'calls for help!'} ${extra.name} joins the fight.`, { fx: { t: 'combat' } });
    return;
  }
  if (M.burst && m.turns % M.burst.every === 0) {
    delete m.status.charging;
    log(adv, 'combat', `${m.name} unleashes ${M.burst.name}!`, { title: 'Combat', fx: { t: 'burst', id: m.id, style: M.burst.style || 'fire' } });
    for (const { id, c } of alive(adv)) {
      const roll1 = c.defending ? Math.max(d20(), d20()) : d20(); // braced heroes get advantage
      const save = roll1 + mod(c.abilities[M.burst.ability]) + (CLASSES[c.cls].saves.includes(M.burst.ability) ? prof(c) : 0) + blessBonus(adv);
      let dmg = dice(M.burst.dmg);
      const ok = save >= M.burst.dc;
      if (ok) dmg = Math.floor(dmg / 2);
      hurtHero(room, id, c, dmg, `${c.name} is caught in the blast${c.defending ? ' (braced)' : ''}: save ${save} vs DC ${M.burst.dc}${ok ? ', half damage' : ''}. {dmg} damage.`, { from: m.id, style: M.burst.style || 'fire' });
    }
    return;
  }
  // Warn one turn ahead, so heroes can Defend (brace) or finish the fight.
  const warnBurst = M.burst && (m.turns + 1) % M.burst.every === 0;

  for (let i = 0; i < (M.attacks || 1); i++) {
    let targets = alive(adv);
    if (!targets.length) return;
    const visible = targets.filter((h) => !h.c.status.hidden);
    if (visible.length) targets = visible;
    const { id: heroId, c } = pick(targets);
    const r1 = d20();
    const nat = c.defending ? Math.min(r1, d20()) : r1;
    const pack = M.pack && adv.combat.monsters.some((x) => x !== m && x.key === m.key && x.hp > 0) ? 2 : 0;
    const total = nat + M.atk + (adv.combat.atkAdj || 0) + pack;
    const ac = acOf(adv, c);
    if (nat === 20 || (nat !== 1 && total >= ac)) {
      const dmg = dice(nat === 20 ? critDice(M.dmg) : M.dmg);
      hurtHero(room, heroId, c, dmg, `${m.name} ${M.verb || 'attacks'} ${c.name}${pack ? ' (pack tactics)' : ''}: ${total} vs AC ${ac}. Hit for {dmg}${nat === 20 ? ' (critical!)' : ''}.`, { from: m.id, crit: nat === 20, style: M.style });
      if (M.poison && c.hp > 0 && chance(M.poison.chance)) {
        c.status.poison = { turns: M.poison.turns, dmg: M.poison.dmg };
        log(adv, 'hurt', `${c.name} is poisoned!`, { fx: { t: 'status', id: heroId, status: 'poison' } });
      }
    } else {
      log(adv, 'combat', `${m.name} ${M.verb || 'attacks'} ${c.name}: ${total} vs AC ${ac}. Miss${c.defending ? ' (defending)' : ''}.`, { fx: { t: 'miss', id: heroId, from: m.id } });
    }
  }
  if (warnBurst && m.hp > 0) {
    m.status.charging = true;
    log(adv, 'combat', `${m.name} ${M.burst.warn || 'draws burning ash into her hands…'} ${M.burst.name} is coming next turn! (Defend to brace for it.)`, { fx: { t: 'warn', id: m.id, text: `${M.burst.name} next turn!` } });
  }
}

function checkEnd(room) {
  const adv = room.adventure;
  if (!adv.combat) return true;
  if (adv.combat.monsters.every((m) => m.hp <= 0)) { endCombat(room, 'win'); return true; }
  if (!alive(adv).length) { endCombat(room, 'lose'); return true; }
  return false;
}

// Start-of-turn effects. Returns false if the creature loses its turn.
function startTurn(room, who, isHero, heroId) {
  const adv = room.adventure;
  const s = who.status;
  if (s.poison) {
    const dmg = dice(s.poison.dmg);
    if (isHero) hurtHero(room, heroId, who, dmg, `Poison burns through ${who.name}: {dmg} damage.`);
    else { log(adv, 'hit', `Poison burns through ${who.name}: ${dmg} damage.`, { fx: { t: 'dmg', id: who.id, n: dmg, style: 'poison' } }); hurtMonster(room, who, dmg); }
    if (s.poison && --s.poison.turns <= 0) delete s.poison;
    if (who.hp <= 0) return false;
  }
  if (isHero && s.spirit) {
    const target = adv.combat.monsters.find((m) => m.hp > 0);
    if (target) {
      const dmg = dice(`1d8${signed(mod(who.abilities.wis))}`);
      log(adv, 'hit', `${who.name}'s Spiritual Weapon strikes ${target.name} for ${dmg}.`, { fx: { t: 'dmg', id: target.id, n: dmg, style: 'holy', by: heroId } });
      hurtMonster(room, target, dmg, { radiant: true });
    }
    if (--s.spirit.turns <= 0) delete s.spirit;
    if (checkEnd(room)) return false;
  }
  if (isHero && s.hidden) { /* lasts until they attack or their next turn ends */ }
  if (s.stun) {
    delete s.stun;
    log(adv, 'combat', `${who.name} is stunned and loses the turn.`);
    return false;
  }
  if (s.sleep) {
    if (--s.sleep.turns <= 0) { delete s.sleep; log(adv, 'combat', `${who.name} wakes up.`); return true; }
    log(adv, 'combat', `${who.name} is fast asleep. Zzz…`);
    return false;
  }
  return true;
}

// Advance through the initiative order, running monster turns, until a hero is up.
function runFrom(room, index) {
  const adv = room.adventure;
  const init = room.initiative;
  let i = index;
  for (let guard = 0; guard < 500; guard++) {
    if (checkEnd(room)) return;
    if (i >= init.list.length) {
      i = 0;
      init.round += 1;
      if (adv.combat.bless > 0 && --adv.combat.bless === 0) log(adv, 'combat', 'The blessing fades.');
    }
    const e = init.list[i];
    init.current = e.id;
    if (e.owner) {
      const c = adv.party[e.owner];
      if (c && c.hp > 0) {
        ensureHero(c);
        c.defending = false;
        if (c.status.hidden && --c.status.hidden.turns <= 0) delete c.status.hidden;
        if (startTurn(room, c, true, e.owner) && c.hp > 0 && adv.combat) return; // wait for the player
        if (!adv.combat) return;
      }
    } else {
      const m = adv.combat.monsters.find((x) => x.id === e.ref);
      if (m && m.hp > 0 && startTurn(room, m, false) && m.hp > 0) monsterTurn(room, m);
      if (!adv.combat) return;
    }
    i += 1;
  }
}

function endCombat(room, how) {
  const adv = room.adventure;
  const A = content(adv);
  const c = adv.combat;
  adv.combat = null;
  room.initiative = { list: [], current: null, round: 1 };
  for (const { c: h } of heroes(adv)) { h.defending = false; h.status = {}; }

  if (how === 'lose') {
    log(adv, 'ending', A.defeat || 'The party falls...', { title: 'Defeat', fx: { t: 'defeat' } });
    bump(adv, 'defeats');
    adv.gold = Math.floor(adv.gold * (1 - diff(adv).goldLoss));
    restAll(adv);
    adv.prev = null;
    adv.location = A.start;
    adv.scene = null;
    logPlace(adv, A.start);
    return;
  }
  for (const { c: h } of heroes(adv)) if (h.hp <= 0) { h.hp = 1; log(adv, 'combat', `${h.name} comes to, battered but alive.`); }
  if (how === 'fled') {
    log(adv, 'combat', 'You get away!');
    if (adv.prev && adv.prev !== adv.location) moveTo(room, adv.prev, false);
    return;
  }
  log(adv, 'combat', 'Victory!', { title: 'Victory', fx: { t: 'victory' } });
  bump(adv, 'wins');
  // Loot: gold from the fallen, and the occasional item.
  let gold = 0;
  for (const m of c.monsters) {
    const M = A.monsters[m.key];
    if (M.gold) gold += dice(M.gold);
    if (M.drop && chance(M.drop.chance)) addItem(adv, M.drop.item);
  }
  if (gold) { adv.gold += gold; bump(adv, 'gold', gold); log(adv, 'loot', `+${gold} gold from the fallen.`, { fx: { t: 'gold', n: gold } }); }
  giveXp(adv, c.monsters.reduce((sum, m) => sum + (A.monsters[m.key].xp || 0), 0));
  if (c.win) apply(room, null, c.win);
}

const CONSUMABLE_TARGETS = { heal: 'ally', restoreSlot: 'ally', throw: 'enemy' };
function consumables(adv) {
  const A = content(adv);
  return Object.entries(adv.inventory).filter(([id, n]) => n > 0 && itemDef(A, id).kind === 'consumable').map(([id, n]) => {
    const it = itemDef(A, id);
    const target = it.heal ? 'ally' : it.restoreSlot ? 'ally' : it.throw ? 'enemy' : 'none';
    return { id, n, name: it.name, desc: it.desc, target };
  });
}

function heroActions(adv, c) {
  ensureHero(c);
  const C = CLASSES[c.cls];
  const W = C.weapon;
  const g = gearBonus(adv, c);
  const abil = c.cls === 'rogue' ? 'dex' : W.ability;
  const atk = prof(c) + mod(c.abilities[abil]) + g.atk + blessBonus(adv);
  const dmgMod = mod(c.abilities[abil]) + g.dmg;
  const spellAtk = prof(c) + mod(c.abilities[c.cls === 'cleric' ? 'wis' : 'int']) + g.spell + blessBonus(adv);
  const dc = 8 + prof(c) + mod(c.abilities[c.cls === 'cleric' ? 'wis' : 'int']) + g.spell;
  const sneak = c.cls === 'rogue' ? ` + ${Math.ceil(c.level / 2)}d6 sneak${c.status.hidden ? ' (doubled from hiding)' : ''}` : '';
  const strikes = has(c, 'extra-attack') ? ' · strikes twice' : '';
  const out = [{ id: 'attack', label: `Attack with ${weaponName(adv, c)}`, desc: `${signed(atk)} to hit, ${W.dmg}${signed(dmgMod)} damage${sneak}${strikes}`, target: 'enemy' }];
  if (c.cls === 'fighter') {
    out.push({ id: 'second-wind', label: 'Second Wind', desc: `Heal yourself 1d10+${c.level}`, target: 'none', uses: c.uses.secondWind, skill: true });
    if (has(c, 'action-surge')) out.push({ id: 'action-surge', label: 'Action Surge', desc: `Attack twice this turn${has(c, 'extra-attack') ? ' (four strikes!)' : ''}`, target: 'enemy', uses: c.uses.surge, skill: true });
    if (has(c, 'shield-bash')) out.push({ id: 'shield-bash', label: 'Shield Bash', desc: 'An attack that stuns the target for a turn (bosses resist)', target: 'enemy', uses: c.uses.bash, skill: true });
  }
  if (c.cls === 'rogue') {
    if (has(c, 'hide')) out.push({ id: 'hide', label: 'Hide', desc: 'Enemies can\'t target you, and your next attack doubles its sneak damage', target: 'none', skill: true });
    if (has(c, 'poison-blade')) out.push({ id: 'poison-blade', label: 'Poisoned Blade', desc: 'An attack that poisons the target (1d4 per turn for 3 turns)', target: 'enemy', uses: c.uses.poison, skill: true });
  }
  if (c.cls === 'wizard') {
    out.push({ id: 'fire-bolt', label: 'Fire Bolt', desc: `${signed(spellAtk)} to hit, ${c.level >= 5 ? '2d10' : '1d10'} fire damage`, target: 'enemy', skill: true });
    out.push({ id: 'magic-missile', label: 'Magic Missile', desc: '3 darts of 1d4+1. Never misses.', target: 'enemy', uses: c.uses.slots, skill: true });
    if (has(c, 'burning-hands')) out.push({ id: 'burning-hands', label: 'Burning Hands', desc: `Every enemy: 3d6 fire (DC ${dc} DEX save for half)`, target: 'none', uses: c.uses.slots, skill: true });
    if (has(c, 'sleep')) out.push({ id: 'sleep', label: 'Sleep', desc: 'The weakest enemies (5d8 HP worth) sleep for 2 turns. Bosses resist.', target: 'none', uses: c.uses.slots, skill: true });
    if (has(c, 'fireball')) out.push({ id: 'fireball', label: 'Fireball', desc: `Every enemy: 6d6 fire (DC ${dc} DEX save for half)`, target: 'none', uses: c.uses.slots, skill: true });
  }
  if (c.cls === 'cleric') {
    out.push({ id: 'sacred-flame', label: 'Sacred Flame', desc: `Target must beat DC ${dc} or take ${c.level >= 5 ? '2d8' : '1d8'} radiant damage (stops undead rising)`, target: 'enemy', skill: true });
    out.push({ id: 'cure-wounds', label: 'Cure Wounds', desc: `Heal an ally 1d8+${mod(c.abilities.wis)}. Revives the fallen.`, target: 'ally', uses: c.uses.slots, skill: true });
    if (has(c, 'bless')) out.push({ id: 'bless', label: 'Bless', desc: 'The whole party gets +2 to hit and saves for 3 rounds', target: 'none', uses: c.uses.slots, skill: true });
    if (has(c, 'spirit-weapon')) out.push({ id: 'spirit-weapon', label: 'Spiritual Weapon', desc: `A spectral hammer hits an enemy for 1d8${signed(mod(c.abilities.wis))} each turn, 3 turns`, target: 'none', uses: c.uses.slots, skill: true });
    if (has(c, 'mass-cure')) out.push({ id: 'mass-cure', label: 'Mass Cure', desc: `Heal everyone 1d8+${mod(c.abilities.wis)} and revive the fallen`, target: 'none', uses: c.uses.slots, skill: true });
  }
  for (const it of consumables(adv)) out.push({ id: `item:${it.id}`, label: it.name, desc: it.desc, target: it.target, uses: it.n, item: true });
  out.push({ id: 'defend', label: 'Defend', desc: 'Enemies attack you with disadvantage until your next turn', target: 'none' });
  if (adv.combat && adv.combat.canFlee) out.push({ id: 'flee', label: 'Run away', desc: 'Acrobatics DC 12 for the whole party to escape', target: 'none' });
  return out;
}

function weaponName(adv, c) {
  const id = c.gear && c.gear.weapon;
  return id ? itemName(content(adv), id) : CLASSES[c.cls].weapon.name;
}

function attackRoll(room, c, m, bonus, dmgExpr, verb, fxStyle = 'slash', opts = {}) {
  const adv = room.adventure;
  const M = content(adv).monsters[m.key];
  const advantage = opts.advantage || m.status.sleep || m.status.stun;
  const nat = advantage ? Math.max(d20(), d20()) : d20();
  const total = nat + bonus;
  if (nat === 20 || (nat !== 1 && total >= M.ac)) {
    const dmg = Math.max(1, dice(nat === 20 ? critDice(dmgExpr) : dmgExpr));
    if (nat === 20) bump(adv, 'crits');
    log(adv, 'hit', `${c.name} ${verb} ${m.name}: ${total} vs AC ${M.ac}${advantage ? ' (advantage)' : ''}. Hit for ${dmg}${nat === 20 ? ' (critical!)' : ''}.`, { fx: { t: 'dmg', id: m.id, n: dmg, crit: nat === 20, by: idOf(adv, c), style: fxStyle } });
    hurtMonster(room, m, dmg, { crit: nat === 20, radiant: fxStyle === 'holy' });
    return true;
  }
  log(adv, 'combat', `${c.name} ${verb} ${m.name}: ${total} vs AC ${M.ac}. Miss${nat === 1 ? ' (natural 1)' : ''}.`, { fx: { t: 'miss', id: m.id, by: idOf(adv, c) } });
  return false;
}

// One weapon attack (with gear, sneak attack and silver-vs-undead bonuses).
function weaponStrike(room, c, target, extraEffect) {
  const adv = room.adventure;
  const A = content(adv);
  const W = CLASSES[c.cls].weapon;
  const g = gearBonus(adv, c);
  const abil = c.cls === 'rogue' ? 'dex' : W.ability;
  const m = mod(c.abilities[abil]) + g.dmg;
  let expr = `${W.dmg}${signed(m)}`;
  if (c.cls === 'rogue') expr += `+${Math.ceil(c.level / 2) * (c.status.hidden ? 2 : 1)}d6`;
  if (g.extra && (!g.vs || (A.monsters[target.key].type === g.vs))) expr += `+${g.extra}`;
  const hiddenAdv = !!c.status.hidden;
  delete c.status.hidden;
  const hit = attackRoll(room, c, target, prof(c) + mod(c.abilities[abil]) + g.atk + blessBonus(adv), expr, `strikes with ${weaponName(adv, c)} at`, c.cls === 'rogue' ? 'stab' : 'slash', { advantage: hiddenAdv });
  if (hit && extraEffect && target.hp > 0) extraEffect(target);
  return hit;
}

function nextTarget(adv, preferred) {
  const living = adv.combat.monsters.filter((m) => m.hp > 0);
  return living.find((m) => m === preferred) || living[0] || null;
}

function areaSave(room, c, name, dmgExpr, style) {
  const adv = room.adventure;
  const A = content(adv);
  const dc = 8 + prof(c) + mod(c.abilities.int) + gearBonus(adv, c).spell;
  log(adv, 'combat', `${c.name} casts ${name}!`, { fx: { t: 'cast', by: idOf(adv, c), style, spell: name.toLowerCase().replace(/\s+/g, '-') } });
  for (const m of adv.combat.monsters.filter((x) => x.hp > 0)) {
    const save = d20() + (A.monsters[m.key].save || 0);
    let dmg = dice(dmgExpr);
    if (save >= dc) dmg = Math.floor(dmg / 2);
    log(adv, 'hit', `${m.name}: save ${save} vs DC ${dc}${save >= dc ? ', half' : ''}. ${dmg} fire damage.`, { fx: { t: 'dmg', id: m.id, n: dmg, style } });
    hurtMonster(room, m, dmg);
  }
}

function heal(adv, healer, target, expr, how) {
  const amount = Math.max(1, dice(expr));
  const wasDown = target.hp <= 0;
  target.hp = Math.min(target.maxHp, target.hp + amount);
  log(adv, 'heal', `${healer.name} ${how}${target === healer ? '' : ` on ${target.name}`}: +${amount} HP${wasDown ? `. ${target.name} is back on their feet!` : '.'}`, { fx: { t: 'heal', id: idOf(adv, target), n: amount } });
}

function useConsumable(room, c, id, msg) {
  const adv = room.adventure;
  const A = content(adv);
  const it = itemDef(A, id);
  if (!(adv.inventory[id] > 0) || it.kind !== 'consumable') fail('You don\'t have that.');
  const ally = (msg.ally && adv.party[msg.ally]) || c;
  if (it.heal) {
    if (!adv.combat && ally.hp >= ally.maxHp) fail(`${ally.name} is already at full health.`);
    adv.inventory[id] -= 1;
    bump(adv, 'potions');
    heal(adv, c, ally, it.heal, `uses a ${it.name.toLowerCase()}`);
  } else if (it.restoreSlot) {
    if (!['wizard', 'cleric'].includes(ally.cls)) fail('Only spellcasters can use that.');
    if (ally.uses.slots >= fullUses(ally.cls, ally.level).slots) fail(`${ally.name}'s spells are already full.`);
    adv.inventory[id] -= 1;
    ally.uses.slots += it.restoreSlot;
    log(adv, 'heal', `${ally.name} drinks the ${it.name.toLowerCase()} and regains a spell slot.`, { fx: { t: 'heal', id: idOf(adv, ally), n: 0 } });
  } else if (it.throw) {
    if (!adv.combat) fail('Save that for a fight.');
    const target = nextTarget(adv, adv.combat.monsters.find((m) => m.id === msg.target));
    adv.inventory[id] -= 1;
    attackRoll(room, c, target, prof(c) + mod(c.abilities.dex), it.throw, `throws a ${it.name.toLowerCase()} at`, 'fire');
  } else fail('You can\'t use that.');
}

function combatAction(room, meId, msg) {
  const adv = room.adventure;
  const combat = adv.combat;
  const init = room.initiative;
  const idx = init.list.findIndex((e) => e.id === init.current);
  const entry = init.list[idx];
  if (!entry || entry.owner !== meId) fail("It's not your turn.");
  const c = ensureHero(adv.party[meId]);
  const action = heroActions(adv, c).find((a) => a.id === msg.action);
  if (!action) fail('You can\'t do that.');
  if (action.uses !== undefined && action.uses <= 0) fail('None left. Rest to recover.');

  const target = nextTarget(adv, combat.monsters.find((m) => m.id === msg.target));
  const ally = (msg.ally && adv.party[msg.ally]) || c;
  const strike = (t, fx) => weaponStrike(room, c, t, fx);
  const strikes = (n, first, fx) => {
    let t = first;
    for (let i = 0; i < n && adv.combat; i++) {
      t = nextTarget(adv, t);
      if (!t) break;
      strike(t, i === 0 ? fx : null);
    }
  };

  if (action.item) {
    useConsumable(room, c, action.id.slice(5), msg);
  } else {
    switch (action.id) {
      case 'attack':
        strikes(has(c, 'extra-attack') ? 2 : 1, target);
        break;
      case 'action-surge':
        c.uses.surge -= 1;
        log(adv, 'combat', `${c.name} surges into action!`);
        strikes(has(c, 'extra-attack') ? 4 : 2, target);
        break;
      case 'shield-bash':
        c.uses.bash -= 1;
        strike(target, (t) => {
          if ((content(adv).monsters[t.key].xp || 0) >= 200) { log(adv, 'combat', `${t.name} shrugs off the bash.`); return; }
          t.status.stun = true;
          log(adv, 'combat', `${t.name} is stunned!`, { fx: { t: 'status', id: t.id, status: 'stun' } });
        });
        break;
      case 'second-wind':
        c.uses.secondWind -= 1;
        heal(adv, c, c, `1d10+${c.level}`, 'catches a second wind');
        break;
      case 'hide':
        c.status.hidden = { turns: 2 };
        log(adv, 'combat', `${c.name} melts into the shadows.`, { fx: { t: 'defend', id: meId } });
        break;
      case 'poison-blade':
        c.uses.poison -= 1;
        strike(target, (t) => {
          t.status.poison = { turns: 3, dmg: '1d4' };
          log(adv, 'combat', `${t.name} is poisoned!`, { fx: { t: 'status', id: t.id, status: 'poison' } });
        });
        break;
      case 'fire-bolt':
        attackRoll(room, c, target, prof(c) + mod(c.abilities.int) + gearBonus(adv, c).spell + blessBonus(adv), c.level >= 5 ? '2d10' : '1d10', 'hurls a Fire Bolt at', 'fire');
        break;
      case 'magic-missile': {
        c.uses.slots -= 1;
        const dmg = dice('1d4+1') + dice('1d4+1') + dice('1d4+1');
        log(adv, 'hit', `${c.name} casts Magic Missile at ${target.name}: ${dmg} damage.`, { fx: { t: 'dmg', id: target.id, n: dmg, style: 'arcane', by: meId } });
        hurtMonster(room, target, dmg);
        break;
      }
      case 'burning-hands':
        c.uses.slots -= 1;
        areaSave(room, c, 'Burning Hands', '3d6', 'fire');
        break;
      case 'fireball':
        c.uses.slots -= 1;
        areaSave(room, c, 'Fireball', '6d6', 'fire');
        break;
      case 'sleep': {
        c.uses.slots -= 1;
        let pool = dice('5d8');
        log(adv, 'combat', `${c.name} casts Sleep (${pool} HP worth).`, { fx: { t: 'cast', by: meId, style: 'arcane', spell: 'sleep' } });
        const A = content(adv);
        const targets = combat.monsters.filter((m) => m.hp > 0 && (A.monsters[m.key].xp || 0) < 200 && !A.monsters[m.key].noSleep).sort((a, b) => a.hp - b.hp);
        let slept = 0;
        for (const m of targets) {
          if (m.hp > pool) break;
          pool -= m.hp;
          m.status.sleep = { turns: 2 };
          slept++;
          log(adv, 'combat', `${m.name} falls asleep.`, { fx: { t: 'status', id: m.id, status: 'sleep' } });
        }
        if (!slept) log(adv, 'combat', 'Nobody falls asleep.');
        break;
      }
      case 'sacred-flame': {
        const M = content(adv).monsters[target.key];
        const dc = 8 + prof(c) + mod(c.abilities.wis) + gearBonus(adv, c).spell;
        const save = d20() + (M.save || 0) + (target.status.sleep ? -5 : 0);
        if (save >= dc) {
          log(adv, 'combat', `${c.name} calls down Sacred Flame on ${target.name}: it saves (${save} vs DC ${dc}).`, { fx: { t: 'miss', id: target.id, by: meId } });
        } else {
          const dmg = dice(c.level >= 5 ? '2d8' : '1d8');
          log(adv, 'hit', `${c.name} calls down Sacred Flame on ${target.name}: ${save} vs DC ${dc}. ${dmg} radiant damage.`, { fx: { t: 'dmg', id: target.id, n: dmg, style: 'holy', by: meId } });
          hurtMonster(room, target, dmg, { radiant: true });
        }
        break;
      }
      case 'cure-wounds':
        c.uses.slots -= 1;
        heal(adv, c, ally, `1d8+${Math.max(0, mod(c.abilities.wis))}`, 'casts Cure Wounds');
        break;
      case 'bless':
        c.uses.slots -= 1;
        combat.bless = 3;
        log(adv, 'heal', `${c.name} blesses the party: +2 to hit and saves for 3 rounds.`, { fx: { t: 'cast', by: meId, style: 'holy', spell: 'bless' } });
        break;
      case 'spirit-weapon':
        c.uses.slots -= 1;
        c.status.spirit = { turns: 3 };
        log(adv, 'combat', `${c.name} summons a Spiritual Weapon: a hammer of light.`, { fx: { t: 'cast', by: meId, style: 'holy', spell: 'spirit-weapon' } });
        break;
      case 'mass-cure':
        c.uses.slots -= 1;
        for (const { c: h } of heroes(adv)) heal(adv, c, h, `1d8+${Math.max(0, mod(c.abilities.wis))}`, 'casts Mass Cure');
        break;
      case 'defend':
        c.defending = true;
        log(adv, 'combat', `${c.name} takes a defensive stance.`, { fx: { t: 'defend', id: meId } });
        break;
      case 'flee': {
        const total = d20() + skillBonus(c, 'acrobatics');
        if (total >= 12) {
          log(adv, 'roll', `${c.name} looks for an escape: Acrobatics ${total} vs DC 12. Success!`, { ok: true, fx: { t: 'check', total, dc: 12, ok: true } });
          endCombat(room, 'fled');
          return;
        }
        log(adv, 'roll', `${c.name} looks for an escape: Acrobatics ${total} vs DC 12. No way out!`, { ok: false, fx: { t: 'check', total, dc: 12, ok: false } });
        break;
      }
      default:
        fail('Unknown action.');
    }
  }
  if (adv.combat) runFrom(room, idx + 1);
}

// ---------- equipment ----------
function equip(adv, c, itemId) {
  const A = content(adv);
  const it = itemDef(A, itemId);
  if (!it.slot) fail('That can\'t be equipped.');
  if (!(adv.inventory[itemId] > 0)) fail('You don\'t have that.');
  if (it.classes && !it.classes.includes(c.cls)) fail(`Only a ${it.classes.map((k) => CLASSES[k].name).join(' or ')} can use that.`);
  const old = c.gear[it.slot];
  if (old) unequip(adv, c, it.slot, true);
  adv.inventory[itemId] -= 1;
  c.gear[it.slot] = itemId;
  if (it.hp) { c.maxHp += it.hp; c.hp += it.hp; }
  log(adv, 'loot', `${c.name} equips ${it.name}.`, { fx: { t: 'equip' } });
}

function unequip(adv, c, slot, quiet) {
  const A = content(adv);
  const id = c.gear[slot];
  if (!id) return;
  const it = itemDef(A, id);
  c.gear[slot] = null;
  adv.inventory[id] = (adv.inventory[id] || 0) + 1;
  if (it.hp) { c.maxHp -= it.hp; c.hp = Math.max(1, Math.min(c.hp, c.maxHp)); }
  if (!quiet) log(adv, 'loot', `${c.name} takes off ${it.name}.`);
}

// The bestiary: every monster the party has met, with tips worked out from what it can do.
function bestiaryView(adv) {
  const A = content(adv);
  return Object.entries(adv.bestiary || {}).filter(([k]) => A.monsters[k]).map(([key, b]) => {
    const M = A.monsters[key];
    const tips = [];
    if (M.type === 'undead') tips.push('Undead: silver weapons and radiant damage (Sacred Flame) hit hard.');
    if (M.reassemble) tips.push('May pull itself back together after falling. Radiant damage stops it.');
    if (M.fortitude) tips.push('May refuse to fall once. A critical hit or radiant damage finishes it.');
    if (M.noSleep) tips.push('Can\'t be put to sleep.');
    if (M.pack) tips.push('Pack tactics: hits harder while friends of its kind stand. Thin the pack first.');
    if (M.poison) tips.push('Its attacks can poison: damage over a few turns.');
    if (M.attacks > 1) tips.push(`Attacks ${M.attacks} times a turn.`);
    if (M.burst) tips.push(`Every ${M.burst.every} turns unleashes ${M.burst.name} on the whole party (${M.burst.ability.toUpperCase()} save). Defend when it's warned.`);
    if (M.summon) tips.push(`Calls ${A.monsters[M.summon.key].name}s for help at half health.`);
    if (M.style === 'fire') tips.push('Attacks with fire from a distance.');
    if (M.drop) tips.push(`Sometimes carries ${itemDef(A, M.drop.item).name.toLowerCase()}.`);
    return {
      key, name: M.name, type: M.type || 'creature', lore: M.lore || '', icon: icon(M.icon || key, 'skull'),
      hp: M.hp, ac: M.ac, xp: M.xp, boss: (M.xp || 0) >= 200, seen: b.seen, defeated: b.defeated, tips,
    };
  }).sort((a, b) => a.xp - b.xp || a.name.localeCompare(b.name));
}

// ---------- player messages ----------
function handle(room, me, isHost, msg) {
  const adv = room.adventure;
  const A = content(adv);

  if (msg.t === 'adv:reset') {
    if (!isHost) fail('Only the host can restart the adventure.');
    const fresh = create(adv.id, { difficulty: adv.difficulty });
    for (const [id, c] of Object.entries(adv.party)) fresh.party[id] = makeHero(c.name, c.cls);
    room.adventure = fresh;
    room.initiative = { list: [], current: null, round: 1 };
    return;
  }

  if (msg.t === 'adv:difficulty') {
    if (!isHost) fail('Only the host can change the difficulty.');
    if (!DIFFICULTY[msg.level]) fail('Unknown difficulty.');
    if (adv.combat) fail('Change it after the fight.');
    adv.difficulty = msg.level;
    log(adv, 'story', `The host sets the difficulty to ${DIFFICULTY[msg.level].name}.`);
    return;
  }

  if (msg.t === 'adv:create') {
    if (adv.combat) fail('Wait until the fight is over.');
    const cls = CLASSES[msg.cls] ? msg.cls : null;
    if (!cls) fail('Pick a class.');
    const name = str(msg.name, 30).trim() || me.name;
    const existed = adv.party[me.id];
    if (!existed && Object.keys(adv.party).length >= 8) fail('The party is full (8 heroes).');
    if (existed) for (const slot of Object.keys(existed.gear || {})) unequip(adv, existed, slot, true);
    const hero = makeHero(name, cls);
    // Late joiners catch up to the party's level.
    const top = Math.max(0, ...Object.values(adv.party).map((h) => h.xp));
    adv.party[me.id] = hero;
    if (top > 0) giveXpTo(adv, hero, top);
    log(adv, 'party', `${name} the ${CLASSES[cls].name} ${existed ? 'is reborn' : 'joins the party'}.`);
    return;
  }

  const c = adv.party[me.id];
  if (!c) fail('Create your hero first.');
  ensureHero(c);

  if (msg.t === 'adv:act') {
    if (!adv.combat) fail('There is nothing to fight.');
    combatAction(room, me.id, msg);
    return;
  }

  // Equipment can be changed any time outside a fight, for any hero in the party.
  if (msg.t === 'adv:equip' || msg.t === 'adv:unequip') {
    if (adv.combat) fail('No time to change gear mid-fight!');
    const hero = adv.party[msg.hero] ? ensureHero(adv.party[msg.hero]) : c;
    if (msg.t === 'adv:equip') equip(adv, hero, str(msg.item, 40));
    else { if (!['weapon', 'armor', 'trinket'].includes(msg.slot)) fail('Unknown slot.'); unequip(adv, hero, msg.slot); }
    return;
  }
  if (msg.t === 'adv:use') {
    useConsumable(room, c, str(msg.item, 40), msg);
    return;
  }
  if (adv.combat) fail('Finish the fight first!');

  switch (msg.t) {
    case 'adv:travel': {
      const p = pathsFrom(adv, adv.location).find((x) => x.to === msg.to);
      if (!p) fail('You can\'t get there from here.');
      if (!p.ok) fail(p.locked);
      log(adv, 'travel', `${c.name} leads the party toward ${A.locations[p.to].name}.`);
      moveTo(room, p.to, true);
      return;
    }

    case 'adv:do': {
      const L = A.locations[adv.location];
      if (msg.kind === 'scene') {
        const action = (L.actions || []).find((a) => a.scene === msg.id && test(adv, a.when));
        if (!action) fail('You can\'t do that here.');
        if (action.cost) {
          if (adv.gold < action.cost) fail(`That costs ${action.cost} gold.`);
          adv.gold -= action.cost;
        }
        enterScene(adv, msg.id);
        return;
      }
      if (msg.kind === 'coach') {
        if (!L.coach) fail('There is no coach stop here.');
        if (!coachStops(adv).includes(msg.to)) fail('The coach doesn\'t go there (yet).');
        if (adv.gold < COACH_PRICE) fail(`The coach costs ${COACH_PRICE} gold.`);
        adv.gold -= COACH_PRICE;
        log(adv, 'travel', `The party takes the coach to ${A.locations[msg.to].name} (${COACH_PRICE} gold).`);
        moveTo(room, msg.to, false);
        return;
      }
      if (msg.kind === 'inn') {
        if (!L.inn) fail('There is no inn here.');
        if (adv.gold < L.inn.price) fail(`A night at ${L.inn.name} costs ${L.inn.price} gold.`);
        adv.gold -= L.inn.price;
        restAll(adv);
        adv.scene = null;
        log(adv, 'heal', `The party rests at ${L.inn.name} (${L.inn.price} gold). Everyone wakes fully healed, with spells and abilities restored.`, { fx: { t: 'rest' } });
        return;
      }
      if (msg.kind === 'buy') {
        const offer = (L.shop || []).find((s) => s.item === msg.item);
        if (!offer) fail('Nobody here sells that.');
        if (adv.gold < offer.price) fail(`That costs ${offer.price} gold.`);
        adv.gold -= offer.price;
        adv.inventory[offer.item] = (adv.inventory[offer.item] || 0) + 1;
        log(adv, 'loot', `Bought ${itemName(A, offer.item)} for ${offer.price} gold.`, { fx: { t: 'gold', n: -offer.price } });
        return;
      }
      if (msg.kind === 'camp') {
        if (L.inn) fail('Why camp? There\'s an inn right here.');
        adv.scene = null;
        for (const { c: h } of heroes(adv)) {
          h.hp = Math.min(h.maxHp, h.hp + Math.ceil(h.maxHp / 2));
          h.uses.secondWind = fullUses(h.cls, h.level).secondWind;
        }
        log(adv, 'heal', 'The party makes camp and rests for an hour. Everyone recovers half their hit points. (Spells only come back at an inn.)', { fx: { t: 'rest' } });
        if (maybeEncounter(room, 0.6)) log(adv, 'combat', 'Something found your camp!');
        return;
      }
      fail('Unknown action.');
      return;
    }

    case 'adv:choose': {
      if (!adv.scene) fail('Nothing to choose right now.');
      const scene = A.scenes[adv.scene];
      if (msg.index === -1) {
        if (scene.noLeave) fail('You can\'t leave right now.');
        adv.scene = null;
        return;
      }
      const choice = scene.choices[msg.index];
      if (!choice || !test(adv, choice.when)) fail('That isn\'t an option.');
      if (choice.cost) {
        if (adv.gold < choice.cost) fail(`You need ${choice.cost} gold.`);
        adv.gold -= choice.cost;
      }
      log(adv, 'choice', `${c.name}: ${choice.label}`);
      if (choice.check) {
        const bonus = checkBonus(adv, c, choice.check);
        const nat = d20();
        const total = nat + bonus;
        const ok = total >= choice.check.dc;
        log(adv, 'roll', `${c.name} rolls ${checkLabel(choice.check)}: ${nat} ${signed(bonus)} = ${total} vs DC ${choice.check.dc}. ${ok ? 'Success!' : 'Failure.'}`, {
          ok, fx: { t: 'check', nat, bonus, total, dc: choice.check.dc, ok, label: checkLabel(choice.check), who: c.name },
        });
        apply(room, c, ok ? choice.success : choice.failure);
      } else {
        apply(room, c, choice);
      }
      return;
    }

    default:
      fail('Unknown action.');
  }
}

// Mirror heroes onto the regular character sheets so the Character tab shows them.
function syncSheets(room) {
  const adv = room.adventure;
  const A = content(adv);
  const inv = Object.entries(adv.inventory).filter(([, n]) => n > 0).map(([id, n]) => `${itemName(A, id)}${n > 1 ? ` ×${n}` : ''}`);
  for (const [id, c] of Object.entries(adv.party)) {
    ensureHero(c);
    const C = CLASSES[c.cls];
    const prev = room.sheets[id] || {};
    const gear = Object.values(c.gear).filter(Boolean).map((g) => itemName(A, g));
    room.sheets[id] = {
      ...prev,
      name: c.name, cls: C.name, race: prev.race || '', background: prev.background || '',
      level: c.level, hp: c.hp, maxHp: c.maxHp, tempHp: 0, ac: acOf(adv, c), speed: 30, prof: prof(c), initBonus: 0,
      ...c.abilities,
      saveProf: Object.fromEntries(Object.keys(ABILITY_NAMES).map((a) => [a, C.saves.includes(a)])),
      inventory: [`Gold: ${adv.gold} (shared)`, ...(gear.length ? [`Equipped: ${gear.join(', ')}`] : []), ...inv].join('\n'),
      notes: `${C.desc}\nWeapon: ${weaponName(adv, c)} (${C.weapon.dmg})\nSkills: ${C.skills.map((s) => SKILL_NAMES[s] || s).join(', ')}\nTalents: ${talentsOf(c).map((t) => TALENTS[t].name).join(', ') || 'none yet'}\nXP: ${c.xp}${c.level < MAX_LEVEL ? ` / ${XP_LEVELS[c.level]}` : ''}`,
    };
  }
}

// ---------- what the browser sees ----------
const STATUS_LABELS = { poison: 'Poisoned', sleep: 'Asleep', stun: 'Stunned', hidden: 'Hidden', spirit: 'Spirit hammer', charging: 'Charging!' };
const statusList = (s) => Object.keys(s || {}).filter((k) => STATUS_LABELS[k]).map((k) => ({ id: k, label: STATUS_LABELS[k], turns: (s[k] && s[k].turns) || null }));

function itemView(A, id, n) {
  const it = itemDef(A, id);
  const stats = [];
  if (it.atk) stats.push(`${signed(it.atk)} to hit`);
  if (it.dmg) stats.push(`${signed(it.dmg)} damage`);
  if (it.extra) stats.push(`+${it.extra}${it.vs ? ` vs ${it.vs}` : ''}`);
  if (it.ac) stats.push(`${signed(it.ac)} AC`);
  if (it.acBonus) stats.push(`${signed(it.acBonus)} AC (party)`);
  if (it.hp) stats.push(`+${it.hp} max HP`);
  if (it.spell) stats.push(`${signed(it.spell)} spells`);
  if (it.check) stats.push(`${signed(it.check)} to checks`);
  return {
    id, n, name: itemName(A, id), desc: it.desc || '', icon: itemIcon(A, id), kind: it.kind || (it.slot ? 'gear' : 'key'), slot: it.slot || null,
    stats: stats.join(', '), classes: it.classes || null, usable: it.kind === 'consumable' ? (it.throw ? 'combat' : 'any') : null,
  };
}

function view(room, meId) {
  const adv = room.adventure;
  const A = content(adv);
  const L = A.locations[adv.location];
  const me = adv.party[meId] ? ensureHero(adv.party[meId]) : null;
  const known = knownLocations(adv);

  const party = Object.entries(adv.party).map(([id, c]) => {
    ensureHero(c);
    return {
      id, name: c.name, cls: c.cls, clsName: CLASSES[c.cls].name, level: c.level,
      xp: c.xp, nextXp: c.level < MAX_LEVEL ? XP_LEVELS[c.level] : null,
      hp: c.hp, maxHp: c.maxHp, ac: acOf(adv, c), defending: c.defending, uses: c.uses,
      status: statusList(c.status), blessed: blessBonus(adv) > 0,
      gear: Object.fromEntries(Object.entries(c.gear).map(([slot, gid]) => [slot, gid ? itemView(A, gid, 1) : null])),
      talents: talentsOf(c).map((t) => ({ id: t, ...TALENTS[t] })),
      nextTalent: c.level < MAX_LEVEL && LEARN[c.cls][c.level + 1] ? TALENTS[LEARN[c.cls][c.level + 1]].name : null,
      weapon: weaponName(adv, c),
    };
  });

  let scene = null;
  if (adv.scene && !adv.combat) {
    const S = A.scenes[adv.scene];
    scene = {
      id: adv.scene, title: S.title, noLeave: !!S.noLeave,
      choices: S.choices
        .map((ch, index) => ({ ch, index }))
        .filter(({ ch }) => test(adv, ch.when))
        .map(({ ch, index }) => ({
          index, label: ch.label, cost: ch.cost || 0,
          check: ch.check ? { label: checkLabel(ch.check), dc: ch.check.dc, bonus: me ? checkBonus(adv, me, ch.check) : null } : null,
        })),
    };
  }

  const actions = [];
  if (!adv.combat && !adv.scene) {
    for (const a of L.actions || []) if (test(adv, a.when)) actions.push({ kind: 'scene', id: a.scene, label: a.label, cost: a.cost || 0 });
    if (L.inn) actions.push({ kind: 'inn', label: `Rest at ${L.inn.name}`, cost: L.inn.price });
    if (!L.inn) actions.push({ kind: 'camp', label: L.safe ? 'Rest for an hour' : 'Make camp (risky)', cost: 0 });
  }
  const coach = !adv.combat && !adv.scene && L.coach ? coachStops(adv).map((id) => ({ to: id, name: A.locations[id].name, region: A.locations[id].region })) : [];
  const shop = !adv.combat && !adv.scene ? (L.shop || []).map((s) => ({ ...itemView(A, s.item, 0), price: s.price })) : [];

  return {
    id: adv.id, title: A.title, gold: adv.gold,
    location: { id: adv.location, name: L.name, region: L.region, danger: L.danger || 0, tagline: L.tagline || null, desc: locationDesc(adv, adv.location), scene: L.scene || adv.location, image: L.image || null, effect: L.effect || null, icon: icon(L.icon || adv.location, 'map'), music: L.music || null },
    ambience: ((A.ambience && A.ambience.when) || []).filter((x) => test(adv, x.when)).map((x) => x.value)[0] || (A.ambience && A.ambience.default) || 'clear',
    actions,
    shop,
    coach, coachPrice: COACH_PRICE,
    difficulty: adv.difficulty || 'normal',
    difficulties: Object.entries(DIFFICULTY).map(([id, d]) => ({ id, name: d.name, desc: d.desc })),
    stats: adv.stats || {},
    bestiary: bestiaryView(adv),
    exits: adv.combat ? [] : pathsFrom(adv, adv.location).map((p) => ({ to: p.to, name: A.locations[p.to].name, ok: p.ok, locked: p.ok ? null : p.locked, visited: !!adv.visited[p.to], danger: A.locations[p.to].danger || 0 })),
    scene,
    world: {
      nodes: [...known].map((id) => ({ id, name: A.locations[id].name, region: A.locations[id].region, icon: icon(A.locations[id].icon || id, 'map'), x: A.locations[id].x, y: A.locations[id].y, visited: !!adv.visited[id], here: id === adv.location, danger: A.locations[id].danger || 0, todo: hasNews(adv, id) })),
      size: A.map || { w: 100, h: 70 },
      edges: A.paths
        .filter((p) => known.has(p.a) && known.has(p.b) && (test(adv, p.when) || !p.hidden))
        .map((p) => ({ a: p.a, b: p.b, ok: test(adv, p.when) })),
    },
    party,
    inventory: Object.entries(adv.inventory).filter(([, n]) => n > 0).map(([id, n]) => itemView(A, id, n)),
    combat: adv.combat ? {
      canFlee: adv.combat.canFlee,
      bless: adv.combat.bless,
      monsters: adv.combat.monsters.map((m) => ({ id: m.id, key: m.key, name: m.name, hp: m.hp, maxHp: m.maxHp, ac: A.monsters[m.key].ac, icon: icon(A.monsters[m.key].icon || m.key, 'skull'), boss: (A.monsters[m.key].xp || 0) >= 200, status: statusList(m.status) })),
    } : null,
    myActions: me && adv.combat ? heroActions(adv, me) : null,
    journal: adv.journal,
    log: adv.log.slice(-90),
    ended: adv.ended,
    classes: Object.entries(CLASSES).map(([id, C]) => ({
      id, name: C.name, desc: C.desc, hp: C.hitDie + mod(C.abilities.con), ac: C.ac, weapon: C.weapon.name,
      learns: Object.entries(LEARN[id]).map(([lv, t]) => `Lv${lv} ${TALENTS[t].name}`),
    })),
  };
}

module.exports = {
  DIFFICULTY, list, exists, create, handle, view, syncSheets, GameError, CLASSES, TALENTS, _giveXp: giveXp, _maybeEvent: maybeEvent };
