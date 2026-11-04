// Adventure mode UI: story log, choices, world map, journal, party and combat.
// All game rules run on the server; this file only draws the state and sends choices.
(() => {
  'use strict';
  const TT = window.TT;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = TT.el;
  const SVG = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs = {}) => {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

  let tab = 'story';
  let targetId = null; // chosen monster
  let pendingAlly = null; // action waiting for an ally to be picked
  let dismissedEnd = null;
  let createCls = 'fighter';
  let draftName = '';
  let lastLogId = '';
  let nowKey = '';

  // ---------- small builders ----------
  function button(label, cls, onClick) {
    const b = el('button', cls || 'btn');
    if (typeof label === 'string') b.textContent = label;
    else b.append(...label);
    b.type = 'button';
    if (onClick) b.onclick = onClick;
    return b;
  }
  function hpBar(hp, max) {
    const pct = max ? Math.max(0, Math.min(100, (hp / max) * 100)) : 0;
    const bar = el('div', 'hpbar');
    const fill = el('div', `fill ${pct > 50 ? 'ok' : pct > 25 ? 'mid' : 'low'}`);
    fill.style.width = `${pct}%`;
    bar.append(fill);
    return bar;
  }
  const currentEntry = () => {
    const init = TT.S.initiative;
    return init.list.find((e) => e.id === init.current) || null;
  };

  // ---------- tabs ----------
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
    $('#advGold').textContent = A.gold;
    const potions = (A.inventory.find((i) => i.id === 'potion') || { n: 0 }).n;
    $('#advPotions').textContent = `${potions} potion${potions === 1 ? '' : 's'}`;
    renderParty(A);
    renderLog(A);
    renderNow(A);
    if (tab === 'world') renderWorld(A);
    if (tab === 'journal') renderJournal(A);
  }
  window.renderAdventure = render;

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
      if (h.id === TT.me.id) card.classList.add('me');
      if (cur && cur.owner === h.id) card.classList.add('turn');
      if (h.hp <= 0) card.classList.add('down');
      const top = el('div', 'hero-top');
      top.append(el('b', '', h.name), el('span', 'hero-cls', `Lv ${h.level} ${h.clsName}`));
      const stats = el('div', 'hero-stats', `HP ${h.hp}/${h.maxHp} · AC ${h.ac}${h.uses.slots || h.cls === 'wizard' || h.cls === 'cleric' ? ` · Spells ${h.uses.slots}` : ''}${h.defending ? ' · Defending' : ''}`);
      const xp = el('div', 'hero-xp', h.nextXp ? `XP ${h.xp} / ${h.nextXp}` : `XP ${h.xp} (max level)`);
      card.append(top, hpBar(h.hp, h.maxHp), stats, xp);
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
    // New story always scrolls into view (after the panel below has re-rendered too).
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
      cur && cur.id, targetId, pendingAlly, A.party.map((p) => [p.id, p.hp]), A.gold, A.inventory, TT.seatCount()]);
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
    box.replaceChildren(...parts);
    if (focused && document.getElementById(focused)) document.getElementById(focused).focus();
  }

  function actingAs(mine) {
    const d = el('div', 'acting');
    d.append('Acting: ', el('b', '', mine.name), ` (${mine.clsName})`);
    if (TT.seatCount() > 1) d.append(el('span', 'hint', ' · switch players at the top to let someone else try'));
    return d;
  }

  function endingPanel(A) {
    const card = el('div', 'panel-card ending');
    card.append(el('h3', '', A.ended.title), el('p', '', 'You finished the main quest! The Vale is still open: keep exploring, finish side quests, or start again.'));
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
    card.append(el('p', 'hint', TT.seatCount() > 1 ? `Making a hero for ${TT.seatName()}.` : 'Pick a name and a class. You can play with any mix of classes.'));
    const name = el('input');
    name.id = 'heroName';
    name.maxLength = 30;
    name.placeholder = 'Hero name';
    name.value = draftName || TT.seatName();
    name.oninput = () => { draftName = name.value; };
    const label = el('label', 'field', 'Hero name');
    label.append(name);
    card.append(label);
    const grid = el('div', 'cls-grid');
    for (const c of A.classes) {
      const b = button([el('b', '', c.name), el('span', 'cls-desc', c.desc), el('span', 'cls-stats', `HP ${c.hp} · AC ${c.ac} · ${c.weapon}`)], `cls-card${c.id === createCls ? ' active' : ''}`, () => {
        createCls = c.id;
        $$('.cls-card', grid).forEach((x) => x.classList.toggle('active', x === b));
      });
      b.setAttribute('aria-pressed', String(c.id === createCls));
      grid.append(b);
    }
    card.append(grid);
    card.append(button('Join the party', 'btn primary', () => {
      TT.send({ t: 'adv:create', name: name.value.trim() || TT.seatName(), cls: createCls });
      draftName = '';
    }));
    return [card];
  }

  function choiceButton(label, tags, onClick, disabled) {
    const b = button([el('span', 'choice-label', label), ...tags.map((t) => el('span', `tag${t.cls ? ` ${t.cls}` : ''}`, t.text))], 'choice', onClick);
    if (disabled) { b.disabled = true; }
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
      list.append(choiceButton(c.label, tags, () => TT.send({ t: 'adv:choose', index: c.index }), c.cost > A.gold));
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
      here.append(choiceButton(a.label, tags, () => TT.send({ t: 'adv:do', kind: a.kind, id: a.id, item: a.item }), a.cost > A.gold));
    }
    out.push(here);

    out.push(el('h4', 'now-sub', 'Travel'));
    const exits = el('div', 'exits');
    for (const x of A.exits) {
      const b = button([el('span', '', `→ ${x.name}`), ...(x.ok ? (x.visited ? [] : [el('span', 'tag new', 'new')]) : [el('span', 'tag lock', 'locked')])], `exit${x.ok ? '' : ' locked'}`, () => {
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
      for (const p of hurt) row.append(button(`Give one to ${p.name} (${p.hp}/${p.maxHp})`, 'exit', () => TT.send({ t: 'adv:use', item: 'potion', ally: p.id })));
      out.push(row);
    }
    return out;
  }

  function combatPanel(A, mine, cur) {
    const out = [];
    const living = A.combat.monsters.filter((m) => m.hp > 0);
    if (!living.some((m) => m.id === targetId)) targetId = living[0] ? living[0].id : null;

    const head = el('div', 'now-head');
    head.append(el('h3', '', `Combat · Round ${TT.S.initiative.round}`));
    out.push(head);

    const foes = el('div', 'foes');
    for (const m of A.combat.monsters) {
      const b = button([el('b', '', m.name), hpBar(m.hp, m.maxHp), el('span', 'foe-stats', m.hp > 0 ? `HP ${m.hp}/${m.maxHp} · AC ${m.ac}` : 'Defeated')], `foe${m.hp <= 0 ? ' dead' : ''}${m.id === targetId ? ' target' : ''}`, () => {
        if (m.hp <= 0) return;
        targetId = m.id;
        nowKey = '';
        render();
      });
      b.title = m.hp > 0 ? 'Click to target' : '';
      foes.append(b);
    }
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
    turn.append(el('b', '', `Your turn, ${mine.name}!`), el('span', 'hint', targetId ? ` Target: ${living.find((m) => m.id === targetId).name} (click an enemy to change)` : ''));
    out.push(turn);

    if (pendingAlly) {
      const action = A.myActions.find((a) => a.id === pendingAlly);
      out.push(el('h4', 'now-sub', `${action ? action.label : 'Heal'}: who?`));
      const row = el('div', 'exits');
      for (const p of A.party) {
        row.append(button(`${p.name} (${p.hp}/${p.maxHp})`, `exit${p.hp <= 0 ? ' down' : ''}`, () => {
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
      const b = button([el('b', '', a.label), el('span', 'act-desc', a.desc), ...(usesLeft !== null ? [el('span', 'tag', `${usesLeft} left`)] : [])], `act${a.id === 'flee' ? ' flee' : ''}`, () => {
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
    const map = $('#advMap');
    const nodes = Object.fromEntries(A.world.nodes.map((n) => [n.id, n]));
    const reachable = new Map(A.exits.map((x) => [x.to, x]));
    const kids = [];
    const defs = svg('defs');
    const grad = svg('radialGradient', { id: 'parch', cx: '50%', cy: '45%', r: '75%' });
    grad.append(svg('stop', { offset: '0%', 'stop-color': '#3a3024' }), svg('stop', { offset: '100%', 'stop-color': '#1a1511' }));
    defs.append(grad);
    kids.push(defs, svg('rect', { x: 0, y: 0, width: 100, height: 70, fill: 'url(#parch)', rx: 2 }));

    for (const e of A.world.edges) {
      const a = nodes[e.a];
      const b = nodes[e.b];
      kids.push(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: `road${e.ok ? '' : ' locked'}` }));
    }
    for (const n of A.world.nodes) {
      const g = svg('g', { class: `place${n.visited ? ' visited' : ' unknown'}${n.here ? ' here' : ''}` });
      const exit = reachable.get(n.id);
      if (exit && exit.ok && !A.combat) {
        g.classList.add('go');
        g.addEventListener('click', () => { TT.send({ t: 'adv:travel', to: n.id }); });
        const t = svg('title');
        t.textContent = `Travel to ${n.name}`;
        g.append(t);
      } else if (exit && !exit.ok) {
        g.addEventListener('click', () => TT.toast(exit.locked, true));
      }
      if (n.here) g.append(svg('circle', { cx: n.x, cy: n.y, r: 4.6, class: 'here-ring' }));
      g.append(svg('circle', { cx: n.x, cy: n.y, r: 2.4, class: 'dot' }));
      const label = svg('text', { x: n.x, y: n.y + 6.2, 'text-anchor': 'middle', class: 'label' });
      label.textContent = n.visited ? n.name : `${n.name}?`;
      g.append(label);
      kids.push(g);
    }
    map.replaceChildren(...kids);
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
      d.append(el('b', '', `${i.name}${i.n > 1 ? ` ×${i.n}` : ''}`), el('p', '', i.desc));
      inv.append(d);
    }
    const help = el('section');
    help.append(el('h3', '', 'How to play'));
    help.append(el('p', 'hint', 'Pick what to do from the choices under the story. Tagged choices like "Stealth DC 13" roll a d20 plus the bonus of the hero who picks them: DC is the number to beat, so let the best hero try. In a fight, heroes take turns in initiative order and the game plays the monsters. Rest at the inn to recover hit points and spells. Camping in the wild recovers half your hit points, but something may find you.'));
    box.replaceChildren(qs, inv, help);
  }
})();
