// Adventure mode UI, laid out like a classic RPG window menu:
//   scene (picture or 3D) on top · story window · party window · command window
//   plus a main menu (Esc) with Items, Status, Quests, Map, Chat, Players, Settings.
// All game rules run on the server; this file only draws the state and sends choices.
(() => {
  'use strict';
  const TT = window.TT;
  const FX = window.FX;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = TT.el;
  const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  const CLASS_COLORS = { fighter: '#b8443a', rogue: '#4f7d4a', wizard: '#4366a8', cleric: '#b8913a' };
  const ACTION_ICONS = { 'second-wind': 'second-wind', 'fire-bolt': 'fire-bolt', 'magic-missile': 'magic-missile', 'sacred-flame': 'sacred-flame', 'cure-wounds': 'cure-wounds', potion: 'potion', defend: 'defend', flee: 'flee' };
  const ABIL = [['str', 'STR'], ['dex', 'DEX'], ['con', 'CON'], ['int', 'INT'], ['wis', 'WIS'], ['cha', 'CHA']];

  // ---------- settings ----------
  const use3d = () => !!window.Board3D && store.get('dnd.3d') !== '0';
  window.addEventListener('three-ready', () => { nowKey = ''; render(); });

  // ---------- state ----------
  let targetId = null;
  let dismissedEnd = null;
  let createCls = 'fighter';
  let draftName = '';
  let lastLogId = '';
  let nowKey = '';
  let baseKey = '';
  let stack = []; // command submenus: [{ type, action? }]
  let sceneKey = '';
  let weather = null;
  const seenLog = new Set();
  let primedRoom = null;
  let menuOpen = false;
  let menuPage = 'items';
  let statusHero = null;
  let modalClosed = false;
  let modalKey = '';
  let lastChatSeen = store.get('dnd.chatSeen') || '';

  // ---------- small builders ----------
  function icon(name, cls = '') {
    const i = el('span', `ico ${cls}`);
    i.style.setProperty('--i', `url(/art/icons/${name}.svg)`);
    i.setAttribute('aria-hidden', 'true');
    return i;
  }
  function button(label, cls, onClick) {
    const b = el('button', cls || 'btn');
    b.type = 'button';
    if (typeof label === 'string') b.textContent = label;
    else b.append(...label.filter(Boolean));
    if (onClick) b.onclick = onClick;
    return b;
  }
  // A menu choice: pointer cursor, label, optional icon / right-hand tag / small second line.
  function mi(label, { onClick, icon: ico, tag, tagCls, sub, disabled, cls = '', data } = {}) {
    const b = el('button', `mi ${cls}`);
    b.type = 'button';
    const main = el('span', 'mi-main');
    if (ico) main.append(icon(ico, 'mi-ico'));
    main.append(el('span', 'mi-label', label));
    if (tag) main.append(el('span', `mi-tag ${tagCls || ''}`, tag));
    b.append(main);
    if (sub) b.append(el('span', 'mi-sub', sub));
    if (disabled) b.disabled = true;
    if (onClick) b.onclick = onClick;
    if (data) Object.assign(b.dataset, data);
    return b;
  }
  function hpBar(hp, max, cls = '') {
    const pct = max ? Math.max(0, Math.min(100, (hp / max) * 100)) : 0;
    const bar = el('div', `bar ${cls}`);
    const fill = el('div', `fill ${pct > 50 ? 'ok' : pct > 25 ? 'mid' : 'low'}`);
    fill.style.width = `${pct}%`;
    bar.append(fill);
    return bar;
  }
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
  const potionsOf = (A) => (A.inventory.find((i) => i.id === 'potion') || { n: 0 }).n;

  // ---------- main render ----------
  function render() {
    const S = TT.S;
    const on = !!(S && S.mode === 'adventure' && S.adventure);
    $('#adventure').hidden = !on;
    placeChat(on);
    if (!on) { menuOpen = false; return; }
    const A = S.adventure;
    $('#advTitle').textContent = A.title;
    $('#advRegion').textContent = A.location.region;
    $('#advPlace').textContent = A.location.name;
    $('#advPlaceIcon').style.setProperty('--i', `url(/art/icons/${A.location.icon}.svg)`);
    $('#advGold').textContent = A.gold;
    $('#advPotions').textContent = potionsOf(A);
    renderScene(A);
    renderStage(A);
    renderEnemies(A);
    renderParty(A);
    renderLog(A);
    renderNow(A);
    renderModal(A);
    renderChatBadge();
    if (menuOpen) renderMenu(A);
    playNewEffects(S, A);
  }
  window.renderAdventure = render;

  // Reconnecting notice (the top bar is hidden in adventure mode).
  new MutationObserver(() => { $('#advConn').textContent = $('#conn').textContent; }).observe($('#conn'), { childList: true, characterData: true, subtree: true });

  // ---------- scene & weather ----------
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
    weather.set(A.location.effect === 'drips' ? ['drips'] : [A.ambience, A.location.effect]);
  }

  // 3D battle stage replaces the picture during fights.
  function renderStage(A) {
    const on = !!(A.combat && use3d() && A.party.length);
    const box = $('#advStage3d');
    box.hidden = !on;
    $('#adventure').classList.toggle('in-battle', !!A.combat);
    if (A.combat) {
      const living = A.combat.monsters.filter((m) => m.hp > 0);
      if (!living.some((m) => m.id === targetId)) targetId = living[0] ? living[0].id : null;
    }
    if (!on) return;
    window.Stage3D.update(box, A, TT.S.initiative, targetId, (id) => chooseTarget(A, id));
  }

  // Clicking an enemy (in 3D or in the Enemies window).
  function chooseTarget(A, id) {
    const m = A.combat && A.combat.monsters.find((x) => x.id === id);
    if (!m || m.hp <= 0) return;
    const top = stack[stack.length - 1];
    if (top && top.type === 'target') { act(top.action, { target: id }); return; }
    targetId = id;
    nowKey = '';
    render();
  }

  function act(action, extra = {}) {
    stack = [];
    TT.send({ t: 'adv:act', action, target: targetId, ...extra });
  }

  // ---------- enemies window ----------
  function renderEnemies(A) {
    const box = $('#advEnemies');
    box.hidden = !A.combat;
    if (!A.combat) return;
    const rows = A.combat.monsters.map((m) => {
      const r = el('button', `foe-row${m.hp <= 0 ? ' dead' : ''}${m.id === targetId && m.hp > 0 ? ' target' : ''}${m.boss ? ' boss' : ''}`);
      r.type = 'button';
      r.dataset.foe = m.id;
      const name = el('span', 'foe-name');
      name.append(icon(m.icon, 'foe-ico'), el('span', '', m.name));
      r.append(name, hpBar(m.hp, m.maxHp), el('span', 'foe-hp', m.hp > 0 ? `${m.hp}/${m.maxHp}` : 'Defeated'));
      r.title = m.hp > 0 ? `${m.name} · AC ${m.ac} · click to target` : m.name;
      r.onclick = () => chooseTarget(A, m.id);
      return r;
    });
    box.replaceChildren(el('div', 'win-title', `Enemies · Round ${TT.S.initiative.round}`), ...rows);
  }

  // ---------- party window ----------
  function renderParty(A) {
    const cur = currentEntry();
    const box = $('#advParty');
    if (!A.party.length) {
      box.replaceChildren(el('div', 'win-title', 'Party'), el('p', 'hint', 'No heroes yet.'));
      return;
    }
    const rows = A.party.map((h) => {
      const r = el('div', 'pm');
      r.dataset.hero = h.id;
      if (h.id === TT.me.id) r.classList.add('me');
      if (cur && cur.owner === h.id) r.classList.add('turn');
      if (h.hp <= 0) r.classList.add('down');
      if (h.defending) r.classList.add('defending');
      const name = el('span', 'pm-name');
      name.append(el('b', '', h.name), el('small', '', `Lv${h.level} ${h.clsName}`));
      const hp = el('span', 'pm-stat');
      hp.append(el('small', '', 'HP'), hpBar(h.hp, h.maxHp), el('span', 'pm-num', `${h.hp}/${h.maxHp}`));
      r.append(el('span', 'pm-cursor', '▶'), portrait(h.id, h.cls, 'xs'), name, hp);
      if (h.cls === 'wizard' || h.cls === 'cleric') {
        const sp = el('span', 'pm-stat sp');
        sp.append(el('small', '', 'SP'), el('span', 'pm-num', String(h.uses.slots)));
        sp.title = 'Spell slots left (refilled at the inn)';
        r.append(sp);
      }
      const seat = h.id !== TT.me.id && TT.seatCount() > 1 ? TT.localSeatFor(h.id) : null;
      if (seat) {
        r.classList.add('local');
        r.title = `Switch to ${h.name}`;
        r.onclick = () => TT.switchSeat(seat);
      }
      return r;
    });
    box.replaceChildren(el('div', 'win-title', 'Party'), ...rows);
  }

  // ---------- story window ----------
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
    const lastEl = log.lastElementChild;
    if (lastEl) lastEl.classList.add('fresh');
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  }

  // ---------- command window ----------
  function renderNow(A) {
    const me = TT.me;
    const mine = A.party.find((p) => p.id === me.id);
    const cur = currentEntry();
    const base = JSON.stringify([me.id, A.location.id, A.scene && A.scene.id, !!A.combat, cur && cur.id, !!mine]);
    if (base !== baseKey) { baseKey = base; stack = []; }
    const key = JSON.stringify([base, stack, A.ended && A.ended.at, dismissedEnd, A.combat, A.scene, A.actions, A.exits, A.myActions,
      targetId, A.party.map((p) => [p.id, p.hp, p.uses]), A.gold, A.inventory, TT.seatCount(), modalClosed]);
    if (key === nowKey) return;
    nowKey = key;

    let page;
    if (A.ended && dismissedEnd !== A.ended.at) page = endingCmd(A);
    else if (!mine) page = createCmd();
    else if (A.combat) page = combatCmd(A, mine, cur);
    else if (A.scene) page = sceneCmd(A, mine);
    else page = exploreCmd(A, mine);

    const box = $('#advNow');
    const menu = el('div', 'menu');
    menu.dataset.prio = '1';
    menu.append(...page.items);
    if (stack.length) menu.append(mi('Back', { cls: 'back', onClick: back }));
    const parts = [el('div', 'win-title', page.title)];
    if (page.who) parts.push(page.who);
    if (page.text) parts.push(el('p', 'cmd-text', page.text));
    parts.push(menu);
    parts.push(el('div', 'cmd-keys', stack.length ? '↑↓ choose · Enter confirm · Esc back' : '↑↓ choose · Enter confirm · Esc menu'));
    const prevIndex = box.querySelector('.menu') && box.querySelector('.menu').dataset.selIndex;
    box.replaceChildren(...parts);
    if (prevIndex && page.keepCursor) menu.dataset.selIndex = prevIndex;
    window.Menus.init(menu, !!page.keepCursor);
    // Hovering a target in the list highlights it in the scene too.
    menu.addEventListener('menuselect', (e) => {
      const id = e.detail && e.detail.dataset.foe;
      if (id && id !== targetId) { targetId = id; renderEnemies(A); renderStage(A); }
    });
  }

  function back() { stack.pop(); nowKey = ''; render(); }
  function push(entry) { stack.push(entry); nowKey = ''; render(); }

  function whoLine(mine) {
    const d = el('div', 'cmd-who');
    d.append(portrait(mine.id, mine.cls, 'xs'), el('b', '', mine.name), el('span', '', ` · Lv${mine.level} ${mine.clsName}`));
    if (TT.seatCount() > 1) d.title = 'Click a hero in the Party window to let someone else choose';
    return d;
  }

  function endingCmd(A) {
    const items = [mi('Keep exploring', { icon: 'map', onClick: () => { dismissedEnd = A.ended.at; nowKey = ''; render(); } })];
    if (TT.me.isDM) {
      items.push(mi('Start the adventure over', {
        icon: 'journal',
        onClick: () => { if (confirm('Start the adventure over? Heroes keep their names and classes but go back to level 1.')) TT.send({ t: 'adv:reset' }); },
      }));
    }
    return { title: A.ended.title, text: 'You finished the main quest! The Vale is still open: explore, finish side quests, or start again.', items };
  }

  function createCmd() {
    return {
      title: 'Welcome, adventurer',
      text: 'Create your hero to join the party.',
      items: [mi('Create my hero', { icon: 'fighter', onClick: () => { modalClosed = false; modalKey = ''; render(); } })],
    };
  }

  function sceneCmd(A, mine) {
    const items = A.scene.choices.map((c) => {
      const sub = [];
      if (c.check) sub.push(`${c.check.label} check · need ${c.check.dc}${c.check.bonus !== null ? ` · your bonus ${signed(c.check.bonus)}` : ''}`);
      return mi(c.label, {
        icon: c.check ? 'd20' : null,
        tag: c.cost ? `${c.cost} G` : null,
        sub: sub.join(''),
        disabled: c.cost > A.gold,
        onClick: () => TT.send({ t: 'adv:choose', index: c.index }),
      });
    });
    if (!A.scene.noLeave) items.push(mi('Leave', { cls: 'back', onClick: () => TT.send({ t: 'adv:choose', index: -1 }) }));
    return { title: A.scene.title, who: whoLine(mine), items };
  }

  function exploreCmd(A, mine) {
    const top = stack[stack.length - 1];
    if (top && top.type === 'travel') {
      return {
        title: 'Travel to…',
        who: whoLine(mine),
        items: A.exits.map((x) => {
          const node = A.world.nodes.find((n) => n.id === x.to);
          return mi(x.name, {
            icon: node ? node.icon : 'map',
            tag: x.ok ? (x.visited ? null : 'NEW') : 'LOCKED',
            tagCls: x.ok ? 'new' : 'lock',
            sub: x.ok ? (node && node.region) || '' : x.locked,
            onClick: () => (x.ok ? (stack = [], TT.send({ t: 'adv:travel', to: x.to })) : TT.toast(x.locked, true)),
          });
        }),
      };
    }
    if (top && top.type === 'potion') {
      return {
        title: `Healing potion (${potionsOf(A)} left)`,
        who: whoLine(mine),
        items: A.party.map((p) => mi(p.name, {
          tag: `${p.hp}/${p.maxHp}`,
          disabled: p.hp >= p.maxHp,
          sub: p.hp >= p.maxHp ? 'Already at full health' : 'Restores 2d4+2 HP',
          onClick: () => { stack = []; TT.send({ t: 'adv:use', item: 'potion', ally: p.id }); },
        })),
      };
    }
    const items = A.actions.map((a) => {
      const ico = a.kind === 'inn' ? 'inn' : a.kind === 'camp' ? 'camp' : a.kind === 'buy' ? (a.item || 'potion') : 'journal';
      return mi(a.label, { icon: ico, tag: a.cost ? `${a.cost} G` : null, disabled: a.cost > A.gold, onClick: () => TT.send({ t: 'adv:do', kind: a.kind, id: a.id, item: a.item }) });
    });
    items.push(mi('Travel', { icon: 'map', tag: '▸', sub: `${A.exits.length} road${A.exits.length === 1 ? '' : 's'} from here`, onClick: () => push({ type: 'travel' }) }));
    const hurt = A.party.some((p) => p.hp < p.maxHp);
    if (potionsOf(A) && hurt) items.push(mi('Use a potion', { icon: 'potion', tag: '▸', onClick: () => push({ type: 'potion' }) }));
    return { title: 'What will you do?', who: whoLine(mine), items, keepCursor: true };
  }

  function combatCmd(A, mine, cur) {
    const myTurn = cur && cur.owner === TT.me.id;
    if (!myTurn) {
      const who = cur ? cur.name : '…';
      const seat = cur && TT.localSeatFor(cur.owner);
      return {
        title: `Battle · Round ${TT.S.initiative.round}`,
        text: `Waiting for ${who} to act…`,
        items: seat && TT.seatCount() > 1 ? [mi(`Switch to ${who}`, { onClick: () => TT.switchSeat(seat) })] : [],
      };
    }
    const acts = A.myActions;
    const find = (id) => acts.find((a) => a.id === id);
    const living = A.combat.monsters.filter((m) => m.hp > 0);
    const top = stack[stack.length - 1];

    if (top && top.type === 'target') {
      const a = find(top.action);
      return {
        title: `${a ? a.label : 'Attack'}: choose a target`,
        who: whoLine(mine),
        items: living.map((m) => mi(m.name, {
          icon: m.icon, tag: `${m.hp}/${m.maxHp}`, sub: `AC ${m.ac}`, data: { foe: m.id },
          onClick: () => act(top.action, { target: m.id }),
        })),
      };
    }
    if (top && top.type === 'ally') {
      const a = find(top.action);
      return {
        title: `${a ? a.label : 'Heal'}: who?`,
        who: whoLine(mine),
        items: A.party.map((p) => mi(p.name, {
          tag: `${p.hp}/${p.maxHp}`, sub: p.hp <= 0 ? 'Down! This will revive them' : '',
          onClick: () => act(top.action, { ally: p.id }),
        })),
      };
    }
    const choose = (a) => {
      if (a.target === 'enemy') return () => push({ type: 'target', action: a.id });
      if (a.target === 'ally') return () => push({ type: 'ally', action: a.id });
      return () => act(a.id);
    };
    const usesTag = (a) => (a.uses === undefined ? null : `×${a.uses}`);
    if (top && top.type === 'skills') {
      const skills = acts.filter((a) => !['attack', 'potion', 'defend', 'flee'].includes(a.id));
      return {
        title: 'Skills',
        who: whoLine(mine),
        items: skills.map((a) => mi(a.label, { icon: ACTION_ICONS[a.id] || 'magic-missile', tag: usesTag(a), sub: a.desc, disabled: a.uses === 0, onClick: choose(a) })),
      };
    }
    if (top && top.type === 'items') {
      const p = find('potion');
      return {
        title: 'Items',
        who: whoLine(mine),
        items: [mi('Healing potion', { icon: 'potion', tag: `×${p ? p.uses : 0}`, sub: p ? p.desc : '', disabled: !p || !p.uses, onClick: p ? choose(p) : null })],
      };
    }
    const attack = find('attack');
    const items = [mi('Attack', { icon: mine.cls === 'rogue' ? 'backstab' : 'attack', sub: attack ? attack.desc : '', onClick: choose(attack) })];
    const skills = acts.filter((a) => !['attack', 'potion', 'defend', 'flee'].includes(a.id));
    if (skills.length) items.push(mi('Skills', { icon: ACTION_ICONS[skills[0].id] || 'magic-missile', tag: '▸', sub: skills.map((a) => a.label).join(', '), onClick: () => push({ type: 'skills' }) }));
    const potion = find('potion');
    items.push(mi('Items', { icon: 'potion', tag: '▸', sub: `${potion ? potion.uses : 0} healing potion${potion && potion.uses === 1 ? '' : 's'}`, onClick: () => push({ type: 'items' }) }));
    const defend = find('defend');
    if (defend) items.push(mi('Defend', { icon: 'defend', sub: defend.desc, onClick: () => act('defend') }));
    const flee = find('flee');
    if (flee) items.push(mi('Run away', { icon: 'flee', sub: flee.desc, onClick: () => act('flee') }));
    return { title: `${mine.name}'s turn!`, who: whoLine(mine), items };
  }

  // ---------- hero creation window ----------
  function renderModal(A) {
    const mine = A.party.find((p) => p.id === TT.me.id);
    const modal = $('#advModal');
    const show = !mine && !modalClosed && !menuOpen;
    modal.hidden = !show;
    if (!show) { modalKey = ''; return; }
    const key = `${TT.me.id}:${(TT.S.portraits || {})[TT.me.id] || ''}`;
    if (key === modalKey) return;
    modalKey = key;

    const win = el('div', 'win modal-win create');
    win.append(el('div', 'win-title', 'Create your hero'));
    const grid = el('div', 'create-grid');
    const menu = el('div', 'menu cls-menu');
    menu.dataset.prio = '3';
    const info = el('div', 'create-info');
    const pic = el('div', 'create-pic');
    const preview3d = use3d() ? el('div', 'hero-preview') : null;

    const showClass = (cls) => {
      createCls = cls;
      const c = A.classes.find((x) => x.id === cls);
      const desc = el('div', 'cls-detail');
      desc.append(el('h3', '', c.name), el('p', '', c.desc));
      const stats = el('div', 'cls-stats');
      for (const [k, v] of [['HP', c.hp], ['AC', c.ac], ['Weapon', c.weapon]]) { const s = el('span'); s.append(el('small', '', k), el('b', '', String(v))); stats.append(s); }
      desc.append(stats);
      info.firstChild ? info.replaceChild(desc, info.firstChild) : info.prepend(desc);
      if (preview3d) window.Preview3D.show(preview3d, cls);
      else if (!(TT.S.portraits && TT.S.portraits[TT.me.id])) pic.replaceChild(portrait(TT.me.id, cls, 'lg'), pic.firstChild);
    };
    for (const c of A.classes) {
      const b = mi(c.name, { icon: c.id, onClick: () => join() });
      b.dataset.cls = c.id;
      b.style.setProperty('--c', CLASS_COLORS[c.id]);
      menu.append(b);
    }
    menu.addEventListener('menuselect', (e) => { if (e.detail && e.detail.dataset.cls) showClass(e.detail.dataset.cls); });

    pic.append(preview3d || portrait(TT.me.id, createCls, 'lg'));
    const up = el('label', 'btn small', TT.S.portraits && TT.S.portraits[TT.me.id] ? 'Change picture' : 'Add a picture');
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
    name.onkeydown = (e) => { if (e.key === 'Enter') join(); };
    const label = el('label', 'field', 'Hero name');
    label.append(name);
    const join = () => {
      TT.send({ t: 'adv:create', name: name.value.trim() || TT.seatName(), cls: createCls });
      draftName = '';
    };
    const row = el('div', 'row wrap');
    row.append(button('Join the party', 'btn primary', join), button('Later', 'btn ghost', () => { modalClosed = true; nowKey = ''; render(); }));
    info.append(el('div'), label, row);
    grid.append(menu, pic, info);
    win.append(grid);
    if (TT.seatCount() > 1) win.append(el('p', 'hint', `Making a hero for ${TT.seatName()}.`));
    win.append(el('p', 'cmd-keys', '↑↓ choose a class · type a name · Enter to join'));
    modal.replaceChildren(win);
    const idx = Math.max(0, A.classes.findIndex((c) => c.id === createCls));
    menu.dataset.selIndex = String(idx);
    window.Menus.init(menu);
    showClass(createCls);
  }

  // ---------- main menu ----------
  const PAGES = [
    ['items', 'Items', 'potion'], ['status', 'Status', 'fighter'], ['quests', 'Quests', 'journal'], ['map', 'Map', 'map'],
    ['chat', 'Chat', 'inn'], ['players', 'Players', 'level'], ['settings', 'Settings', 'd20'], ['help', 'How to play', 'choir-note'],
  ];

  function openMenu(page) {
    if (page) menuPage = page;
    menuOpen = true;
    $('#advMenu').hidden = false;
    if (weather) weather.pause(true); // hidden behind the menu anyway
    FX.sfx('open');
    render();
  }
  function closeMenu() {
    menuOpen = false;
    $('#advMenu').hidden = true;
    if (weather) weather.pause(false);
    $('#advMenuList').dataset.built = '';
    nowKey = '';
    render();
  }
  $('#advMenuBtn').onclick = () => (menuOpen ? closeMenu() : openMenu());
  $('#advMenu').addEventListener('click', (e) => { if (e.target.id === 'advMenu') closeMenu(); });

  function renderMenu(A) {
    const list = $('#advMenuList');
    const unread = unreadChat();
    const sig = `${menuPage}:${unread}`;
    if (list.dataset.built !== sig) {
      list.dataset.built = sig;
      const items = PAGES.map(([id, label, ico]) => {
        const b = mi(label, { icon: ico, tag: id === 'chat' && unread ? String(unread) : null, tagCls: 'badge-tag', cls: id === menuPage ? 'current' : '', onClick: () => { menuPage = id; list.dataset.built = ''; render(); } });
        b.dataset.page = id;
        return b;
      });
      items.push(mi('Leave game', { cls: 'danger', onClick: () => { if (confirm('Leave this game? You can rejoin later with the same code.')) { closeMenu(); TT.leave(); } } }));
      items.push(mi('Close', { cls: 'back', onClick: closeMenu }));
      list.replaceChildren(...items);
      list.dataset.selIndex = String(Math.max(0, PAGES.findIndex(([id]) => id === menuPage)));
      window.Menus.init(list);
    }
    $$('#advMenuPage > [data-page]').forEach((p) => { p.hidden = p.dataset.page !== menuPage; });
    const page = $(`#advMenuPage > [data-page="${menuPage}"]`);
    ({ items: pageItems, status: pageStatus, quests: pageQuests, map: pageMap, chat: pageChat, players: pagePlayers, settings: pageSettings, help: pageHelp })[menuPage](page, A);
  }

  const pageHead = (title, sub) => { const h = el('div', 'page-head'); h.append(el('h2', '', title)); if (sub) h.append(el('p', 'hint', sub)); return h; };

  function pageItems(page, A) {
    const rows = A.inventory.map((i) => {
      const r = el('div', 'item-row');
      const txt = el('div', 'grow');
      txt.append(el('b', '', i.name), el('p', '', i.desc));
      r.append(icon(i.icon, 'item-ico'), txt, el('span', 'item-n', `×${i.n}`));
      if (i.id === 'potion' && !A.combat) {
        const hurt = A.party.filter((p) => p.hp < p.maxHp);
        if (hurt.length) {
          const pick = el('div', 'use-row');
          for (const p of hurt) pick.append(button(`Use on ${p.name} (${p.hp}/${p.maxHp})`, 'btn small', () => TT.send({ t: 'adv:use', item: 'potion', ally: p.id })));
          txt.append(pick);
        }
      }
      return r;
    });
    page.replaceChildren(pageHead('Items', `Party gold: ${A.gold} G`), ...(rows.length ? rows : [el('p', 'hint', 'Your pack is empty.')]));
  }

  function pageStatus(page, A) {
    if (!A.party.length) { page.replaceChildren(pageHead('Status'), el('p', 'hint', 'No heroes yet.')); return; }
    if (!A.party.some((p) => p.id === statusHero)) statusHero = (A.party.find((p) => p.id === TT.me.id) || A.party[0]).id;
    const h = A.party.find((p) => p.id === statusHero);
    const sheet = (TT.S.sheets || {})[h.id] || {};
    const tabs = el('div', 'hero-tabs');
    for (const p of A.party) tabs.append(button([portrait(p.id, p.cls, 'xs'), p.name], `hero-tab${p.id === h.id ? ' on' : ''}`, () => { statusHero = p.id; render(); }));
    const card = el('div', 'status-card');
    const left = el('div', 'status-left');
    left.append(portrait(h.id, h.cls, 'lg'));
    if (h.id === TT.me.id) {
      const up = el('label', 'btn small', TT.S.portraits && TT.S.portraits[h.id] ? 'Change picture' : 'Add a picture');
      const file = el('input');
      file.type = 'file';
      file.accept = 'image/*';
      file.hidden = true;
      file.onchange = () => { if (file.files[0]) TT.uploadPortrait(file.files[0]); file.value = ''; };
      up.append(file);
      left.append(up);
    }
    const right = el('div', 'status-right');
    right.append(el('h3', '', h.name), el('p', 'status-cls', `Level ${h.level} ${h.clsName}`));
    const stat = (label, value, barEl) => { const r = el('div', 'stat-row'); r.append(el('span', 'stat-k', label), barEl || el('span'), el('b', 'stat-v', value)); return r; };
    right.append(stat('HP', `${h.hp} / ${h.maxHp}`, hpBar(h.hp, h.maxHp)));
    right.append(stat('XP', h.nextXp ? `${h.xp} / ${h.nextXp}` : `${h.xp} (max)`, hpBar(h.nextXp ? h.xp : 1, h.nextXp || 1, 'xp')));
    right.append(stat('Armor', String(h.ac)));
    if (h.cls === 'wizard' || h.cls === 'cleric') right.append(stat('Spell slots', String(h.uses.slots)));
    if (h.cls === 'fighter') right.append(stat('Second Wind', h.uses.secondWind ? 'Ready' : 'Used'));
    const ab = el('div', 'abil-grid');
    for (const [k, label] of ABIL) {
      const score = Number(sheet[k]) || 10;
      const c = el('div', 'abil');
      c.append(el('small', '', label), el('b', '', signed(Math.floor((score - 10) / 2))), el('span', '', String(score)));
      ab.append(c);
    }
    right.append(ab);
    if (sheet.notes) right.append(el('p', 'status-notes', sheet.notes));
    card.append(left, right);
    page.replaceChildren(pageHead('Status'), tabs, card);
  }

  function pageQuests(page, A) {
    const quests = A.journal.slice().sort((a, b) => a.done - b.done);
    const rows = quests.map((q) => {
      const d = el('div', `quest${q.done ? ' done' : ''}`);
      d.append(el('b', '', `${q.done ? '✓ ' : '◆ '}${q.title}`), el('p', '', q.text));
      return d;
    });
    page.replaceChildren(pageHead('Quests', 'Talk to people to find more.'), ...(rows.length ? rows : [el('p', 'hint', 'No quests yet. Talk to people!')]));
  }

  function pageMap(page, A) {
    const three = use3d();
    $('#advBoard3dWrap').hidden = !three;
    $('#advBoard2d').hidden = three;
    const pick = (id) => {
      const exit = A.exits.find((x) => x.to === id);
      if (A.location.id === id) return TT.toast(`You are in ${A.location.name}.`);
      if (A.combat) return TT.toast('Finish the fight first!', true);
      if (!exit) return TT.toast('You can\'t get there from here. Follow the roads.', true);
      if (!exit.ok) return TT.toast(exit.locked, true);
      if (!A.party.some((p) => p.id === TT.me.id)) return TT.toast('Create your hero first.', true);
      TT.send({ t: 'adv:travel', to: id });
      closeMenu();
    };
    if (three) { window.Board3D.update($('#advBoard3d'), $('#advBoardLabels'), A, { meId: TT.me.id, pick }); return; }
    drawBoard2d(A, pick);
  }

  function drawBoard2d(A, pick) {
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
      const b = button([el('span', 'pin-medal'), el('span', 'pin-name', n.visited ? n.name : `${n.name}?`)], `pin${n.visited ? ' visited' : ' unknown'}${n.here ? ' here' : ''}${canGo ? ' go' : ''}${exit && !exit.ok ? ' locked' : ''}`, () => pick(n.id));
      b.firstChild.append(icon(n.icon));
      if (n.here) b.append(el('span', 'pin-here', 'You are here'));
      b.style.left = `${n.x}%`;
      b.style.top = `${(n.y / 70) * 100}%`;
      pieces.push(b);
    }
    board.replaceChildren(...pieces);
  }

  // The chat lives in the sidebar in tabletop mode; in adventure mode it moves into the menu.
  function placeChat(adventure) {
    const panel = $('.panel[data-panel="chat"]');
    if (!panel) return;
    const target = adventure ? $('#advChatPage') : $('.side');
    if (panel.parentElement !== target) {
      if (adventure) { target.append(panel); panel.hidden = false; } else { $('.side').insertBefore(panel, $('.side .panel[data-panel="sheet"]')); }
    }
  }
  function chatMessages() { return ((TT.S && TT.S.chat) || []).filter((m) => m.kind === 'chat' && m.from !== TT.me.id); }
  function unreadChat() {
    const msgs = chatMessages();
    const i = msgs.findIndex((m) => m.id === lastChatSeen);
    return i < 0 ? (lastChatSeen ? msgs.length : 0) : msgs.length - i - 1;
  }
  function renderChatBadge() {
    if (menuOpen && menuPage === 'chat') {
      const msgs = chatMessages();
      if (msgs.length) { lastChatSeen = msgs[msgs.length - 1].id; store.set('dnd.chatSeen', lastChatSeen); }
    } else if (!lastChatSeen) {
      // first visit: everything so far counts as read
      const msgs = chatMessages();
      if (msgs.length) { lastChatSeen = msgs[msgs.length - 1].id; store.set('dnd.chatSeen', lastChatSeen); }
    }
    const n = unreadChat();
    const badge = $('#advChatBadge');
    badge.hidden = !n;
    badge.textContent = String(n);
  }
  function pageChat(page) {
    if (!page.querySelector('.page-head')) page.prepend(pageHead('Chat', 'Talk to your party. Type /help for dice commands.'));
    renderChatBadge();
  }

  function pagePlayers(page) {
    const S = TT.S;
    const invite = el('div', 'invite');
    invite.append(el('small', '', 'Game code'), el('b', 'code-big', TT.roomCode), button('Copy invite link', 'btn primary', () => TT.copyInvite()));
    const online = el('div', 'player-list');
    for (const p of S.players) {
      const r = el('div', `player${p.online ? ' on' : ''}`);
      r.append(el('span', 'dot'), el('span', 'grow', p.name), p.isDM ? el('span', 'role', 'Host') : el('span'));
      online.append(r);
    }
    const seats = el('div', 'player-list');
    for (const s of TT.seats()) {
      const r = el('div', `player device-seat${s.active ? ' active' : ''}`);
      r.append(el('span', 'grow', `${s.name}${s.active ? ' (playing now)' : ''}`));
      if (!s.active) r.append(button('Switch', 'btn small', () => TT.switchSeat(s.pid)));
      if (!s.main) r.append(button('Remove', 'btn ghost small', () => { if (confirm(`Remove ${s.name} from this device?`)) TT.removeSeat(s.pid); }));
      seats.append(r);
    }
    const follow = el('label', 'check');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = TT.followTurns;
    cb.onchange = () => TT.setFollowTurns(cb.checked);
    follow.append(cb, 'Switch players automatically on each battle turn');
    const actions = el('div', 'row wrap');
    actions.append(button('+ Add a player on this device', 'btn', () => TT.addSeat()), button('Change my name', 'btn ghost', () => TT.rename()));
    page.replaceChildren(
      pageHead('Players', 'Invite friends to play from their own devices, or add players who share this screen.'),
      invite, el('h3', '', 'In this game'), online, el('h3', '', 'On this device'), seats, actions, follow,
    );
  }

  function pageSettings(page) {
    const toggle = (label, on, set, hint) => {
      const r = el('div', 'setting');
      const t = el('div', 'grow');
      t.append(el('b', '', label));
      if (hint) t.append(el('p', 'hint', hint));
      const sw = button(on ? 'ON' : 'OFF', `switch${on ? ' on' : ''}`, () => { set(!on); render(); });
      sw.setAttribute('aria-pressed', String(on));
      r.append(t, sw);
      return r;
    };
    const rows = [toggle('Sound effects', !FX.muted, (v) => FX.setMuted(!v), 'Dice, hits, spells, coins and menu sounds.')];
    if (window.Board3D) rows.push(toggle('3D graphics', use3d(), (v) => { store.set('dnd.3d', v ? '1' : '0'); nowKey = ''; }, '3D world map, battles and dice. Turn off on slower computers.'));
    rows.push(toggle('Auto-switch players in battle', TT.followTurns, (v) => TT.setFollowTurns(v), 'When several players share this screen.'));
    page.replaceChildren(pageHead('Settings'), ...rows);
  }

  function pageHelp(page) {
    const p = (t) => el('p', '', t);
    const credits = el('p', 'hint credits');
    const a = el('a', '', 'Art & model credits');
    a.href = '/art/CREDITS.md';
    a.target = '_blank';
    credits.append(a);
    page.replaceChildren(
      pageHead('How to play'),
      el('h3', '', 'Commands'),
      p('The Command window (right) lists what you can do. Move the ▶ cursor with ↑ ↓ or your mouse, and press Enter or click to choose. Esc goes back, or opens this menu.'),
      el('h3', '', 'Skill checks'),
      p('Choices with a d20 are checks: the game rolls a d20 and adds the bonus of the hero who chooses. Reach the number shown to succeed, so let the best hero try.'),
      el('h3', '', 'Battles'),
      p('Heroes take turns. On your turn pick Attack and a target, a Skill, an Item, Defend or Run. The game plays the monsters.'),
      el('h3', '', 'Resting'),
      p('Rest at an inn to recover HP and spells. Camping heals half your HP, but something may find you.'),
      el('h3', '', 'Sharing one screen'),
      p('Add players in Menu → Players. Click a hero in the Party window to switch who is choosing.'),
      credits,
    );
  }

  // ---------- keyboard: Esc goes back, or opens/closes the menu ----------
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || $('#adventure').hidden) return;
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { a.blur(); return; }
    e.preventDefault();
    if (!$('#advModal').hidden) { modalClosed = true; nowKey = ''; FX.sfx('back'); render(); return; }
    if (menuOpen) { FX.sfx('back'); closeMenu(); return; }
    if (stack.length) { FX.sfx('back'); back(); return; }
    openMenu();
  });

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
})();
