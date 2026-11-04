// Adventure mode UI: scene banner, story log, choices, world map, journal, party and combat.
// All game rules run on the server; this file only draws the state, plays effects, and sends choices.
(() => {
  'use strict';
  const TT = window.TT;
  const FX = window.FX;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = TT.el;
  const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

  const CLASS_COLORS = { fighter: '#b8443a', rogue: '#4f7d4a', wizard: '#4366a8', cleric: '#b8913a' };
  const ACTION_ICONS = { 'second-wind': 'second-wind', 'fire-bolt': 'fire-bolt', 'magic-missile': 'magic-missile', 'sacred-flame': 'sacred-flame', 'cure-wounds': 'cure-wounds', potion: 'potion', defend: 'defend', flee: 'flee' };

  let tab = 'story';
  let targetId = null; // chosen monster
  let pendingAlly = null; // action waiting for an ally to be picked
  let dismissedEnd = null;
  let createCls = 'fighter';
  let draftName = '';
  let lastLogId = '';
  let nowKey = '';
  let sceneKey = '';
  let weather = null;
  const seenLog = new Set();
  let primedRoom = null;

  // ---------- small builders ----------
  function button(label, cls, onClick) {
    const b = el('button', cls || 'btn');
    if (typeof label === 'string') b.textContent = label;
    else b.append(...label.filter(Boolean));
    b.type = 'button';
    if (onClick) b.onclick = onClick;
    return b;
  }
  function icon(name, cls = '') {
    const i = el('span', `ico ${cls}`);
    i.style.setProperty('--i', `url(/art/icons/${name}.svg)`);
    i.setAttribute('aria-hidden', 'true');
    return i;
  }
  function hpBar(hp, max) {
    const pct = max ? Math.max(0, Math.min(100, (hp / max) * 100)) : 0;
    const bar = el('div', 'hpbar');
    const fill = el('div', `fill ${pct > 50 ? 'ok' : pct > 25 ? 'mid' : 'low'}`);
    fill.style.width = `${pct}%`;
    bar.append(fill);
    return bar;
  }
  // A hero's picture: their uploaded portrait, or a medallion with their class icon.
  function portrait(heroId, cls, size = '') {
    const url = TT.S.portraits && TT.S.portraits[heroId];
    const box = el('div', `portrait ${size}`);
    if (url) {
      const img = el('img');
      img.src = url;
      img.alt = '';
      box.append(img);
    } else {
      box.classList.add('medal');
      box.style.setProperty('--c', CLASS_COLORS[cls] || '#6b5a48');
      box.append(icon(cls || 'skull'));
    }
    return box;
  }
  const currentEntry = () => {
    const init = TT.S.initiative;
    return init.list.find((e) => e.id === init.current) || null;
  };

  // ---------- tabs & sound toggle ----------
  $$('[data-adv-tab]').forEach((b) => {
    b.onclick = () => {
      tab = b.dataset.advTab;
      $$('[data-adv-tab]').forEach((x) => x.classList.toggle('active', x === b));
      $$('[data-adv-view]').forEach((v) => { v.hidden = v.dataset.advView !== tab; });
      nowKey = '';
      render();
      if (tab === 'story') scrollLog(true);
    };
  });
  const muteBtn = $('#advMute');
  const paintMute = () => {
    muteBtn.replaceChildren(icon(FX.muted ? 'skull' : 'bell'), FX.muted ? 'Sound off' : 'Sound on');
    muteBtn.setAttribute('aria-pressed', String(!FX.muted));
  };
  muteBtn.onclick = () => { FX.setMuted(!FX.muted); paintMute(); };
  paintMute();

  // ---------- main render ----------
  function render() {
    const S = TT.S;
    const on = !!(S && S.mode === 'adventure' && S.adventure);
    $('#adventure').hidden = !on;
    if (!on) return;
    const A = S.adventure;
    $('#advTitle').textContent = A.title;
    $('#advRegion').textContent = A.location.region;
    $('#advPlace').textContent = A.location.name;
    $('#advPlaceIcon').style.setProperty('--i', `url(/art/icons/${A.location.icon}.svg)`);
    $('#advGold').textContent = A.gold;
    const potions = (A.inventory.find((i) => i.id === 'potion') || { n: 0 }).n;
    $('#advPotions').textContent = `${potions} potion${potions === 1 ? '' : 's'}`;
    renderScene(A);
    renderParty(A);
    renderLog(A);
    renderNow(A);
    if (tab === 'world') renderWorld(A);
    if (tab === 'journal') renderJournal(A);
    playNewEffects(S, A);
  }
  window.renderAdventure = render;

  // ---------- scene banner & weather ----------
  function renderScene(A) {
    const mood = A.ambience === 'clear' ? 'clear' : 'ash';
    const key = `${A.location.id}:${mood}:${A.location.image || ''}`;
    if (key !== sceneKey) {
      sceneKey = key;
      const box = $('#advScene');
      box.classList.remove('show');
      if (A.location.image) {
        const img = el('img');
        img.src = A.location.image;
        img.alt = '';
        box.replaceChildren(img);
      } else {
        const draw = (window.SCENES && (window.SCENES[A.location.scene] || window.SCENES.default)) || null;
        box.innerHTML = draw ? draw(mood) : ''; // our own generated SVG, no user content
      }
      requestAnimationFrame(() => box.classList.add('show'));
    }
    if (!weather) weather = new FX.Weather($('#advWeather'));
    const indoors = A.location.effect === 'drips';
    weather.set(indoors ? ['drips'] : [A.ambience, A.location.effect]);
  }

  // ---------- effects ----------
  function playNewEffects(S, A) {
    if (primedRoom !== S.code) { seenLog.clear(); primedRoom = S.code; for (const e of A.log) seenLog.add(e.id); return; }
    const fresh = [];
    for (const e of A.log) {
      if (seenLog.has(e.id)) continue;
      seenLog.add(e.id);
      if (e.fx) fresh.push(e.fx);
    }
    if (!fresh.length) return;
    FX.enqueue(fresh, {
      meId: TT.me.id,
      nameOf: (id) => (A.party.find((p) => p.id === id) || { name: 'A hero' }).name,
      levelOf: (id) => (A.party.find((p) => p.id === id) || { level: '' }).level,
    });
  }

  // ---------- party ----------
  function renderParty(A) {
    const cur = currentEntry();
    const box = $('#advParty');
    if (!A.party.length) {
      box.replaceChildren(el('p', 'hint', 'No heroes yet. Create one to start playing.'));
      return;
    }
    box.replaceChildren(...A.party.map((h) => {
      const card = el('div', 'hero');
      card.dataset.hero = h.id;
      if (h.id === TT.me.id) card.classList.add('me');
      if (cur && cur.owner === h.id) card.classList.add('turn');
      if (h.hp <= 0) card.classList.add('down');
      if (h.defending) card.classList.add('defending');
      const info = el('div', 'hero-info');
      const top = el('div', 'hero-top');
      top.append(el('b', '', h.name), el('span', 'hero-cls', `Lv ${h.level} ${h.clsName}`));
      const stats = el('div', 'hero-stats');
      stats.append(icon('defend', 'sm'), ` ${h.ac}  `, icon('second-wind', 'sm'), ` ${h.hp}/${h.maxHp}`);
      if (h.cls === 'wizard' || h.cls === 'cleric') stats.append('  ', icon('magic-missile', 'sm'), ` ${h.uses.slots}`);
      info.append(top, hpBar(h.hp, h.maxHp), stats, el('div', 'hero-xp', h.nextXp ? `XP ${h.xp} / ${h.nextXp}` : `XP ${h.xp} (max level)`));
      card.append(portrait(h.id, h.cls), info);
      const seat = h.id !== TT.me.id && TT.seatCount() > 1 ? TT.localSeatFor(h.id) : null;
      if (seat) {
        card.classList.add('local');
        card.title = `Switch to ${h.name}`;
        card.onclick = () => TT.switchSeat(seat);
      }
      return card;
    }));
  }

  // ---------- story log ----------
  function scrollLog(force) {
    const log = $('#advLog');
    if (force || log.scrollHeight - log.scrollTop - log.clientHeight < 160) log.scrollTop = log.scrollHeight;
  }

  function renderLog(A) {
    const last = A.log[A.log.length - 1];
    const key = `${A.log.length}:${last ? last.id : ''}`;
    if (key === lastLogId) return;
    lastLogId = key;
    const log = $('#advLog');
    log.replaceChildren(...A.log.map((e) => {
      if (e.kind === 'place') {
        const d = el('div', 'log-place');
        d.append(el('h3', '', e.title), el('p', '', e.text));
        return d;
      }
      if (e.kind === 'story' || e.kind === 'ending') {
        const d = el('div', `log-story${e.kind === 'ending' ? ' ending' : ''}`);
        if (e.title) d.append(el('h4', '', e.title));
        d.append(el('p', '', e.text));
        return d;
      }
      const d = el('div', `log-line k-${e.kind}${e.ok === true ? ' ok' : e.ok === false ? ' bad' : ''}`, e.text);
      if (e.title === 'Victory' || e.title === 'Combat') d.classList.add('big');
      return d;
    }));
    requestAnimationFrame(() => scrollLog(true));
  }

  // ---------- "what now" panel ----------
  function renderNow(A) {
    const me = TT.me;
    const mine = A.party.find((p) => p.id === me.id);
    const cur = currentEntry();
    const turnId = `${me.id}:${cur ? cur.id : ''}`;
    if (turnId !== renderNow.lastTurn) { pendingAlly = null; renderNow.lastTurn = turnId; }
    const key = JSON.stringify([me.id, A.ended && A.ended.at, dismissedEnd, !!mine, A.combat, A.scene, A.actions, A.exits, A.myActions,
      cur && cur.id, targetId, pendingAlly, A.party.map((p) => [p.id, p.hp]), A.gold, A.inventory, TT.seatCount(), TT.S.portraits]);
    if (key === nowKey) return;
    nowKey = key;
    const box = $('#advNow');
    const focused = document.activeElement && box.contains(document.activeElement) ? document.activeElement.id : null;

    let parts;
    if (A.ended && dismissedEnd !== A.ended.at) parts = endingPanel(A);
    else if (!mine) parts = createPanel(A);
    else if (A.combat) parts = combatPanel(A, mine, cur);
    else if (A.scene) parts = scenePanel(A, mine);
    else parts = locationPanel(A, mine);
    box.classList.toggle('in-combat', !!(A.combat && mine));
    box.replaceChildren(...parts);
    if (focused && document.getElementById(focused)) document.getElementById(focused).focus();
  }

  function actingAs(mine) {
    const d = el('div', 'acting');
    d.append(portrait(mine.id, mine.cls, 'xs'), 'Acting: ', el('b', '', mine.name), ` (${mine.clsName})`);
    if (TT.seatCount() > 1) d.append(el('span', 'hint', ' · switch players at the top to let someone else try'));
    return d;
  }

  function endingPanel(A) {
    const card = el('div', 'panel-card ending');
    card.append(icon('bell', 'xl gold'), el('h3', '', A.ended.title), el('p', '', 'You finished the main quest! The Vale is still open: keep exploring, finish side quests, or start again.'));
    const row = el('div', 'row wrap');
    row.append(button('Keep exploring', 'btn primary', () => { dismissedEnd = A.ended.at; nowKey = ''; render(); }));
    if (TT.me.isDM) {
      row.append(button('Start the adventure over', 'btn ghost', () => {
        if (confirm('Start the adventure over from the beginning? Heroes keep their names and classes but go back to level 1.')) TT.send({ t: 'adv:reset' });
      }));
    }
    card.append(row);
    return [card];
  }

  function createPanel(A) {
    const card = el('div', 'panel-card create');
    card.append(el('h3', '', 'Create your hero'));
    card.append(el('p', 'hint', TT.seatCount() > 1 ? `Making a hero for ${TT.seatName()}.` : 'Pick a name, a class and (if you like) a picture.'));
    const row = el('div', 'create-row');
    const pic = el('div', 'create-pic');
    pic.append(portrait(TT.me.id, createCls, 'lg'));
    const up = el('label', 'btn small', 'Upload picture');
    const file = el('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.hidden = true;
    file.onchange = () => { if (file.files[0]) TT.uploadPortrait(file.files[0]); file.value = ''; };
    up.append(file);
    pic.append(up);
    const name = el('input');
    name.id = 'heroName';
    name.maxLength = 30;
    name.placeholder = 'Hero name';
    name.value = draftName || TT.seatName();
    name.oninput = () => { draftName = name.value; };
    const label = el('label', 'field', 'Hero name');
    label.append(name);
    const right = el('div', 'grow');
    right.append(label);
    row.append(pic, right);
    card.append(row);
    const grid = el('div', 'cls-grid');
    for (const c of A.classes) {
      const b = button([icon(c.id, 'cls-ico'), el('b', '', c.name), el('span', 'cls-desc', c.desc), el('span', 'cls-stats', `HP ${c.hp} · AC ${c.ac} · ${c.weapon}`)], `cls-card${c.id === createCls ? ' active' : ''}`, () => {
        createCls = c.id;
        $$('.cls-card', grid).forEach((x) => x.classList.toggle('active', x === b));
        if (!(TT.S.portraits && TT.S.portraits[TT.me.id])) pic.replaceChild(portrait(TT.me.id, createCls, 'lg'), pic.firstChild);
      });
      b.style.setProperty('--c', CLASS_COLORS[c.id]);
      grid.append(b);
    }
    card.append(grid);
    card.append(button('Join the party', 'btn primary', () => {
      TT.send({ t: 'adv:create', name: name.value.trim() || TT.seatName(), cls: createCls });
      draftName = '';
    }));
    return [card];
  }

  function choiceButton(label, tags, onClick, disabled, ico) {
    const b = button([ico ? icon(ico, 'choice-ico') : null, el('span', 'choice-label', label), ...tags.map((t) => el('span', `tag${t.cls ? ` ${t.cls}` : ''}`, t.text))], 'choice', onClick);
    if (disabled) b.disabled = true;
    return b;
  }

  function scenePanel(A, mine) {
    const out = [];
    const head = el('div', 'now-head');
    head.append(el('h3', '', A.scene.title), actingAs(mine));
    out.push(head);
    const list = el('div', 'choices');
    for (const c of A.scene.choices) {
      const tags = [];
      if (c.check) tags.push({ text: `${c.check.label} DC ${c.check.dc}${c.check.bonus !== null ? ` · you ${signed(c.check.bonus)}` : ''}`, cls: 'check' });
      if (c.cost) tags.push({ text: `${c.cost} gold`, cls: 'cost' });
      list.append(choiceButton(c.label, tags, () => TT.send({ t: 'adv:choose', index: c.index }), c.cost > A.gold, c.check ? 'd20' : null));
    }
    if (!A.scene.noLeave) list.append(button('Leave', 'btn ghost small leave', () => TT.send({ t: 'adv:choose', index: -1 })));
    out.push(list);
    return out;
  }

  function locationPanel(A, mine) {
    const out = [];
    const head = el('div', 'now-head');
    head.append(el('h3', '', 'What do you do?'), actingAs(mine));
    out.push(head);

    const here = el('div', 'choices');
    for (const a of A.actions) {
      const tags = a.cost ? [{ text: `${a.cost} gold`, cls: 'cost' }] : [];
      const ico = a.kind === 'inn' ? 'inn' : a.kind === 'camp' ? 'camp' : a.kind === 'buy' ? (a.item || 'potion') : 'journal';
      here.append(choiceButton(a.label, tags, () => TT.send({ t: 'adv:do', kind: a.kind, id: a.id, item: a.item }), a.cost > A.gold, ico));
    }
    out.push(here);

    out.push(el('h4', 'now-sub', 'Travel'));
    const exits = el('div', 'exits');
    for (const x of A.exits) {
      const node = A.world.nodes.find((n) => n.id === x.to);
      const b = button([icon(node ? node.icon : 'map'), el('span', '', x.name), x.ok ? (x.visited ? null : el('span', 'tag new', 'new')) : el('span', 'tag lock', 'locked')], `exit${x.ok ? '' : ' locked'}`, () => {
        if (!x.ok) return TT.toast(x.locked, true);
        TT.send({ t: 'adv:travel', to: x.to });
      });
      if (!x.ok) b.title = x.locked;
      exits.append(b);
    }
    out.push(exits);

    const potions = (A.inventory.find((i) => i.id === 'potion') || { n: 0 }).n;
    const hurt = A.party.filter((p) => p.hp < p.maxHp);
    if (potions && hurt.length) {
      out.push(el('h4', 'now-sub', `Healing potions (${potions})`));
      const row = el('div', 'exits');
      for (const p of hurt) row.append(button([icon('potion'), `Give one to ${p.name} (${p.hp}/${p.maxHp})`], 'exit', () => TT.send({ t: 'adv:use', item: 'potion', ally: p.id })));
      out.push(row);
    }
    return out;
  }

  function monsterCard(m) {
    const card = button([], `foe${m.hp <= 0 ? ' dead' : ''}${m.id === targetId ? ' target' : ''}${m.boss ? ' boss' : ''}`, () => {
      if (m.hp <= 0) return;
      targetId = m.id;
      nowKey = '';
      render();
    });
    card.dataset.foe = m.id;
    const art = el('div', 'foe-art');
    art.append(icon(m.icon, 'foe-ico'));
    const ac = el('div', 'foe-ac', String(m.ac));
    ac.title = 'Armor Class';
    art.append(ac);
    if (m.boss) art.append(el('div', 'foe-boss', 'Boss'));
    const body = el('div', 'foe-body');
    body.append(el('b', 'foe-name', m.name), hpBar(m.hp, m.maxHp), el('span', 'foe-stats', m.hp > 0 ? `HP ${m.hp}/${m.maxHp}` : 'Defeated'));
    card.append(art, body);
    card.title = m.hp > 0 ? 'Click to target' : '';
    return card;
  }

  function combatPanel(A, mine, cur) {
    const out = [];
    const living = A.combat.monsters.filter((m) => m.hp > 0);
    if (!living.some((m) => m.id === targetId)) targetId = living[0] ? living[0].id : null;

    const head = el('div', 'now-head');
    head.append(icon('combat', 'gold'), el('h3', '', `Combat · Round ${TT.S.initiative.round}`));
    // turn order strip
    const order = el('div', 'turn-order');
    for (const e of TT.S.initiative.list) {
      const pc = A.party.find((p) => p.id === e.owner);
      const mon = !e.owner && A.combat.monsters.find((m) => m.id === e.ref);
      if ((pc && pc.hp <= 0) || (mon && mon.hp <= 0)) continue;
      const chip = el('span', `turn-chip${e.id === TT.S.initiative.current ? ' now' : ''}${pc ? ' pc' : ' npc'}`);
      chip.append(pc ? portrait(pc.id, pc.cls, 'xs') : icon(mon ? mon.icon : 'skull', 'sm'), el('span', '', e.name));
      chip.title = `Initiative ${e.value}`;
      order.append(chip);
    }
    head.append(order);
    out.push(head);

    const foes = el('div', 'foes');
    for (const m of A.combat.monsters) foes.append(monsterCard(m));
    out.push(foes);

    const myTurn = cur && cur.owner === TT.me.id;
    if (!myTurn) {
      const who = cur ? cur.name : '…';
      const wait = el('div', 'waiting');
      wait.append(el('span', 'spinner'), `Waiting for ${who} to act…`);
      const seat = cur && TT.localSeatFor(cur.owner);
      if (seat && TT.seatCount() > 1) wait.append(button(`Switch to ${who}`, 'btn small', () => TT.switchSeat(seat)));
      out.push(wait);
      return out;
    }

    const turn = el('div', 'your-turn');
    turn.append(el('b', '', `Your turn, ${mine.name}!`), el('span', 'hint', targetId ? ` Target: ${living.find((m) => m.id === targetId).name} (click a card to change)` : ''));
    out.push(turn);

    if (pendingAlly) {
      const action = A.myActions.find((a) => a.id === pendingAlly);
      out.push(el('h4', 'now-sub', `${action ? action.label : 'Heal'}: who?`));
      const row = el('div', 'exits');
      for (const p of A.party) {
        row.append(button([portrait(p.id, p.cls, 'xs'), `${p.name} (${p.hp}/${p.maxHp})`], `exit${p.hp <= 0 ? ' down' : ''}`, () => {
          TT.send({ t: 'adv:act', action: pendingAlly, ally: p.id });
          pendingAlly = null;
        }));
      }
      row.append(button('Cancel', 'btn ghost small', () => { pendingAlly = null; nowKey = ''; render(); }));
      out.push(row);
      return out;
    }

    const grid = el('div', 'actions');
    for (const a of A.myActions) {
      const usesLeft = a.uses === undefined ? null : a.uses;
      const ico = a.id === 'attack' ? (mine.cls === 'rogue' ? 'backstab' : 'attack') : ACTION_ICONS[a.id] || 'attack';
      const b = button([icon(ico, 'act-ico'), el('b', '', a.label), el('span', 'act-desc', a.desc), usesLeft !== null ? el('span', 'tag', `${usesLeft} left`) : null], `act${a.id === 'flee' ? ' flee' : ''}`, () => {
        if (a.target === 'ally') { pendingAlly = a.id; nowKey = ''; render(); return; }
        TT.send({ t: 'adv:act', action: a.id, target: targetId });
      });
      if (usesLeft === 0) b.disabled = true;
      grid.append(b);
    }
    out.push(grid);
    return out;
  }

  // ---------- world map ----------
  function renderWorld(A) {
    const board = $('#advBoard');
    const nodes = Object.fromEntries(A.world.nodes.map((n) => [n.id, n]));
    const reachable = new Map(A.exits.map((x) => [x.to, x]));
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 70');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.classList.add('roads');
    for (const e of A.world.edges) {
      const a = nodes[e.a];
      const b = nodes[e.b];
      const line = document.createElementNS(NS, 'path');
      const mx = (a.x + b.x) / 2 + (a.y - b.y) * 0.08;
      const my = (a.y + b.y) / 2 + (b.x - a.x) * 0.08;
      line.setAttribute('d', `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`);
      line.setAttribute('class', `road${e.ok ? '' : ' locked'}`);
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.append(line);
    }
    const pieces = [svg];
    for (const n of A.world.nodes) {
      const exit = reachable.get(n.id);
      const canGo = exit && exit.ok && !A.combat;
      const b = button([el('span', 'pin-medal', ''), el('span', 'pin-name', n.visited ? n.name : `${n.name}?`)], `pin${n.visited ? ' visited' : ' unknown'}${n.here ? ' here' : ''}${canGo ? ' go' : ''}${exit && !exit.ok ? ' locked' : ''}`, () => {
        if (canGo) TT.send({ t: 'adv:travel', to: n.id });
        else if (exit && !exit.ok) TT.toast(exit.locked, true);
        else if (n.here) TT.toast('You are here.');
      });
      b.firstChild.append(icon(n.icon));
      if (n.here) b.append(el('span', 'pin-here', 'You are here'));
      b.style.left = `${n.x}%`;
      b.style.top = `${(n.y / 70) * 100}%`;
      b.title = canGo ? `Travel to ${n.name}` : n.name;
      pieces.push(b);
    }
    board.replaceChildren(...pieces);
  }

  // ---------- journal ----------
  function renderJournal(A) {
    const box = $('[data-adv-view=journal]');
    const quests = A.journal.slice().sort((a, b) => a.done - b.done);
    const qs = el('section');
    qs.append(el('h3', '', 'Quests'));
    if (!quests.length) qs.append(el('p', 'hint', 'No quests yet. Talk to people!'));
    for (const q of quests) {
      const d = el('div', `quest${q.done ? ' done' : ''}`);
      d.append(el('b', '', `${q.done ? '✓ ' : ''}${q.title}`), el('p', '', q.text));
      qs.append(d);
    }
    const inv = el('section');
    inv.append(el('h3', '', `Party pack · ${A.gold} gold`));
    if (!A.inventory.length) inv.append(el('p', 'hint', 'Empty.'));
    for (const i of A.inventory) {
      const d = el('div', 'item');
      const txt = el('div');
      txt.append(el('b', '', `${i.name}${i.n > 1 ? ` ×${i.n}` : ''}`), el('p', '', i.desc));
      d.append(icon(i.icon, 'item-ico'), txt);
      inv.append(d);
    }
    const help = el('section');
    help.append(el('h3', '', 'How to play'));
    help.append(el('p', 'hint', 'Pick what to do from the choices under the story. Choices marked with a d20 are skill checks: roll a d20 plus the bonus of the hero who picks them. DC is the number to beat, so let the best hero try. In a fight, heroes take turns in initiative order and the game plays the monsters. Rest at the inn to recover hit points and spells. Camping in the wild recovers half your hit points, but something may find you.'));
    const credits = el('p', 'hint credits');
    credits.append('Icons by Lorc, Delapouite, Skoll and others from ');
    const a1 = el('a', '', 'game-icons.net');
    a1.href = 'https://game-icons.net';
    a1.target = '_blank';
    a1.rel = 'noopener';
    const a2 = el('a', '', 'full credits');
    a2.href = '/art/CREDITS.md';
    a2.target = '_blank';
    credits.append(a1, ' (CC BY 3.0) · ', a2);
    help.append(credits);
    box.replaceChildren(qs, inv, help);
  }
})();
