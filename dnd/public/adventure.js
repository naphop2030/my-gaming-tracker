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
  const ACTION_ICONS = {
    'second-wind': 'second-wind', 'fire-bolt': 'fire-bolt', 'magic-missile': 'magic-missile', 'sacred-flame': 'sacred-flame', 'cure-wounds': 'cure-wounds',
    potion: 'potion', defend: 'defend', flee: 'flee', 'action-surge': 'attack', 'shield-bash': 'defend', hide: 'rogue', 'poison-blade': 'backstab',
    'burning-hands': 'fire-bolt', sleep: 'magic-missile', fireball: 'fire-bolt', bless: 'sacred-flame', 'spirit-weapon': 'sacred-flame', 'mass-cure': 'cure-wounds',
  };
  const ABIL = [['str', 'STR'], ['dex', 'DEX'], ['con', 'CON'], ['int', 'INT'], ['wis', 'WIS'], ['cha', 'CHA']];

  // ---------- settings ----------
  const use3d = () => !!window.Board3D && store.get('dnd.3d') !== '0';
  // Look settings: calm mode (less motion) and text size, applied to the whole page.
  const calm = () => store.get('dnd.calm') === '1';
  function applyLook() {
    document.documentElement.classList.toggle('calm', calm());
    document.documentElement.style.setProperty('--ts', store.get('dnd.textSize') || '1');
  }
  applyLook();
  window.addEventListener('three-ready', () => { nowKey = ''; render(); });
  window.addEventListener('three-lost', () => {
    if (store.get('dnd.3d') === '0') return;
    store.set('dnd.3d', '0');
    TT.toast('3D graphics stopped working on this computer, so the game switched to 2D. You can turn 3D back on in Settings.', true);
    nowKey = '';
    render();
  });

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
  const STATUS_ICONS = { poison: '☠', sleep: 'Zz', stun: '✶', hidden: '◐', spirit: '⚒' };
  function statusBadges(list, blessed) {
    const box = el('span', 'status-badges');
    for (const st of list || []) {
      const b = el('span', `st st-${st.id}`, `${STATUS_ICONS[st.id] || ''} ${st.label}${st.turns ? ` ${st.turns}` : ''}`);
      box.append(b);
    }
    if (blessed) box.append(el('span', 'st st-bless', '✦ Blessed'));
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
    renderTurns(A);
    renderFoes2d(A);
    renderParty(A);
    renderLog(A);
    renderNow(A);
    renderDiceTray(A);
    renderModal(A);
    renderChatBadge();
    if (menuOpen) renderMenu(A);
    playNewEffects(S, A);
    pickMusic(A);
  }
  window.renderAdventure = render;

  // Background music follows the action.
  const REGION_MUSIC = { village: 'town', forest: 'wild', hills: 'wild', crossroads: 'wild', ruins: 'wild', marsh: 'dark', underground: 'dark', abbey: 'dark' };
  function pickMusic(A) {
    if (!window.Music) return;
    let theme;
    if (A.combat) theme = A.combat.monsters.some((m) => m.boss && m.hp > 0 && m.key === 'priest') ? 'boss' : 'battle';
    else theme = A.location.music || REGION_MUSIC[String(A.location.region || '').toLowerCase()] || 'wild';
    if (!A.combat && A.ambience === 'clear' && theme !== 'dark') theme = theme === 'town' ? 'town' : 'clear';
    window.Music.play(theme);
  }

  // Reconnecting notice (the top bar is hidden in adventure mode).
  new MutationObserver(() => { $('#advConn').textContent = $('#conn').textContent; }).observe($('#conn'), { childList: true, characterData: true, subtree: true });

  // ---------- scene & weather ----------
  // Arrival card: the place's living painting full-screen with its name, like a loading screen.
  let arrivedAt = null;
  let arriveTimer = null;
  function showArrival(A) {
    const L = A.location;
    const mood = A.ambience === 'clear' ? 'clear' : 'ash';
    let card = $('#advArrive');
    if (!card) {
      card = el('div', 'arrive');
      card.id = 'advArrive';
      card.addEventListener('click', () => hideArrival());
      $('#adventure').append(card);
    }
    const art = el('div', 'arrive-art');
    if (L.image) { const img = el('img'); img.src = L.image; img.alt = ''; art.append(img); } else {
      const sceneId = window.SCENES && window.SCENES[L.scene] ? L.scene : 'default';
      if (window.SCENES) art.innerHTML = `<div class="scene-pan">${window.SCENES[sceneId](mood)}${window.SCENE_LIFE ? window.SCENE_LIFE(sceneId, mood) : ''}</div>`; // our own SVG
    }
    const text = el('div', 'arrive-text');
    text.append(el('div', 'arrive-region', L.region || ''), el('h2', 'arrive-name', L.name), L.tagline ? el('div', 'arrive-tag', L.tagline) : '');
    const danger = el('div', `arrive-danger d${L.danger || 0}`, dangerText(L.danger || 0));
    text.append(danger);
    if (A.combat) text.append(el('div', 'arrive-ambush', 'Ambush!'));
    card.replaceChildren(art, text, el('div', 'arrive-skip', 'click to continue'));
    card.hidden = false;
    card.classList.remove('out');
    void card.offsetWidth;
    card.classList.add('in');
    clearTimeout(arriveTimer);
    arriveTimer = setTimeout(hideArrival, (A.combat ? 1500 : 2300) / (FX.speed || 1));
  }
  function hideArrival() {
    const card = $('#advArrive');
    if (!card || card.hidden || card.classList.contains('out')) return;
    clearTimeout(arriveTimer);
    card.classList.add('out');
    setTimeout(() => { card.hidden = true; card.classList.remove('in', 'out'); card.replaceChildren(); }, 450);
  }

  function renderScene(A) {
    if (A.location.id !== arrivedAt) { arrivedAt = A.location.id; showArrival(A); }
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
        const sceneId = window.SCENES && window.SCENES[A.location.scene] ? A.location.scene : 'default';
        const lifeSvg = window.SCENE_LIFE ? window.SCENE_LIFE(sceneId, mood) : '';
        // our own generated SVG, no user content; the painting slowly pans, the life layer moves on top
        box.innerHTML = draw ? `<div class="scene-pan">${draw(mood)}${lifeSvg}</div>` : '';
      }
      requestAnimationFrame(() => box.classList.add('show'));
    }
    if (!weather) weather = new FX.Weather($('#advWeather'));
    weather.set(A.location.effect === 'drips' ? ['drips'] : [A.ambience, A.location.effect]);
  }

  // 3D battle stage replaces the picture during fights.
  let stageWasOn = false;
  let stageHoldUntil = 0;
  let holdTimer = null;
  function holdStage(ms) {
    const until = Date.now() + ms / (FX.speed || 1);
    if (until <= stageHoldUntil) return;
    stageHoldUntil = until;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(render, until - Date.now() + 20);
  }
  function releaseStage() {
    if (!stageHoldUntil) return;
    stageHoldUntil = 0;
    clearTimeout(holdTimer);
    render();
  }
  function renderStage(A) {
    const on = !!(A.combat && use3d() && A.party.length);
    const box = $('#advStage3d');
    // When a fight ends, keep the stage up so the victory cheer and camera orbit show.
    if (on) stageWasOn = true;
    else if (stageWasOn) { stageWasOn = false; if (!A.combat && !A.ended) holdStage(2500); }
    const linger = !on && use3d() && Date.now() < stageHoldUntil;
    box.hidden = !on && !linger;
    $('#adventure').classList.toggle('in-battle', !!A.combat || linger);
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
      if (m.status && m.status.length) r.append(statusBadges(m.status));
      r.title = m.hp > 0 ? `${m.name} · AC ${m.ac} · click to target` : m.name;
      r.onclick = () => chooseTarget(A, m.id);
      return r;
    });
    box.replaceChildren(el('div', 'win-title', `Enemies · Round ${TT.S.initiative.round}`), ...rows);
  }

  // ---------- turn order (who acts now, who's next) ----------
  function renderTurns(A) {
    const box = $('#advTurns');
    box.hidden = !A.combat;
    if (!A.combat) return;
    const init = TT.S.initiative;
    const list = init.list;
    const start = Math.max(0, list.findIndex((e) => e.id === init.current));
    const chips = [];
    for (let k = 0; k < list.length && chips.length < 8; k++) {
      const e = list[(start + k) % list.length];
      const pc = A.party.find((p) => p.id === e.owner);
      const mon = !e.owner && A.combat.monsters.find((m) => m.id === e.ref);
      if ((pc && pc.hp <= 0) || (mon && mon.hp <= 0) || (!pc && !mon)) continue;
      const chip = el('span', `turn-chip${chips.length === 0 ? ' now' : ''}${pc ? ' pc' : ' npc'}`);
      if (chips.length === 0) chip.append(el('b', 'turn-now', 'NOW'));
      chip.append(pc ? portrait(pc.id, pc.cls, 'xs') : icon(mon.icon, 'sm'), el('span', '', e.name));
      chips.push(chip);
    }
    box.replaceChildren(...chips);
  }

  // ---------- monsters standing in the scene (2D mode) ----------
  function renderFoes2d(A) {
    const box = $('#advFoes2d');
    const on = !!(A.combat && !use3d());
    box.hidden = !on;
    if (!on) return;
    box.replaceChildren(...A.combat.monsters.map((m) => {
      const b = el('button', `standee${m.hp <= 0 ? ' dead' : ''}${m.id === targetId && m.hp > 0 ? ' target' : ''}${m.boss ? ' boss' : ''}`);
      b.type = 'button';
      b.dataset.foe = m.id;
      const art = el('div', 'standee-art');
      art.append(icon(m.icon, 'standee-ico'));
      const tag = el('div', 'standee-tag');
      tag.append(el('b', '', m.name), hpBar(m.hp, m.maxHp));
      if (m.status && m.status.length) tag.append(statusBadges(m.status));
      b.append(art, el('div', 'standee-base'), tag);
      b.title = m.hp > 0 ? `${m.name} · AC ${m.ac} · click to target` : `${m.name} (defeated)`;
      b.onclick = () => chooseTarget(A, m.id);
      return b;
    }));
  }

  // ---------- victory spoils ----------
  function showSpoils(data, A) {
    const modal = $('#advSpoils');
    const win = el('div', 'win modal-win spoils');
    win.append(el('div', 'win-title', 'Victory!'));
    const rows = el('div', 'spoils-rows');
    if (data.xp) {
      const xp = el('div', 'spoil');
      xp.append(icon('level', 'spoil-ico'), el('b', '', `+${data.xp} XP`), el('span', '', 'for each hero'));
      rows.append(xp);
      for (const h of A.party) {
        const r = el('div', 'spoil-hero');
        r.append(portrait(h.id, h.cls, 'xs'), el('span', 'grow', `${h.name} · Lv${h.level}`), hpBar(h.nextXp ? h.xp : 1, h.nextXp || 1, 'xp'), el('small', '', h.nextXp ? `${h.xp}/${h.nextXp}` : 'MAX'));
        rows.append(r);
      }
    }
    if (data.gold) { const g = el('div', 'spoil'); g.append(icon('gold', 'spoil-ico'), el('b', '', `+${data.gold} gold`)); rows.append(g); }
    for (const it of data.items) { const g = el('div', 'spoil'); g.append(icon(it.icon || 'potion', 'spoil-ico'), el('b', '', `${it.name}${it.n > 1 ? ` ×${it.n}` : ''}`), el('span', '', 'found')); rows.append(g); }
    for (const lv of data.levels) {
      const g = el('div', 'spoil level-up');
      g.append(icon('level', 'spoil-ico'), el('b', '', `${lv.name} reached level ${lv.level}!`), el('span', '', lv.learned ? `New: ${lv.learned}` : ''));
      rows.append(g);
    }
    if (!rows.children.length) rows.append(el('p', 'hint', 'The way is clear.'));
    const menu = el('div', 'menu');
    menu.dataset.prio = '4';
    menu.append(mi('Continue', { onClick: () => { modal.hidden = true; releaseStage(); } }));
    win.append(rows, menu);
    modal.replaceChildren(win);
    modal.hidden = false;
    window.Menus.init(menu, false);
  }
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
      if ((h.status && h.status.length) || h.blessed) name.append(statusBadges(h.status, h.blessed));
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
      targetId, A.party.map((p) => [p.id, p.hp, p.uses]), A.gold, A.inventory, TT.seatCount(), modalClosed, A.pending]);
    if (key === nowKey) return;
    nowKey = key;

    let page;
    if (A.ended && dismissedEnd !== A.ended.at) page = endingCmd(A);
    else if (!mine) page = createCmd();
    else if (A.pending) page = rollCmd(A);
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

  // A d20 waiting for its player to roll it.
  function rollCmd(A) {
    const p = A.pending;
    const mineRoll = p.owner === TT.me.id;
    const what = p.kind === 'check' ? `${p.label} check · need ${p.dc}${p.bonus !== null ? ` · your bonus ${signed(p.bonus)}` : ''}` : `${p.label}${p.target ? ` · ${p.target}` : ''}`;
    if (mineRoll) return { title: 'Your roll!', text: what, items: [mi('Roll the d20', { icon: 'd20', sub: 'Click, or press Enter', onClick: rollDie })] };
    const seat = TT.localSeatFor(p.owner);
    const items = [];
    if (seat && TT.seatCount() > 1) items.push(mi(`Switch to ${p.ownerName}`, { onClick: () => TT.switchSeat(seat) }));
    if (TT.me.isDM) items.push(mi(`Roll for ${p.ownerName}`, { icon: 'd20', onClick: rollDie }));
    return { title: `${p.ownerName}'s roll`, text: `Waiting for ${p.ownerName} to roll: ${what}`, items };
  }
  function rollDie() { TT.send({ t: 'adv:roll' }); }

  // The big die over the scene, for whoever has to roll.
  function renderDiceTray(A) {
    let tray = $('#advDiceTray');
    const p = A.pending;
    const show = p && (p.owner === TT.me.id) && !menuOpen;
    if (!show) { if (tray) tray.hidden = true; return; }
    if (!tray) {
      tray = el('button', 'dice-tray');
      tray.id = 'advDiceTray';
      tray.type = 'button';
      tray.addEventListener('click', () => { tray.hidden = true; rollDie(); });
      $('#advStageWrap').append(tray);
    }
    const sig = JSON.stringify(p);
    if (tray.dataset.sig !== sig || tray.hidden) {
      tray.dataset.sig = sig;
      const what = p.kind === 'check' ? `${p.label} · need ${p.dc}` : `${p.label}${p.target ? `: ${p.target}` : ''}`;
      tray.replaceChildren(icon('d20', 'dice-tray-die'), el('b', '', 'Click to roll!'), el('small', '', what));
      tray.hidden = false;
    }
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
    const S = A.stats || {};
    const recap = [`${S.wins || 0} battles won`, `${S.kills || 0} foes defeated`, `${S.crits || 0} critical hits`, `${S.gold || 0} gold earned`, `${(A.bestiary || []).length} kinds of creature met`].join(' · ');
    return { title: A.ended.title, text: `A chapter of your story ends here. ${recap}. The world is still open: explore, finish other quests, fill the Bestiary, or start again.`, items };
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

  function dangerText(n) {
    return n ? `Danger ${'★'.repeat(n)}${'☆'.repeat(Math.max(0, 4 - n))}` : 'Safe';
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
            sub: x.ok ? [(node && node.region) || '', dangerText(x.danger)].filter(Boolean).join(' · ') : x.locked,
            onClick: () => (x.ok ? (stack = [], TT.send({ t: 'adv:travel', to: x.to })) : TT.toast(x.locked, true)),
          });
        }),
      };
    }
    if (top && top.type === 'coach') {
      return {
        title: `Coach · ${A.coachPrice} G`,
        who: whoLine(mine),
        items: A.coach.map((x) => mi(x.name, {
          icon: 'map', tag: `${A.coachPrice} G`, sub: x.region, disabled: A.gold < A.coachPrice,
          onClick: () => { stack = []; TT.send({ t: 'adv:do', kind: 'coach', to: x.to }); },
        })),
      };
    }
    if (top && top.type === 'shop') {
      return {
        title: `Shop · ${A.gold} G`,
        who: whoLine(mine),
        items: A.shop.map((it) => mi(it.name, {
          icon: it.icon, tag: `${it.price} G`, sub: [it.stats, it.desc].filter(Boolean).join(' · '), disabled: it.price > A.gold,
          onClick: () => TT.send({ t: 'adv:do', kind: 'buy', item: it.id }),
        })),
        keepCursor: true,
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
    if (A.shop && A.shop.length) items.push(mi('Shop', { icon: 'inn', tag: '▸', sub: A.shop.map((i) => i.name).join(', '), onClick: () => push({ type: 'shop' }) }));
    items.push(mi('Travel', { icon: 'map', tag: '▸', sub: `${A.exits.length} road${A.exits.length === 1 ? '' : 's'} from here`, onClick: () => push({ type: 'travel' }) }));
    if (A.coach && A.coach.length) items.push(mi('Take the coach', { icon: 'map', tag: '▸', sub: `To ${A.coach.map((x) => x.name).join(', ')}`, onClick: () => push({ type: 'coach' }) }));
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
      const skills = acts.filter((a) => a.skill);
      return {
        title: 'Skills',
        who: whoLine(mine),
        items: skills.map((a) => mi(a.label, { icon: ACTION_ICONS[a.id] || 'magic-missile', tag: usesTag(a), sub: a.desc, disabled: a.uses === 0, onClick: choose(a) })),
      };
    }
    if (top && top.type === 'items') {
      const its = acts.filter((a) => a.item);
      const invById = Object.fromEntries(A.inventory.map((i) => [i.id, i]));
      return {
        title: 'Items',
        who: whoLine(mine),
        items: its.length ? its.map((a) => mi(a.label, { icon: (invById[a.id.slice(5)] || {}).icon || 'potion', tag: `×${a.uses}`, sub: a.desc, onClick: choose(a) })) : [mi('No usable items', { disabled: true })],
      };
    }
    const attack = find('attack');
    const items = [mi('Attack', { icon: mine.cls === 'rogue' ? 'backstab' : 'attack', sub: attack ? attack.desc : '', onClick: choose(attack) })];
    const skills = acts.filter((a) => a.skill);
    if (skills.length) items.push(mi('Skills', { icon: ACTION_ICONS[skills[0].id] || 'magic-missile', tag: '▸', sub: skills.map((a) => a.label).join(', '), onClick: () => push({ type: 'skills' }) }));
    const its = acts.filter((a) => a.item);
    items.push(mi('Items', { icon: 'potion', tag: '▸', sub: its.length ? its.map((a) => `${a.label} ×${a.uses}`).join(', ') : 'Nothing usable', onClick: () => push({ type: 'items' }) }));
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
      if (c.learns) desc.append(el('p', 'cls-learns', `Learns: ${c.learns.join(' · ')}`));
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
    ['items', 'Items', 'potion'], ['status', 'Status', 'fighter'], ['quests', 'Quests', 'journal'], ['bestiary', 'Bestiary', 'skull'], ['map', 'Map', 'map'],
    ['chat', 'Chat', 'inn'], ['players', 'Players', 'level'], ['settings', 'Settings', 'd20'], ['help', 'How to play', 'choir-note'],
  ];

  function openMenu(page) {
    if (page) menuPage = page;
    menuOpen = true;
    $('#advMenu').hidden = false;
    if (weather) weather.pause(true); // hidden behind the menu anyway
    $('#adventure').classList.add('menu-open');
    FX.sfx('open');
    render();
  }
  function closeMenu() {
    menuOpen = false;
    $('#advMenu').hidden = true;
    if (weather) weather.pause(false);
    $('#adventure').classList.remove('menu-open');
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
    ({ items: pageItems, status: pageStatus, quests: pageQuests, bestiary: pageBestiary, map: pageMap, chat: pageChat, players: pagePlayers, settings: pageSettings, help: pageHelp })[menuPage](page, A);
  }

  const pageHead = (title, sub) => { const h = el('div', 'page-head'); h.append(el('h2', '', title)); if (sub) h.append(el('p', 'hint', sub)); return h; };

  function pageItems(page, A) {
    const section = (title, list) => { const d = el('div', 'item-section'); d.append(el('h3', '', title), ...list); return d; };
    const row = (i, extra) => {
      const r = el('div', 'item-row');
      const txt = el('div', 'grow');
      txt.append(el('b', '', i.name));
      if (i.stats) txt.append(el('span', 'item-stats', i.stats));
      txt.append(el('p', '', i.desc));
      if (extra) txt.append(extra);
      r.append(icon(i.icon, 'item-ico'), txt, el('span', 'item-n', `×${i.n}`));
      return r;
    };
    const consumables = A.inventory.filter((i) => i.kind === 'consumable').map((i) => {
      let extra = null;
      if (i.usable === 'any' && !A.combat) {
        extra = el('div', 'use-row');
        for (const p of A.party) {
          const full = i.id === 'elixir' ? !(p.cls === 'wizard' || p.cls === 'cleric') : p.hp >= p.maxHp;
          const b = button(`Use on ${p.name}${i.id === 'elixir' ? '' : ` (${p.hp}/${p.maxHp})`}`, 'btn small', () => TT.send({ t: 'adv:use', item: i.id, ally: p.id }));
          b.disabled = full;
          extra.append(b);
        }
      } else if (i.usable === 'combat') extra = el('p', 'hint', 'Use it in battle: Items ▸');
      return row(i, extra);
    });
    const gear = A.inventory.filter((i) => i.kind === 'gear').map((i) => {
      const extra = el('div', 'use-row');
      for (const p of A.party) {
        const ok = !i.classes || i.classes.includes(p.cls);
        const b = button(`Equip on ${p.name}`, 'btn small', () => TT.send({ t: 'adv:equip', item: i.id, hero: p.id }));
        b.disabled = !ok || !!A.combat;
        if (!ok) b.title = 'This class can\'t use it';
        extra.append(b);
      }
      return row(i, extra);
    });
    const keys = A.inventory.filter((i) => i.kind === 'key').map((i) => row(i));
    const parts = [pageHead('Items', `Party gold: ${A.gold} G · Equipment goes to one hero; see Status for what each hero wears.`)];
    if (consumables.length) parts.push(section('Consumables', consumables));
    if (gear.length) parts.push(section('Equipment', gear));
    if (keys.length) parts.push(section('Treasures & key items', keys));
    if (parts.length === 1) parts.push(el('p', 'hint', 'Your pack is empty.'));
    page.replaceChildren(...parts);
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
    const gear = el('div', 'gear-grid');
    for (const [slot, label] of [['weapon', 'Weapon'], ['armor', 'Armor'], ['trinket', 'Trinket']]) {
      const g = h.gear && h.gear[slot];
      const cell = el('div', `gear-slot${g ? ' on' : ''}`);
      cell.append(el('small', '', label));
      if (g) {
        cell.append(el('b', '', g.name), el('span', 'item-stats', g.stats));
        if (!A.combat) cell.append(button('Remove', 'btn ghost small', () => TT.send({ t: 'adv:unequip', slot, hero: h.id })));
      } else cell.append(el('span', 'hint', slot === 'weapon' ? h.weapon : 'Empty'));
      gear.append(cell);
    }
    right.append(el('h4', 'status-sub', 'Equipment'), gear);
    const tal = el('div', 'talent-list');
    for (const t of h.talents || []) { const d = el('div', 'talent'); d.append(el('b', '', t.name), el('span', '', t.desc)); tal.append(d); }
    if (!(h.talents || []).length) tal.append(el('p', 'hint', 'No talents yet. They come with levels.'));
    right.append(el('h4', 'status-sub', 'Talents'), tal);
    if (h.nextTalent) right.append(el('p', 'hint', `Next level: ${h.nextTalent}`));
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

  // Bestiary: every creature you've met (a Pokédex for monsters), plus the party's records.
  function pageBestiary(page, A) {
    const S = A.stats || {};
    const rec = el('div', 'records');
    for (const [k, label] of [['wins', 'Battles won'], ['kills', 'Foes defeated'], ['crits', 'Critical hits'], ['dealt', 'Damage dealt'], ['taken', 'Damage taken'], ['downs', 'Heroes knocked out'], ['potions', 'Potions drunk'], ['gold', 'Gold earned'], ['journeys', 'Journeys']]) {
      const c = el('div', 'record');
      c.append(el('b', '', String(S[k] || 0)), el('small', '', label));
      rec.append(c);
    }
    const list = A.bestiary || [];
    const cards = list.map((m) => {
      const d = el('div', `beast${m.boss ? ' boss' : ''}${m.defeated ? '' : ' undefeated'}`);
      const head = el('div', 'beast-head');
      head.append(icon(m.icon, 'beast-ico'));
      const t = el('div', 'grow');
      t.append(el('b', '', m.name), el('small', '', `${m.boss ? 'Boss · ' : ''}${m.type} · HP ${m.hp} · AC ${m.ac} · ${m.xp} XP`));
      head.append(t, el('span', 'beast-count', m.defeated ? `Defeated ×${m.defeated}` : 'Not yet defeated'));
      d.append(head);
      if (m.lore) d.append(el('p', 'beast-lore', m.lore));
      if (m.tips.length) { const ul = el('ul', 'beast-tips'); for (const tip of m.tips) ul.append(el('li', '', tip)); d.append(ul); }
      return d;
    });
    page.replaceChildren(
      pageHead('Bestiary', list.length ? `${list.length} kind${list.length === 1 ? '' : 's'} of creature met. Can you find them all?` : 'Creatures you meet will be recorded here.'),
      el('h3', '', 'Party records'), rec,
      el('h3', '', 'Creatures'), ...(cards.length ? cards : [el('p', 'hint', 'No creatures met yet. Venture out of town!')]),
    );
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
    const size = A.world.size || { w: 100, h: 70 };
    board.style.aspectRatio = `${size.w} / ${size.h}`;
    svg.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`);
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
      const b = button([el('span', 'pin-medal'), el('span', 'pin-name', n.visited ? n.name : `${n.name}?`)], `pin${n.visited ? ' visited' : ' unknown'}${n.here ? ' here' : ''}${canGo ? ' go' : ''}${exit && !exit.ok ? ' locked' : ''}${n.todo ? ' todo' : ''}`, () => pick(n.id));
      b.firstChild.append(icon(n.icon));
      if (n.here) b.append(el('span', 'pin-here', 'You are here'));
      b.style.left = `${(n.x / size.w) * 100}%`;
      b.style.top = `${(n.y / size.h) * 100}%`;
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

  function choiceRow(label, options, current, set, hint, disabled) {
    const r = el('div', 'setting');
    const t = el('div', 'grow');
    t.append(el('b', '', label));
    if (hint) t.append(el('p', 'hint', hint));
    const seg = el('div', 'seg');
    for (const [v, name] of options) {
      const b = button(name, `seg-b${String(v) === String(current) ? ' on' : ''}`, () => { if (!disabled) { set(v); setTimeout(render, 50); } });
      b.disabled = !!disabled && String(v) !== String(current);
      b.setAttribute('aria-pressed', String(String(v) === String(current)));
      seg.append(b);
    }
    r.append(t, seg);
    return r;
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
    const rows = [toggle('Sound effects', !FX.muted, (v) => FX.setMuted(!v), 'Swords, spells, coins, footsteps and menu sounds.')];
    if (window.Music) {
      const r = toggle('Music', window.Music.enabled, (v) => window.Music.setEnabled(v), 'Original music that changes with the place and the battle.');
      const vol = el('input');
      vol.type = 'range';
      vol.min = '0';
      vol.max = '100';
      vol.value = String(Math.round(window.Music.volume * 100));
      vol.className = 'vol';
      vol.setAttribute('aria-label', 'Music volume');
      vol.oninput = () => window.Music.setVolume(Number(vol.value) / 100);
      r.firstChild.append(vol);
      rows.push(r);
    }
    if (window.Board3D) rows.push(toggle('3D graphics', use3d(), (v) => { store.set('dnd.3d', v ? '1' : '0'); nowKey = ''; }, '3D world map, battles and dice. Turn off on slower computers.'));
    rows.push(toggle('Fast battle effects', FX.speed >= 2, (v) => FX.setSpeed(v ? 2 : 1), 'Plays dice, hits and banners twice as fast.'));
    rows.push(toggle('Auto-switch players in battle', TT.followTurns, (v) => TT.setFollowTurns(v), 'When several players share this screen.'));
    rows.push(toggle('Calm mode', calm(), (v) => { store.set('dnd.calm', v ? '1' : '0'); applyLook(); }, 'Less motion: no screen shake, still pictures and fewer moving effects.'));
    rows.push(choiceRow('Text size', [['1', 'Normal'], ['1.15', 'Large'], ['1.3', 'Larger']], store.get('dnd.textSize') || '1', (v) => { store.set('dnd.textSize', v); applyLook(); }, 'For the story, menus and item descriptions.'));
    const A = TT.S && TT.S.adventure;
    if (A && A.difficulties) {
      const hostOnly = TT.me.isDM ? '' : ' Only the host can change this.';
      rows.push(toggle('Roll your own dice', A.manualDice, (v) => { if (TT.me.isDM) TT.send({ t: 'adv:dice', on: v }); else TT.toast('Only the host can change this.', true); }, `Click the d20 yourself for skill checks and attacks. Off: the game rolls for you.${hostOnly}`));
      const host = TT.me.isDM;
      const cur = A.difficulties.find((d) => d.id === A.difficulty);
      rows.push(choiceRow('Difficulty', A.difficulties.map((d) => [d.id, d.name]), A.difficulty, (v) => TT.send({ t: 'adv:difficulty', level: v }), `${cur ? cur.desc : ''}${host ? '' : ' Only the host can change this.'}`, !host));
    }
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
      el('h3', '', 'Levels, talents and gear'),
      p('Heroes learn a new talent at levels 2, 3 and 5, and train their main ability at level 4 (see Status). Buy gear at Brann\'s smithy or earn it on quests, then equip it from Items.'),
      el('h3', '', 'Status effects'),
      p('Poisoned creatures take damage each turn. Sleeping and stunned ones lose their turn (sleepers wake when hit). Hidden heroes can\'t be targeted. Blessed heroes get +2 to hit.'),
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
    if (!$('#advSpoils').hidden) { $('#advSpoils').hidden = true; releaseStage(); FX.sfx('back'); return; }
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
    const vi = fresh.findIndex((f) => f.t === 'victory');
    if (vi >= 0) {
      holdStage(20000); // until the Victory window is closed
      const after = fresh.slice(vi + 1);
      const data = {
        xp: after.filter((f) => f.t === 'xp').reduce((a, f) => a + f.n, 0),
        gold: after.filter((f) => f.t === 'gold' && f.n > 0).reduce((a, f) => a + f.n, 0),
        items: after.filter((f) => f.t === 'item').map((f) => ({ name: f.name, n: f.n || 1, icon: f.icon })),
        levels: after.filter((f) => f.t === 'level').map((f) => ({ name: f.name || ((A.party.find((p) => p.id === f.id) || {}).name), level: f.level, learned: f.learned })),
      };
      setTimeout(() => showSpoils(data, TT.S.adventure || A), (1700 + data.levels.length * 1800) / (FX.speed || 1));
    }
    FX.enqueue(fresh, {
      meId: TT.me.id,
      nameOf: (id) => (A.party.find((p) => p.id === id) || { name: 'A hero' }).name,
      levelOf: (id) => (A.party.find((p) => p.id === id) || { level: '' }).level,
    });
  }
})();
