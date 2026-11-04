'use strict';
// Adventure engine: the game acts as the Dungeon Master.
// Runs exploration (locations, scenes, skill checks), the party, and automated combat.
// Adventure content lives in ./adventures/*.js (see the comments in ashen-vale.js).
const crypto = require('crypto');
const { roll } = require('./dice');

const ADVENTURES = {};
for (const a of [require('./adventures/ashen-vale')]) ADVENTURES[a.id] = a;

const LOG_LIMIT = 150;
const XP_LEVELS = [0, 300, 900, 2700, 6500];
const MAX_LEVEL = 5;

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
    name: 'Fighter', hitDie: 10, ac: 16, saves: ['str', 'con'],
    abilities: { str: 16, dex: 12, con: 15, int: 8, wis: 12, cha: 10 },
    skills: ['athletics', 'intimidation', 'perception', 'survival'],
    weapon: { name: 'Longsword', ability: 'str', dmg: '1d8' },
    desc: 'Tough and well armored. Hits hard and can catch a second wind to heal mid-fight.',
  },
  rogue: {
    name: 'Rogue', hitDie: 8, ac: 14, saves: ['dex', 'int'],
    abilities: { str: 10, dex: 16, con: 14, int: 12, wis: 10, cha: 13 },
    skills: ['stealth', 'sleight', 'acrobatics', 'deception', 'investigation', 'persuasion'],
    weapon: { name: 'Shortsword', ability: 'dex', dmg: '1d6' },
    desc: 'Sneaky and skilled. Adds sneak attack damage, and is the best at locks, lies and lurking.',
  },
  wizard: {
    name: 'Wizard', hitDie: 6, ac: 12, saves: ['int', 'wis'],
    abilities: { str: 8, dex: 14, con: 13, int: 16, wis: 12, cha: 10 },
    skills: ['arcana', 'history', 'investigation', 'religion'],
    weapon: { name: 'Quarterstaff', ability: 'str', dmg: '1d6' },
    desc: 'Fragile but powerful. Fire Bolt at will, and Magic Missile never misses.',
  },
  cleric: {
    name: 'Cleric', hitDie: 8, ac: 16, saves: ['wis', 'cha'],
    abilities: { str: 14, dex: 10, con: 14, int: 10, wis: 16, cha: 12 },
    skills: ['religion', 'insight', 'medicine', 'persuasion'],
    weapon: { name: 'Mace', ability: 'str', dmg: '1d6' },
    desc: 'Armored healer. Cure Wounds can bring a fallen friend back; Sacred Flame burns the wicked.',
  },
};

const rid = () => crypto.randomBytes(5).toString('base64url');
const mod = (score) => Math.floor((score - 10) / 2);
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
const dice = (expr) => roll(expr).total;
const d20 = () => crypto.randomInt(1, 21);
const pick = (list) => list[crypto.randomInt(list.length)];
const content = (adv) => ADVENTURES[adv.id];
const str = (v, max) => String(v ?? '').slice(0, max);

class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

function list() {
  return Object.values(ADVENTURES).map((a) => ({ id: a.id, title: a.title, blurb: a.blurb }));
}
const exists = (id) => !!ADVENTURES[id];

function create(id) {
  const A = ADVENTURES[id];
  if (!A) fail('Unknown adventure.');
  const adv = {
    id, location: A.start, prev: null, scene: null,
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
  const v = c.startsWith('item:') ? (adv.inventory[c.slice(5)] || 0) > 0 : !!adv.flags[c];
  return neg ? !v : v;
}

const fill = (text, actor) => String(text).replace(/\{name\}/g, actor ? actor.name : 'The party');
const itemName = (A, id) => (A.items[id] && A.items[id].name) || id;
const prof = (c) => (c.level >= 5 ? 3 : 2);
const fullUses = (cls, level) => ({
  secondWind: cls === 'fighter' ? 1 : 0,
  slots: cls === 'wizard' || cls === 'cleric' ? Math.min(4, level + 1) : 0,
});

function acOf(adv, c) {
  const A = content(adv);
  let bonus = 0;
  for (const [id, n] of Object.entries(adv.inventory)) if (n > 0 && A.items[id] && A.items[id].acBonus) bonus += A.items[id].acBonus;
  return CLASSES[c.cls].ac + bonus;
}

function skillBonus(c, skill) {
  const b = mod(c.abilities[SKILLS[skill]]);
  return CLASSES[c.cls].skills.includes(skill) ? b + prof(c) : b;
}

function checkBonus(c, check) {
  if (check.skill) return skillBonus(c, check.skill);
  let b = mod(c.abilities[check.ability]);
  if (check.save && CLASSES[c.cls].saves.includes(check.ability)) b += prof(c);
  return b;
}

function checkLabel(check) {
  if (check.skill) return SKILL_NAMES[check.skill] || check.skill[0].toUpperCase() + check.skill.slice(1);
  return `${ABILITY_NAMES[check.ability]}${check.save ? ' save' : ''}`;
}

function heroes(adv) { return Object.entries(adv.party).map(([id, c]) => ({ id, c })); }
const alive = (adv) => heroes(adv).filter((h) => h.c.hp > 0);

// ---------- characters ----------
function makeHero(name, cls) {
  const C = CLASSES[cls];
  const hp = C.hitDie + mod(C.abilities.con);
  return { name, cls, level: 1, xp: 0, abilities: { ...C.abilities }, maxHp: hp, hp, uses: fullUses(cls, 1), defending: false };
}

function giveXp(adv, amount) {
  if (!amount) return;
  const list = heroes(adv);
  if (!list.length) return;
  log(adv, 'loot', `Each hero gains ${amount} XP.`);
  for (const { c } of list) {
    c.xp += amount;
    while (c.level < MAX_LEVEL && c.xp >= XP_LEVELS[c.level]) {
      c.level += 1;
      const C = CLASSES[c.cls];
      const gain = Math.max(1, Math.floor(C.hitDie / 2) + 1 + mod(c.abilities.con));
      c.maxHp += gain;
      c.hp += gain;
      const uses = fullUses(c.cls, c.level);
      c.uses.slots += uses.slots - fullUses(c.cls, c.level - 1).slots;
      log(adv, 'level', `${c.name} reaches level ${c.level}! (+${gain} max HP)`);
    }
  }
}

function restAll(adv) {
  for (const { c } of heroes(adv)) {
    c.hp = c.maxHp;
    c.uses = fullUses(c.cls, c.level);
    c.defending = false;
  }
}

function setQuest(adv, q) {
  let entry = adv.journal.find((x) => x.id === q.id);
  if (!entry) {
    entry = { id: q.id, title: q.title || q.id, text: '', done: false };
    adv.journal.push(entry);
    log(adv, 'quest', `New quest: ${entry.title}`);
  } else if (q.done && !entry.done) {
    log(adv, 'quest', `Quest complete: ${entry.title}`);
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
  log(adv, 'place', locationDesc(adv, id), { title: L.name });
}

function moveTo(room, to, encounters) {
  const adv = room.adventure;
  adv.prev = adv.location;
  adv.location = to;
  adv.visited[to] = true;
  adv.scene = null;
  logPlace(adv, to);
  if (encounters) maybeEncounter(room);
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

// ---------- scenes & outcomes ----------
function enterScene(adv, id) {
  const S = content(adv).scenes[id];
  if (!S) fail(`Missing scene "${id}".`);
  adv.scene = id;
  adv.flags[`seen:${id}`] = true;
  log(adv, 'story', S.text, { title: S.title });
}

function apply(room, actor, o) {
  const adv = room.adventure;
  const A = content(adv);
  if (!o) { adv.scene = null; return; }
  if (o.text) log(adv, 'story', fill(o.text, actor));
  for (const f of [].concat(o.set || [])) adv.flags[f] = true;
  for (const f of [].concat(o.unset || [])) delete adv.flags[f];
  if (o.gold) {
    adv.gold = Math.max(0, adv.gold + o.gold);
    log(adv, 'loot', o.gold > 0 ? `+${o.gold} gold` : `${o.gold} gold`);
  }
  for (const [id, n] of Object.entries(o.give || {})) {
    adv.inventory[id] = (adv.inventory[id] || 0) + n;
    log(adv, 'loot', `Found: ${itemName(A, id)}${n > 1 ? ` ×${n}` : ''}`);
  }
  for (const [id, n] of Object.entries(o.take || {})) {
    adv.inventory[id] = Math.max(0, (adv.inventory[id] || 0) - n);
  }
  if (o.damage && actor) {
    const dmg = dice(o.damage);
    actor.hp = Math.max(1, actor.hp - dmg); // story damage hurts, but never knocks anyone out
    log(adv, 'hurt', `${actor.name} takes ${dmg} damage.`);
  }
  if (o.healAll) restAll(adv);
  if (o.quest) setQuest(adv, o.quest);
  if (o.xp) giveXp(adv, o.xp);
  if (o.end) {
    adv.ended = { title: o.end.title, text: o.end.text, at: Date.now() };
    log(adv, 'ending', o.end.text, { title: o.end.title });
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
  const scale = n === 1 ? 0.6 : n === 2 ? 0.9 : 0.9 + (n - 2) * 0.2;
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
    const M = A.monsters[key];
    if (!M) fail(`Unknown monster "${key}".`);
    seen[key] = (seen[key] || 0) + 1;
    const hp = Math.max(1, Math.round(M.hp * scale));
    return { id: rid(), key, name: counts[key] > 1 ? `${M.name} ${seen[key]}` : M.name, hp, maxHp: hp };
  });
  adv.combat = { monsters, win: opts.win || null, canFlee: opts.flee !== false, atkAdj: n === 1 ? -1 : 0 };
  log(adv, 'combat', `${opts.text ? `${opts.text} ` : ''}Combat begins: ${monsters.map((m) => m.name).join(', ')}.`, { title: 'Combat' });

  const order = [];
  for (const { id, c } of alive(adv)) {
    const value = d20() + mod(c.abilities.dex);
    order.push({ id: rid(), name: c.name, value, owner: id });
  }
  for (const m of monsters) order.push({ id: rid(), name: m.name, value: d20() + (A.monsters[m.key].init || 0), owner: null, ref: m.id });
  order.sort((a, b) => b.value - a.value || (a.owner ? -1 : 1));
  room.initiative = { list: order, current: null, round: 1 };
  log(adv, 'roll', `Initiative: ${order.map((e) => `${e.name} ${e.value}`).join(', ')}`);
  runFrom(room, 0);
}

function critDice(expr) {
  return expr.replace(/(\d*)d(\d+)/g, (m, c, s) => `${(Number(c) || 1) * 2}d${s}`);
}

function monsterTurn(room, m) {
  const adv = room.adventure;
  const M = content(adv).monsters[m.key];
  for (let i = 0; i < (M.attacks || 1); i++) {
    const targets = alive(adv);
    if (!targets.length) return;
    const { c } = pick(targets);
    const r1 = d20();
    const nat = c.defending ? Math.min(r1, d20()) : r1;
    const total = nat + M.atk + (adv.combat.atkAdj || 0);
    const ac = acOf(adv, c);
    if (nat === 20 || (nat !== 1 && total >= ac)) {
      const dmg = dice(nat === 20 ? critDice(M.dmg) : M.dmg);
      c.hp = Math.max(0, c.hp - dmg);
      log(adv, 'hurt', `${m.name} ${M.verb || 'attacks'} ${c.name}: ${total} vs AC ${ac}. Hit for ${dmg}${nat === 20 ? ' (critical!)' : ''}.`);
      if (c.hp === 0) log(adv, 'hurt', `${c.name} falls unconscious!`);
    } else {
      log(adv, 'combat', `${m.name} ${M.verb || 'attacks'} ${c.name}: ${total} vs AC ${ac}. Miss${c.defending ? ' (defending)' : ''}.`);
    }
  }
}

function checkEnd(room) {
  const adv = room.adventure;
  if (!adv.combat) return true;
  if (adv.combat.monsters.every((m) => m.hp <= 0)) { endCombat(room, 'win'); return true; }
  if (!alive(adv).length) { endCombat(room, 'lose'); return true; }
  return false;
}

// Advance through the initiative order, running monster turns, until a hero is up.
function runFrom(room, index) {
  const adv = room.adventure;
  const init = room.initiative;
  let i = index;
  for (let guard = 0; guard < 500; guard++) {
    if (checkEnd(room)) return;
    if (i >= init.list.length) { i = 0; init.round += 1; }
    const e = init.list[i];
    init.current = e.id;
    if (e.owner) {
      const c = adv.party[e.owner];
      if (c && c.hp > 0) {
        c.defending = false;
        return; // wait for the player
      }
    } else {
      const m = adv.combat.monsters.find((x) => x.id === e.ref);
      if (m && m.hp > 0) monsterTurn(room, m);
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
  for (const { c: h } of heroes(adv)) h.defending = false;

  if (how === 'lose') {
    log(adv, 'ending', A.defeat || 'The party falls...', { title: 'Defeat' });
    adv.gold = Math.floor(adv.gold / 2);
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
  log(adv, 'combat', 'Victory!', { title: 'Victory' });
  giveXp(adv, c.monsters.reduce((sum, m) => sum + (A.monsters[m.key].xp || 0), 0));
  if (c.win) apply(room, null, c.win);
}

function heroActions(adv, c) {
  const C = CLASSES[c.cls];
  const W = C.weapon;
  const abil = c.cls === 'rogue' ? 'dex' : W.ability;
  const atk = prof(c) + mod(c.abilities[abil]);
  const out = [{ id: 'attack', label: `Attack with ${W.name}`, desc: `${signed(atk)} to hit, ${W.dmg}${signed(mod(c.abilities[abil]))} damage${c.cls === 'rogue' ? ` + ${Math.ceil(c.level / 2)}d6 sneak attack` : ''}`, target: 'enemy' }];
  if (c.cls === 'fighter') out.push({ id: 'second-wind', label: 'Second Wind', desc: `Heal yourself 1d10+${c.level}`, target: 'none', uses: c.uses.secondWind });
  if (c.cls === 'wizard') {
    out.push({ id: 'fire-bolt', label: 'Fire Bolt', desc: `${signed(prof(c) + mod(c.abilities.int))} to hit, ${c.level >= 5 ? '2d10' : '1d10'} fire damage`, target: 'enemy' });
    out.push({ id: 'magic-missile', label: 'Magic Missile', desc: '3 darts of 1d4+1. Never misses.', target: 'enemy', uses: c.uses.slots });
  }
  if (c.cls === 'cleric') {
    out.push({ id: 'sacred-flame', label: 'Sacred Flame', desc: `Target must beat DC ${8 + prof(c) + mod(c.abilities.wis)} or take ${c.level >= 5 ? '2d8' : '1d8'} radiant damage`, target: 'enemy' });
    out.push({ id: 'cure-wounds', label: 'Cure Wounds', desc: `Heal an ally 1d8+${mod(c.abilities.wis)}. Revives the fallen.`, target: 'ally', uses: c.uses.slots });
  }
  out.push({ id: 'potion', label: 'Use a potion', desc: 'Heal an ally 2d4+2', target: 'ally', uses: adv.inventory.potion || 0 });
  out.push({ id: 'defend', label: 'Defend', desc: 'Enemies attack you with disadvantage until your next turn', target: 'none' });
  if (adv.combat && adv.combat.canFlee) out.push({ id: 'flee', label: 'Run away', desc: 'Acrobatics DC 12 for the whole party to escape', target: 'none' });
  return out;
}

function attackRoll(adv, c, m, bonus, dmgExpr, verb) {
  const M = content(adv).monsters[m.key];
  const nat = d20();
  const total = nat + bonus;
  if (nat === 20 || (nat !== 1 && total >= M.ac)) {
    const dmg = dice(nat === 20 ? critDice(dmgExpr) : dmgExpr);
    m.hp = Math.max(0, m.hp - dmg);
    log(adv, 'hit', `${c.name} ${verb} ${m.name}: ${total} vs AC ${M.ac}. Hit for ${dmg}${nat === 20 ? ' (critical!)' : ''}.`);
    if (m.hp === 0) log(adv, 'hit', `${m.name} is defeated!`);
  } else {
    log(adv, 'combat', `${c.name} ${verb} ${m.name}: ${total} vs AC ${M.ac}. Miss${nat === 1 ? ' (natural 1)' : ''}.`);
  }
}

function heal(adv, healer, target, expr, how) {
  const amount = Math.max(1, dice(expr));
  const wasDown = target.hp <= 0;
  target.hp = Math.min(target.maxHp, target.hp + amount);
  log(adv, 'heal', `${healer.name} ${how}${target === healer ? '' : ` on ${target.name}`}: +${amount} HP${wasDown ? `. ${target.name} is back on their feet!` : '.'}`);
}

function combatAction(room, meId, msg) {
  const adv = room.adventure;
  const combat = adv.combat;
  const init = room.initiative;
  const idx = init.list.findIndex((e) => e.id === init.current);
  const entry = init.list[idx];
  if (!entry || entry.owner !== meId) fail("It's not your turn.");
  const c = adv.party[meId];
  const action = heroActions(adv, c).find((a) => a.id === msg.action);
  if (!action) fail('You can\'t do that.');
  if (action.uses !== undefined && action.uses <= 0) fail('None left. Rest to recover.');

  const living = combat.monsters.filter((m) => m.hp > 0);
  const target = living.find((m) => m.id === msg.target) || living[0];
  const ally = (msg.ally && adv.party[msg.ally]) || c;
  const W = CLASSES[c.cls].weapon;

  switch (action.id) {
    case 'attack': {
      const abil = c.cls === 'rogue' ? 'dex' : W.ability;
      const m = mod(c.abilities[abil]);
      const sneak = c.cls === 'rogue' ? `+${Math.ceil(c.level / 2)}d6` : '';
      attackRoll(adv, c, target, prof(c) + m, `${W.dmg}${signed(m)}${sneak}`, `strikes with ${W.name} at`);
      break;
    }
    case 'second-wind':
      c.uses.secondWind -= 1;
      heal(adv, c, c, `1d10+${c.level}`, 'catches a second wind');
      break;
    case 'fire-bolt':
      attackRoll(adv, c, target, prof(c) + mod(c.abilities.int), c.level >= 5 ? '2d10' : '1d10', 'hurls a Fire Bolt at');
      break;
    case 'magic-missile': {
      c.uses.slots -= 1;
      const dmg = dice('1d4+1') + dice('1d4+1') + dice('1d4+1');
      target.hp = Math.max(0, target.hp - dmg);
      log(adv, 'hit', `${c.name} casts Magic Missile at ${target.name}: ${dmg} damage.`);
      if (target.hp === 0) log(adv, 'hit', `${target.name} is defeated!`);
      break;
    }
    case 'sacred-flame': {
      const M = content(adv).monsters[target.key];
      const dc = 8 + prof(c) + mod(c.abilities.wis);
      const save = d20() + (M.save || 0);
      if (save >= dc) {
        log(adv, 'combat', `${c.name} calls down Sacred Flame on ${target.name}: it saves (${save} vs DC ${dc}).`);
      } else {
        const dmg = dice(c.level >= 5 ? '2d8' : '1d8');
        target.hp = Math.max(0, target.hp - dmg);
        log(adv, 'hit', `${c.name} calls down Sacred Flame on ${target.name}: ${save} vs DC ${dc}. ${dmg} radiant damage.`);
        if (target.hp === 0) log(adv, 'hit', `${target.name} is defeated!`);
      }
      break;
    }
    case 'cure-wounds':
      c.uses.slots -= 1;
      heal(adv, c, ally, `1d8+${Math.max(0, mod(c.abilities.wis))}`, 'casts Cure Wounds');
      break;
    case 'potion':
      adv.inventory.potion -= 1;
      heal(adv, c, ally, content(adv).items.potion.heal, 'uses a healing potion');
      break;
    case 'defend':
      c.defending = true;
      log(adv, 'combat', `${c.name} takes a defensive stance.`);
      break;
    case 'flee': {
      const bonus = skillBonus(c, 'acrobatics');
      const total = d20() + bonus;
      if (total >= 12) {
        log(adv, 'roll', `${c.name} looks for an escape: Acrobatics ${total} vs DC 12. Success!`);
        endCombat(room, 'fled');
        return;
      }
      log(adv, 'roll', `${c.name} looks for an escape: Acrobatics ${total} vs DC 12. No way out!`);
      break;
    }
    default:
      fail('Unknown action.');
  }
  runFrom(room, idx + 1);
}

// ---------- player messages ----------
function handle(room, me, isHost, msg) {
  const adv = room.adventure;
  const A = content(adv);

  if (msg.t === 'adv:reset') {
    if (!isHost) fail('Only the host can restart the adventure.');
    const fresh = create(adv.id);
    for (const [id, c] of Object.entries(adv.party)) fresh.party[id] = makeHero(c.name, c.cls);
    room.adventure = fresh;
    room.initiative = { list: [], current: null, round: 1 };
    return;
  }

  if (msg.t === 'adv:create') {
    if (adv.combat) fail('Wait until the fight is over.');
    const cls = CLASSES[msg.cls] ? msg.cls : null;
    if (!cls) fail('Pick a class.');
    const name = str(msg.name, 30).trim() || me.name;
    const existed = !!adv.party[me.id];
    if (!existed && Object.keys(adv.party).length >= 8) fail('The party is full (8 heroes).');
    const hero = makeHero(name, cls);
    // Late joiners catch up to the party's level.
    const top = Math.max(0, ...Object.values(adv.party).map((c) => c.xp));
    adv.party[me.id] = hero;
    if (top > 0) { const before = hero.xp; hero.xp = 0; giveXpTo(adv, hero, top - before); }
    log(adv, 'party', `${name} the ${CLASSES[cls].name} ${existed ? 'is reborn' : 'joins the party'}.`);
    return;
  }

  const c = adv.party[me.id];
  if (!c) fail('Create your hero first.');

  if (msg.t === 'adv:act') {
    if (!adv.combat) fail('There is nothing to fight.');
    combatAction(room, me.id, msg);
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
      if (msg.kind === 'inn') {
        if (!L.inn) fail('There is no inn here.');
        if (adv.gold < L.inn.price) fail(`A night at ${L.inn.name} costs ${L.inn.price} gold.`);
        adv.gold -= L.inn.price;
        restAll(adv);
        adv.scene = null;
        log(adv, 'heal', `The party rests at ${L.inn.name} (${L.inn.price} gold). Everyone wakes fully healed, with spells and abilities restored.`);
        return;
      }
      if (msg.kind === 'buy') {
        const offer = (L.shop || []).find((s) => s.item === msg.item);
        if (!offer) fail('Nobody here sells that.');
        if (adv.gold < offer.price) fail(`That costs ${offer.price} gold.`);
        adv.gold -= offer.price;
        adv.inventory[offer.item] = (adv.inventory[offer.item] || 0) + 1;
        log(adv, 'loot', `Bought ${itemName(A, offer.item)} for ${offer.price} gold.`);
        return;
      }
      if (msg.kind === 'camp') {
        if (L.inn) fail('Why camp? There\'s an inn right here.');
        adv.scene = null;
        for (const { c: h } of heroes(adv)) {
          h.hp = Math.min(h.maxHp, h.hp + Math.ceil(h.maxHp / 2));
          h.uses.secondWind = fullUses(h.cls, h.level).secondWind;
        }
        log(adv, 'heal', 'The party makes camp and rests for an hour. Everyone recovers half their hit points. (Spells only come back at an inn.)');
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
        const bonus = checkBonus(c, choice.check);
        const nat = d20();
        const total = nat + bonus;
        const ok = total >= choice.check.dc;
        log(adv, 'roll', `${c.name} rolls ${checkLabel(choice.check)}: ${nat} ${signed(bonus)} = ${total} vs DC ${choice.check.dc}. ${ok ? 'Success!' : 'Failure.'}`, { ok });
        apply(room, c, ok ? choice.success : choice.failure);
      } else {
        apply(room, c, choice);
      }
      return;
    }

    case 'adv:use': {
      if (msg.item !== 'potion' || !(adv.inventory.potion > 0)) fail('You don\'t have that.');
      const target = (msg.ally && adv.party[msg.ally]) || c;
      if (target.hp >= target.maxHp) fail(`${target.name} is already at full health.`);
      adv.inventory.potion -= 1;
      heal(adv, c, target, A.items.potion.heal, 'uses a healing potion');
      return;
    }

    default:
      fail('Unknown action.');
  }
}

function giveXpTo(adv, hero, amount) {
  // Level a single late-joining hero up silently to match the party.
  hero.xp += amount;
  while (hero.level < MAX_LEVEL && hero.xp >= XP_LEVELS[hero.level]) {
    hero.level += 1;
    const gain = Math.max(1, Math.floor(CLASSES[hero.cls].hitDie / 2) + 1 + mod(hero.abilities.con));
    hero.maxHp += gain;
    hero.hp = hero.maxHp;
    hero.uses = fullUses(hero.cls, hero.level);
  }
}

// Mirror heroes onto the regular character sheets so the Character tab shows them.
function syncSheets(room) {
  const adv = room.adventure;
  const A = content(adv);
  const inv = Object.entries(adv.inventory).filter(([, n]) => n > 0).map(([id, n]) => `${itemName(A, id)}${n > 1 ? ` ×${n}` : ''}`);
  for (const [id, c] of Object.entries(adv.party)) {
    const C = CLASSES[c.cls];
    const prev = room.sheets[id] || {};
    room.sheets[id] = {
      ...prev,
      name: c.name, cls: C.name, race: prev.race || '', background: prev.background || '',
      level: c.level, hp: c.hp, maxHp: c.maxHp, tempHp: 0, ac: acOf(adv, c), speed: 30, prof: prof(c), initBonus: 0,
      ...c.abilities,
      saveProf: Object.fromEntries(Object.keys(ABILITY_NAMES).map((a) => [a, C.saves.includes(a)])),
      inventory: [`Gold: ${adv.gold} (shared)`, ...inv].join('\n'),
      notes: `${C.desc}\nWeapon: ${C.weapon.name} (${C.weapon.dmg})\nSkills: ${C.skills.map((s) => SKILL_NAMES[s] || s).join(', ')}\nXP: ${c.xp}${c.level < MAX_LEVEL ? ` / ${XP_LEVELS[c.level]}` : ''}`,
    };
  }
}

// ---------- what the browser sees ----------
function view(room, meId) {
  const adv = room.adventure;
  const A = content(adv);
  const L = A.locations[adv.location];
  const me = adv.party[meId];
  const known = knownLocations(adv);

  const party = Object.entries(adv.party).map(([id, c]) => ({
    id, name: c.name, cls: c.cls, clsName: CLASSES[c.cls].name, level: c.level,
    xp: c.xp, nextXp: c.level < MAX_LEVEL ? XP_LEVELS[c.level] : null,
    hp: c.hp, maxHp: c.maxHp, ac: acOf(adv, c), defending: c.defending, uses: c.uses,
  }));

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
          check: ch.check ? { label: checkLabel(ch.check), dc: ch.check.dc, bonus: me ? checkBonus(me, ch.check) : null } : null,
        })),
    };
  }

  const actions = [];
  if (!adv.combat && !adv.scene) {
    for (const a of L.actions || []) if (test(adv, a.when)) actions.push({ kind: 'scene', id: a.scene, label: a.label, cost: a.cost || 0 });
    if (L.inn) actions.push({ kind: 'inn', label: `Rest at ${L.inn.name}`, cost: L.inn.price });
    for (const s of L.shop || []) actions.push({ kind: 'buy', item: s.item, label: `Buy a ${itemName(A, s.item).toLowerCase()}`, cost: s.price });
    if (!L.inn) actions.push({ kind: 'camp', label: L.safe ? 'Rest for an hour' : 'Make camp (risky)', cost: 0 });
  }

  return {
    id: adv.id, title: A.title, gold: adv.gold,
    location: { id: adv.location, name: L.name, region: L.region, desc: locationDesc(adv, adv.location) },
    actions,
    exits: adv.combat ? [] : pathsFrom(adv, adv.location).map((p) => ({ to: p.to, name: A.locations[p.to].name, ok: p.ok, locked: p.ok ? null : p.locked, visited: !!adv.visited[p.to] })),
    scene,
    world: {
      nodes: [...known].map((id) => ({ id, name: A.locations[id].name, region: A.locations[id].region, x: A.locations[id].x, y: A.locations[id].y, visited: !!adv.visited[id], here: id === adv.location })),
      edges: A.paths
        .filter((p) => known.has(p.a) && known.has(p.b) && (test(adv, p.when) || !p.hidden))
        .map((p) => ({ a: p.a, b: p.b, ok: test(adv, p.when) })),
    },
    party,
    inventory: Object.entries(adv.inventory).filter(([, n]) => n > 0).map(([id, n]) => ({ id, n, name: itemName(A, id), desc: (A.items[id] && A.items[id].desc) || '' })),
    combat: adv.combat ? {
      canFlee: adv.combat.canFlee,
      monsters: adv.combat.monsters.map((m) => ({ id: m.id, name: m.name, hp: m.hp, maxHp: m.maxHp, ac: A.monsters[m.key].ac })),
    } : null,
    myActions: me && adv.combat ? heroActions(adv, me) : null,
    journal: adv.journal,
    log: adv.log.slice(-90),
    ended: adv.ended,
    classes: Object.entries(CLASSES).map(([id, C]) => ({ id, name: C.name, desc: C.desc, hp: C.hitDie + mod(C.abilities.con), ac: C.ac, weapon: C.weapon.name })),
  };
}

module.exports = { list, exists, create, handle, view, syncSheets, GameError, CLASSES, _giveXp: giveXp };
