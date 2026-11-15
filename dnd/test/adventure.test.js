'use strict';
const test = require('node:test');
const assert = require('node:assert');
const adventure = require('../adventure');

function newGame(heroes) {
  const room = { adventure: adventure.create('ashen-vale'), initiative: { list: [], current: null, round: 1 }, sheets: {} };
  for (const [id, name, cls] of heroes) adventure.handle(room, { id, name }, false, { t: 'adv:create', name, cls });
  return room;
}
const act = (room, id, msg) => { adventure.handle(room, { id, name: id }, false, msg); adventure.syncSheets(room); };
const v = (room, id) => adventure.view(room, id);

// Play out any fight: each hero attacks whatever is first.
function fight(room) {
  for (let i = 0; i < 400 && room.adventure.combat; i++) {
    const cur = room.initiative.list.find((e) => e.id === room.initiative.current);
    act(room, cur.owner, { t: 'adv:act', action: 'attack' });
  }
  assert.strictEqual(room.adventure.combat, null, 'fight should end');
}
function choose(room, id, labelPart) {
  const sc = v(room, id).scene;
  assert.ok(sc, `expected a scene when choosing "${labelPart}"`);
  const ch = sc.choices.find((c) => c.label.includes(labelPart));
  assert.ok(ch, `no choice "${labelPart}" in ${sc.title}: ${sc.choices.map((c) => c.label).join(' | ')}`);
  act(room, id, { t: 'adv:choose', index: ch.index });
}
function travel(room, id, to) {
  act(room, id, { t: 'adv:travel', to });
  fight(room); // random encounters
  assert.strictEqual(room.adventure.location, to);
}

test('the main quest can be finished (force route)', () => {
  const room = newGame([['p1', 'Brakka', 'fighter'], ['p2', 'Wren', 'cleric']]);
  // Make the heroes sturdy so random dice can't end the test early.
  for (const c of Object.values(room.adventure.party)) { c.maxHp = 500; c.hp = 500; }
  act(room, 'p1', { t: 'adv:do', kind: 'scene', id: 'elder' });
  choose(room, 'p1', 'find out what happened');
  assert.ok(room.adventure.flags['q-bell']);
  assert.strictEqual(room.adventure.journal[0].title, 'The Silent Bell');

  travel(room, 'p1', 'old-road');
  assert.throws(() => act(room, 'p1', { t: 'adv:travel', to: 'abbey' }), /sealed/);
  travel(room, 'p1', 'watchtower');
  act(room, 'p1', { t: 'adv:do', kind: 'scene', id: 'camp' });
  choose(room, 'p1', 'Attack');
  assert.ok(room.adventure.combat);
  assert.ok(v(room, 'p1').combat.monsters.some((m) => m.name === 'Redcap Vesh'));
  fight(room);
  assert.strictEqual(room.adventure.inventory['abbey-key'], 1);

  travel(room, 'p1', 'old-road');
  travel(room, 'p1', 'abbey');
  act(room, 'p2', { t: 'adv:do', kind: 'scene', id: 'courtyard' });
  choose(room, 'p2', 'Fight');
  fight(room);
  act(room, 'p2', { t: 'adv:do', kind: 'scene', id: 'tower' });
  choose(room, 'p2', 'Fight');
  assert.ok(!v(room, 'p2').myActions.some((a) => a.id === 'flee'), 'no fleeing the boss');
  fight(room);
  choose(room, 'p2', 'Ring the Cinder Bell');
  assert.strictEqual(room.adventure.ended.title, 'The Bell Sings Again');
  assert.ok(Object.values(room.adventure.party).every((c) => c.level >= 2), 'heroes should have levelled up');
  assert.ok(room.sheets.p1.name === 'Brakka' && room.sheets.p1.cls === 'Fighter');
});

test('the crypt route opens a hidden path', () => {
  const room = newGame([['p1', 'Sly', 'rogue']]);
  for (const c of Object.values(room.adventure.party)) { c.maxHp = 500; c.hp = 500; }
  room.adventure.flags['hermit-trail'] = true;
  travel(room, 'p1', 'old-road');
  travel(room, 'p1', 'greyfen');
  assert.ok(!v(room, 'p1').exits.some((e) => e.to === 'crypt'), 'crypt hidden at first');
  act(room, 'p1', { t: 'adv:do', kind: 'scene', id: 'crypt-find' });
  choose(room, 'p1', "Sable's map");
  travel(room, 'p1', 'crypt');
  act(room, 'p1', { t: 'adv:do', kind: 'scene', id: 'statue' });
  choose(room, 'p1', 'Pull the lever');
  travel(room, 'p1', 'abbey');
});

test('total defeat sends the party home with half their gold', () => {
  const room = newGame([['p1', 'Unlucky', 'wizard']]);
  room.adventure.gold = 40;
  room.adventure.location = 'old-road';
  room.adventure.flags['q-wolves'] = true;
  act(room, 'p1', { t: 'adv:do', kind: 'scene', id: 'wolf-den' });
  choose(room, 'p1', 'Attack');
  for (let i = 0; i < 200 && room.adventure.combat; i++) {
    room.adventure.party.p1.hp = Math.min(room.adventure.party.p1.hp, 1);
    act(room, 'p1', { t: 'adv:act', action: 'defend' });
  }
  assert.strictEqual(room.adventure.location, 'thornwick');
  assert.strictEqual(room.adventure.gold, 20);
  assert.strictEqual(room.adventure.party.p1.hp, room.adventure.party.p1.maxHp);
});

test('turn order is enforced and players cannot act out of turn', () => {
  const room = newGame([['a', 'A', 'fighter'], ['b', 'B', 'wizard']]);
  room.adventure.location = 'old-road';
  room.adventure.flags['q-wolves'] = true;
  act(room, 'a', { t: 'adv:do', kind: 'scene', id: 'wolf-den' });
  choose(room, 'a', 'Attack');
  const cur = room.initiative.list.find((e) => e.id === room.initiative.current);
  const other = cur.owner === 'a' ? 'b' : 'a';
  assert.throws(() => act(room, other, { t: 'adv:act', action: 'attack' }), /not your turn/);
  assert.throws(() => act(room, cur.owner, { t: 'adv:travel', to: 'thornwick' }), /Finish the fight/);
});

test('fuzz: thousands of random actions never crash or break invariants', () => {
  for (let game = 0; game < 25; game++) {
    const room = newGame([['a', 'A', 'fighter'], ['b', 'B', 'rogue'], ['c', 'C', 'wizard'], ['d', 'D', 'cleric']].slice(0, 1 + (game % 4)));
    const ids = Object.keys(room.adventure.party);
    for (let step = 0; step < 400; step++) {
      const id = ids[Math.floor(Math.random() * ids.length)];
      const view = v(room, id);
      let msg;
      if (view.combat) {
        const cur = room.initiative.list.find((e) => e.id === room.initiative.current);
        const acts = adventure.view(room, cur.owner).myActions.filter((a) => a.uses === undefined || a.uses > 0);
        const a = acts[Math.floor(Math.random() * acts.length)];
        const living = view.combat.monsters.filter((m) => m.hp > 0);
        msg = { t: 'adv:act', action: a.id, target: living[0] && living[0].id, ally: ids[Math.floor(Math.random() * ids.length)] };
        try { act(room, cur.owner, msg); } catch (e) {
          if (!(e instanceof adventure.GameError)) throw e;
          act(room, cur.owner, { t: 'adv:act', action: 'defend' }); // a rule said no; just defend
        }
      } else {
        const opts = [];
        if (view.scene) {
          for (const c of view.scene.choices) opts.push({ t: 'adv:choose', index: c.index });
          if (!view.scene.noLeave) opts.push({ t: 'adv:choose', index: -1 });
        } else {
          for (const a of view.actions) opts.push({ t: 'adv:do', kind: a.kind, id: a.id, item: a.item });
        }
        for (const e of view.exits) if (e.ok) opts.push({ t: 'adv:travel', to: e.to });
        for (const it of view.inventory) if (it.slot) opts.push({ t: 'adv:equip', item: it.id, hero: ids[Math.floor(Math.random() * ids.length)] });
        if (Math.random() < 0.05) opts.push({ t: 'adv:unequip', slot: 'armor', hero: id });
        msg = opts[Math.floor(Math.random() * opts.length)];
        if (Math.random() < 0.3) room.adventure.gold += 20; // let them afford things
        try { act(room, id, msg); } catch (e) {
          if (!(e instanceof adventure.GameError)) throw e;
        }
      }
      // invariants
      for (const c of Object.values(room.adventure.party)) {
        assert.ok(c.hp >= 0 && c.hp <= c.maxHp, `hp out of range: ${c.hp}/${c.maxHp}`);
        if (!room.adventure.combat) assert.ok(c.hp >= 1, 'nobody stays unconscious outside combat');
      }
      if (room.adventure.combat) {
        const cur = room.initiative.list.find((e) => e.id === room.initiative.current);
        assert.ok(cur && cur.owner && room.adventure.party[cur.owner].hp > 0, 'combat always waits on a living hero');
      }
      assert.ok(room.adventure.gold >= 0);
    }
  }
});

test('heroes learn talents as they level up', () => {
  const room = newGame([['w', 'Wiz', 'wizard'], ['f', 'Fig', 'fighter'], ['r', 'Rog', 'rogue'], ['c', 'Cle', 'cleric']]);
  adventure._giveXp(room.adventure, 6500);
  const v = adventure.view(room, 'w');
  const w = v.party.find((p) => p.id === 'w');
  assert.strictEqual(w.level, 5);
  assert.deepStrictEqual(w.talents.map((t) => t.id), ['burning-hands', 'sleep', 'asi', 'fireball']);
  assert.strictEqual(room.adventure.party.w.abilities.int, 18, 'level 4 training raises INT');
  assert.ok(room.adventure.log.some((e) => /Learned: Fireball/.test(e.text)));
  // In a fight, the new talents are on the menu.
  room.adventure.location = 'old-road';
  room.adventure.flags['q-wolves'] = true;
  act(room, 'w', { t: 'adv:do', kind: 'scene', id: 'wolf-den' });
  choose(room, 'w', 'Attack');
  const ids = Object.fromEntries(['w', 'f', 'r', 'c'].map((id) => [id, (adventure.view(room, id).myActions || []).map((a) => a.id)]));
  const cur = room.initiative.list.find((e) => e.id === room.initiative.current).owner;
  const acts = adventure.view(room, cur).myActions.map((a) => a.id);
  const expect = { w: 'fireball', f: 'action-surge', r: 'hide', c: 'mass-cure' }[cur];
  assert.ok(acts.includes(expect), `${cur} should have ${expect}: ${acts}`);
  void ids;
});

test('area spells, sleep and poison work in a fight', () => {
  const room = newGame([['w', 'Wiz', 'wizard']]);
  adventure._giveXp(room.adventure, 2700); // level 4
  const c = room.adventure.party.w;
  c.maxHp = c.hp = 999;
  room.adventure.location = 'old-road';
  room.adventure.flags['q-wolves'] = true;
  act(room, 'w', { t: 'adv:do', kind: 'scene', id: 'wolf-den' });
  choose(room, 'w', 'Attack');
  act(room, 'w', { t: 'adv:act', action: 'burning-hands' });
  assert.ok(room.adventure.log.some((e) => /casts Burning Hands/.test(e.text)));
  if (room.adventure.combat) {
    act(room, 'w', { t: 'adv:act', action: 'sleep' });
    assert.ok(room.adventure.log.some((e) => /casts Sleep/.test(e.text)));
  }
  fight(room);
});

test('equipment changes stats and can be swapped', () => {
  const room = newGame([['f', 'Fig', 'fighter']]);
  const A = room.adventure;
  const before = adventure.view(room, 'f').party[0];
  A.inventory['chain-shirt'] = 1;
  A.inventory['vigor-ring'] = 1;
  A.inventory['steel-sword'] = 1;
  act(room, 'f', { t: 'adv:equip', item: 'chain-shirt' });
  act(room, 'f', { t: 'adv:equip', item: 'vigor-ring' });
  act(room, 'f', { t: 'adv:equip', item: 'steel-sword' });
  const after = adventure.view(room, 'f').party[0];
  assert.strictEqual(after.ac, before.ac + 2);
  assert.strictEqual(after.maxHp, before.maxHp + 6);
  assert.strictEqual(after.weapon, 'Steel longsword');
  assert.strictEqual(A.inventory['chain-shirt'], 0);
  act(room, 'f', { t: 'adv:unequip', slot: 'trinket' });
  assert.strictEqual(adventure.view(room, 'f').party[0].maxHp, before.maxHp);
  assert.strictEqual(A.inventory['vigor-ring'], 1);
  A.inventory['ashwood-staff'] = 1;
  assert.throws(() => act(room, 'f', { t: 'adv:equip', item: 'ashwood-staff' }), /Only a Wizard or Cleric/);
});

test('consumables: potions, elixirs and fire flasks', () => {
  const room = newGame([['w', 'Wiz', 'wizard']]);
  const A = room.adventure;
  A.party.w.uses.slots = 0;
  A.inventory.elixir = 1;
  act(room, 'w', { t: 'adv:use', item: 'elixir', ally: 'w' });
  assert.strictEqual(A.party.w.uses.slots, 1);
  A.inventory['fire-flask'] = 1;
  assert.throws(() => act(room, 'w', { t: 'adv:use', item: 'fire-flask' }), /Save that for a fight/);
});

test('travel events appear and resolve', () => {
  const room = newGame([['p', 'P', 'rogue']]);
  room.adventure.location = 'old-road';
  for (let i = 0; i < 20 && !room.adventure.scene; i++) adventure._maybeEvent(room, true);
  assert.ok(room.adventure.scene && room.adventure.scene.startsWith('ev-'), 'an event scene opened');
  const sc = v(room, 'p').scene;
  assert.ok(sc.choices.length > 0);
});

test('the boss summons help and uses Cinder Burst', () => {
  const room = newGame([['a', 'A', 'fighter'], ['b', 'B', 'cleric']]);
  for (const c of Object.values(room.adventure.party)) { c.maxHp = 900; c.hp = 900; }
  room.adventure.location = 'abbey';
  room.adventure.flags['courtyard-clear'] = true;
  act(room, 'a', { t: 'adv:do', kind: 'scene', id: 'tower' });
  choose(room, 'a', 'Fight');
  const boss = room.adventure.combat.monsters.find((m) => m.key === 'priest');
  boss.hp = boss.maxHp = 240; // long enough to see her tricks
  fight(room);
  assert.ok(room.adventure.log.some((e) => /Cinder Burst/.test(e.text)), 'burst happened');
  assert.ok(room.adventure.log.some((e) => /coming next turn/.test(e.text)), 'burst was telegraphed');
  assert.ok(room.adventure.log.some((e) => /shrieks for her Choir/.test(e.text)), 'summon happened');
});
