(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
  };
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
  const modOf = (score) => Math.floor((Number(score) - 10) / 2);

  function randomId() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let pid = store.get('dnd.pid');
  if (!pid) { pid = randomId(); store.set('dnd.pid', pid); }

  // ---------- toast & clipboard ----------
  let toastTimer;
  function toast(text, bad = false) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.toggle('bad', bad);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }
  async function copy(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg);
    } catch {
      // Clipboard API needs https; fall back for LAN http addresses.
      const ta = el('textarea');
      ta.value = text;
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) toast(okMsg);
      else window.prompt('Copy this:', text);
    }
  }

  // ---------- lobby ----------
  const params = new URLSearchParams(location.search);
  let roomCode = (params.get('room') || '').toUpperCase();
  if (roomCode && params.get('dm')) {
    store.set(`dnd.dm.${roomCode}`, params.get('dm'));
    history.replaceState(null, '', `?room=${roomCode}`);
  }
  let myName = store.get('dnd.name') || '';
  $('#lobbyName').value = myName;
  $('#lobbyCode').value = roomCode;

  function lobbyError(text) { $('#lobbyError').textContent = text || ''; }
  function readName() {
    const n = $('#lobbyName').value.trim();
    if (!n) { lobbyError('Enter your name first.'); $('#lobbyName').focus(); return null; }
    myName = n;
    store.set('dnd.name', n);
    return n;
  }

  $('#createBtn').onclick = async () => {
    if (!readName()) return;
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      store.set(`dnd.dm.${data.code}`, data.dmKey);
      enter(data.code);
    } catch (e) { lobbyError(e.message || 'Could not reach the server.'); }
  };

  async function joinFromLobby() {
    if (!readName()) return;
    const code = $('#lobbyCode').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return lobbyError('Game codes are 6 letters and numbers.');
    try {
      const res = await fetch(`/api/rooms/${code}`);
      if (!res.ok) return lobbyError((await res.json()).error);
      enter(code);
    } catch { lobbyError('Could not reach the server.'); }
  }
  $('#joinBtn').onclick = joinFromLobby;
  $('#lobbyCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinFromLobby(); });
  $('#lobbyName').addEventListener('keydown', (e) => { if (e.key === 'Enter') (roomCode ? joinFromLobby() : $('#lobbyCode').focus()); });

  // ---------- seats & connections ----------
  // A "seat" is one player using this browser. Several seats let a group share
  // one screen (hot-seat play): every seat keeps its own connection, so the
  // server still treats them as separate players, and the screen shows the
  // point of view of whichever seat is active.
  let S = null; // latest state for the active seat
  let me = { id: null, isDM: false };
  let seats = []; // [{ pid, name }]; seats[0] is this browser's own id
  const conns = new Map(); // pid -> { ws, state, you, retry }
  let activePid = null;
  let leaving = false;
  let followTurns = store.get('dnd.follow') !== '0';
  let lastTurn = null;

  const seatsKey = () => `dnd.seats.${roomCode}`;
  const activeSeat = () => seats.find((x) => x.pid === activePid) || seats[0];
  const activeConn = () => conns.get(activePid);

  function loadSeats() {
    let list = [];
    try { list = JSON.parse(store.get(seatsKey()) || '[]'); } catch { list = []; }
    if (!Array.isArray(list)) list = [];
    list = list.filter((x) => x && typeof x.pid === 'string' && x.pid.length >= 16 && x.name && x.pid !== pid);
    return [{ pid, name: myName }, ...list];
  }
  function saveSeats() { store.set(seatsKey(), JSON.stringify(seats.slice(1))); }

  function enter(code) {
    roomCode = code;
    leaving = false;
    lastTurn = null;
    history.replaceState(null, '', `?room=${code}`);
    $('#lobby').hidden = true;
    $('#table').hidden = false;
    $('#roomCode').textContent = code;
    seats = loadSeats();
    activePid = store.get(`dnd.active.${code}`);
    if (!seats.some((x) => x.pid === activePid)) activePid = pid;
    applyIdentity();
    renderSeats();
    resizeCanvas();
    for (const seat of seats) connect(seat);
  }

  function connect(seat) {
    const c = conns.get(seat.pid) || { retry: 0, state: null, you: null };
    conns.set(seat.pid, c);
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    c.ws = ws;
    ws.onopen = () => {
      c.retry = 0;
      updateConnStatus();
      ws.send(JSON.stringify({
        t: 'join', room: roomCode, pid: seat.pid, name: seat.name,
        // Only this browser's own seat can be the DM.
        dmKey: seat.pid === pid ? store.get(`dnd.dm.${roomCode}`) : undefined,
      }));
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      const active = seat.pid === activePid;
      if (m.t === 'welcome') {
        c.you = m.you;
        if (active) applyIdentity();
        renderSeats();
      } else if (m.t === 'state') {
        c.state = m.state;
        if (!active) return;
        const first = !S;
        S = m.state;
        render();
        if (first) fitView();
        followTurn();
      } else if (m.t === 'error') {
        if (active) { toast(m.text, true); render(); } // render undoes optimistic changes
      } else if (m.t === 'notice') {
        if (active) addLocalMessage(m.text);
      } else if (m.t === 'ping') {
        if (active) addPing(m);
      } else if (m.t === 'fatal') {
        if (seat.pid === pid) { leave(); lobbyError(m.text); } else { toast(`${seat.name}: ${m.text}`, true); removeSeat(seat.pid); }
      }
    };
    ws.onclose = () => {
      if (leaving || conns.get(seat.pid) !== c || c.ws !== ws) return;
      updateConnStatus();
      setTimeout(() => {
        if (!leaving && conns.get(seat.pid) === c && c.ws === ws) connect(seat);
      }, Math.min(8000, 500 * 2 ** c.retry++));
    };
  }

  function updateConnStatus() {
    const down = [...conns.values()].some((c) => c.ws && c.ws.readyState !== WebSocket.OPEN);
    $('#conn').textContent = down ? 'Reconnecting…' : '';
  }

  function send(msg) {
    const c = activeConn();
    if (c && c.ws && c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
    else toast('Not connected right now. Trying again…', true);
  }

  function applyIdentity() {
    const c = activeConn();
    me = (c && c.you) || { id: null, isDM: false };
    document.body.classList.toggle('is-dm', me.isDM);
    $$('[data-dm-only]').forEach((x) => { x.hidden = !me.isDM; });
    $('#rollInit').hidden = me.isDM;
    $('#myName').textContent = activeSeat().name;
  }

  function switchSeat(target, announce = true) {
    if (target === activePid || !conns.has(target)) return;
    if (sheetDirty) pushSheet(); // save what the last player was typing first
    activePid = target;
    store.set(`dnd.active.${roomCode}`, target);
    applyIdentity();
    selectedId = null;
    sheetTarget = null;
    drag = null;
    pan = null;
    renderedChatKey = '';
    const c = activeConn();
    if (c.state) S = c.state;
    render();
    renderSeats();
    if (announce) toast(`Now playing as ${activeSeat().name}${me.isDM ? ' (DM)' : ''}`);
  }

  // When initiative moves on, hand the screen to whoever's turn it is.
  function followTurn() {
    const cur = S && S.initiative.current;
    if (cur === lastTurn) return;
    lastTurn = cur;
    if (!followTurns || seats.length < 2 || !cur) return;
    const entry = S.initiative.list.find((x) => x.id === cur);
    if (!entry) return;
    const target = entry.owner
      ? seats.find((x) => conns.get(x.pid)?.you?.id === entry.owner)
      : seats.find((x) => conns.get(x.pid)?.you?.isDM); // monsters → the DM
    if (target) switchSeat(target.pid);
  }

  function addSeat() {
    if (seats.length >= 8) return toast('Up to 8 players can share one device.', true);
    const n = (window.prompt('Name of the player joining on this device:') || '').trim().slice(0, 30);
    if (!n) return;
    const seat = { pid: randomId(), name: n };
    seats.push(seat);
    saveSeats();
    connect(seat);
    switchSeat(seat.pid);
  }

  function removeSeat(target) {
    if (target === pid) return;
    const seat = seats.find((x) => x.pid === target);
    if (!seat) return;
    const c = conns.get(target);
    conns.delete(target);
    if (c && c.ws) c.ws.close();
    seats = seats.filter((x) => x.pid !== target);
    saveSeats();
    if (activePid === target) switchSeat(pid, false);
    renderSeats();
    updateConnStatus();
  }

  function renderSeats() {
    const bar = $('#seatBar');
    bar.hidden = seats.length < 2;
    const list = $('#seatList');
    list.replaceChildren(...seats.map((seat) => {
      const you = conns.get(seat.pid)?.you;
      const wrap = el('span', `seat${seat.pid === activePid ? ' active' : ''}`);
      const b = el('button', '', seat.name);
      b.title = `Switch to ${seat.name}'s view`;
      b.onclick = () => switchSeat(seat.pid);
      if (you?.isDM) b.append(el('span', 'role', 'DM'));
      wrap.append(b);
      if (seat.pid !== pid) {
        const x = el('button', 'x', '×');
        x.title = `Remove ${seat.name} from this device`;
        x.onclick = () => { if (confirm(`Remove ${seat.name} from this device? Their character stays in the game.`)) removeSeat(seat.pid); };
        wrap.append(x);
      }
      return wrap;
    }));
    $('#followTurns').checked = followTurns;
  }

  $('#addSeat').onclick = addSeat;
  $('#followTurns').onchange = (e) => {
    followTurns = e.target.checked;
    store.set('dnd.follow', followTurns ? '1' : '0');
    if (followTurns) { lastTurn = null; followTurn(); }
  };

  // Number keys 1-8 switch seats (when not typing).
  document.addEventListener('keydown', (e) => {
    if (seats.length < 2 || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    const n = Number(e.key);
    if (n >= 1 && n <= seats.length) switchSeat(seats[n - 1].pid);
  });

  function leave() {
    leaving = true;
    for (const c of conns.values()) if (c.ws) c.ws.close();
    conns.clear();
    S = null;
    $('#table').hidden = true;
    $('#lobby').hidden = false;
    $('#lobbyCode').value = roomCode;
    history.replaceState(null, '', location.pathname);
  }
  $('#leaveBtn').onclick = () => { leave(); lobbyError(''); };

  $('#renameBtn').onclick = () => {
    const seat = activeSeat();
    const n = (window.prompt('Name:', seat.name) || '').trim().slice(0, 30);
    if (!n) return;
    seat.name = n;
    if (seat.pid === pid) { myName = n; store.set('dnd.name', n); } else saveSeats();
    $('#myName').textContent = n;
    renderSeats();
    send({ t: 'rename', name: n });
  };

  $('#codeBtn').onclick = () => copy(`${location.origin}/?room=${roomCode}`, 'Invite link copied. Send it to your players!');
  $('#dmLink').onclick = () => copy(`${location.origin}/?room=${roomCode}&dm=${encodeURIComponent(store.get(`dnd.dm.${roomCode}`) || '')}`, 'DM link copied. Keep it secret!');

  // ---------- tabs ----------
  $$('.tabs button').forEach((b) => {
    b.onclick = () => {
      $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
      $$('.panel').forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.tab; });
      if (b.dataset.tab === 'chat') scrollChat(true);
    };
  });

  // ---------- helpers on state ----------
  const playerName = (id) => (S && S.players.find((p) => p.id === id)?.name) || 'Unknown';
  const canEditToken = (t) => me.isDM || (t.owner && t.owner === me.id);

  function render() {
    if (!S) return;
    renderPlayers();
    renderChat();
    renderSheet();
    renderInit();
    renderTokenPanel();
    loadBackground();
    draw();
  }

  function renderPlayers() {
    const box = $('#players');
    box.replaceChildren(...S.players
      .slice()
      .sort((a, b) => (b.isDM - a.isDM) || (b.online - a.online))
      .map((p) => {
        const c = el('span', `chip${p.online ? ' on' : ''}${p.isDM ? ' dm' : ''}`);
        c.append(el('span', 'dot'), el('span', '', p.name));
        if (p.isDM) c.append(el('span', 'role', 'DM'));
        if (p.id === me.id) c.title = 'You';
        return c;
      }));
  }

  // ---------- chat ----------
  const local = []; // help text etc. shown only to this browser
  let renderedChatKey = '';

  function addLocalMessage(text) {
    local.push({ id: `local-${local.length}`, ts: Date.now(), kind: 'notice', text });
    renderedChatKey = '';
    renderChat();
  }

  function rollNode(m) {
    const r = m.roll;
    const wrap = el('div', 'roll');
    if (r.nat === 20) wrap.classList.add('crit');
    if (r.nat === 1) wrap.classList.add('fumble');
    wrap.append(el('div', 'total', String(r.total)));
    const d = el('div', 'detail');
    const head = el('div');
    head.append(el('span', 'who', m.name));
    if (m.label) head.append(el('span', 'label', m.label));
    if (m.private) head.append(el('span', 'tag', 'secret'));
    d.append(head);
    const line = el('div');
    line.append(`${r.notation} → `);
    r.parts.forEach((p, i) => {
      if (i || p.sign < 0) line.append(p.sign < 0 ? ' − ' : ' + ');
      if (p.rolls) {
        line.append('[');
        p.rolls.forEach((v, j) => {
          if (j) line.append(', ');
          line.append(p.kept[j] ? String(v) : el('s', '', String(v)));
        });
        line.append(']');
      } else line.append(String(p.value));
    });
    if (r.nat === 20) line.append('  Natural 20!');
    if (r.nat === 1) line.append('  Natural 1…');
    d.append(line);
    wrap.append(d);
    return wrap;
  }

  function scrollChat(force) {
    const log = $('#chatLog');
    if (force || log.scrollHeight - log.scrollTop - log.clientHeight < 120) log.scrollTop = log.scrollHeight;
  }

  function renderChat() {
    const all = [...S.chat, ...local].sort((a, b) => a.ts - b.ts);
    const key = all.length + ':' + (all[all.length - 1]?.id || '');
    if (key === renderedChatKey) return;
    const log = $('#chatLog');
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
    renderedChatKey = key;
    log.replaceChildren(...all.map((m) => {
      if (m.kind === 'system') return el('div', 'msg system', m.text);
      if (m.kind === 'notice') return el('div', 'msg notice', m.text);
      const box = el('div', `msg${m.private ? ' secret' : ''}`);
      if (m.kind === 'roll') box.append(rollNode(m));
      else { box.append(el('span', 'who', m.name), m.text); }
      box.title = new Date(m.ts).toLocaleTimeString();
      return box;
    }));
    if (nearBottom) scrollChat(true);
  }

  $('#chatForm').onsubmit = (e) => {
    e.preventDefault();
    const input = $('#chatInput');
    let text = input.value.trim();
    if (!text) return;
    if ($('#secretRoll').checked) text = text.replace(/^\/(r|roll)\s/i, '/gr ');
    send({ t: 'chat', text });
    input.value = '';
  };
  function rollDice(expr, label) {
    send({ t: 'roll', expr, label, private: $('#secretRoll').checked });
  }
  $$('.dice-bar button').forEach((b) => {
    b.onclick = () => rollDice(b.dataset.die, b.dataset.die === 'adv' ? 'Advantage' : b.dataset.die === 'dis' ? 'Disadvantage' : '');
  });

  // ---------- character sheet ----------
  const ABILITIES = [['str', 'STR'], ['dex', 'DEX'], ['con', 'CON'], ['int', 'INT'], ['wis', 'WIS'], ['cha', 'CHA']];
  const SHEET_DEFAULT = {
    name: '', race: '', cls: '', background: '', notes: '', inventory: '',
    level: 1, hp: 10, maxHp: 10, tempHp: 0, ac: 10, speed: 30, prof: 2, initBonus: 0,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    saveProf: { str: false, dex: false, con: false, int: false, wis: false, cha: false },
  };
  const sheetForm = $('#sheetForm');
  let sheetTarget = null; // public player id
  let sheetDirty = null; // a local edit that hasn't been echoed back yet

  // Build the ability score blocks once.
  $('#abilities').append(...ABILITIES.map(([key, label]) => {
    const box = el('div', 'ability');
    box.dataset.ability = key;
    const score = el('input');
    score.type = 'number'; score.min = 1; score.max = 30; score.name = key;
    const prof = el('label', 'prof');
    const profBox = el('input');
    profBox.type = 'checkbox'; profBox.name = `save_${key}`;
    prof.append(profBox, 'Save prof.');
    const acts = el('div', 'acts');
    const check = el('button', '', 'Check'); check.type = 'button'; check.dataset.roll = 'check';
    const save = el('button', '', 'Save'); save.type = 'button'; save.dataset.roll = 'save';
    acts.append(check, save);
    box.append(el('div', 'name', label), el('div', 'mod', '+0'), score, prof, acts);
    return box;
  }));

  function currentSheet(id) {
    const s = (S && S.sheets[id]) || {};
    return { ...SHEET_DEFAULT, ...s, saveProf: { ...SHEET_DEFAULT.saveProf, ...(s.saveProf || {}) } };
  }

  function readSheetForm() {
    const s = { saveProf: {} };
    for (const input of sheetForm.elements) {
      if (!input.name) continue;
      if (input.name.startsWith('save_')) s.saveProf[input.name.slice(5)] = input.checked;
      else s[input.name] = input.value;
    }
    return s;
  }

  function sheetEditable() { return me.isDM || sheetTarget === me.id; }

  function renderSheet() {
    const who = $('#sheetWho');
    const players = S.players.filter((p) => !p.isDM || p.id === me.id);
    if (!sheetTarget || !S.players.some((p) => p.id === sheetTarget)) {
      sheetTarget = me.isDM ? (players.find((p) => p.id !== me.id)?.id || me.id) : me.id;
    }
    if (document.activeElement !== who) {
      who.replaceChildren(...players.map((p) => {
        const o = el('option', '', `${S.sheets[p.id]?.name || p.name}${p.id === me.id ? ' (you)' : ` — ${p.name}`}`);
        o.value = p.id;
        return o;
      }));
      who.value = sheetTarget;
    }

    const s = currentSheet(sheetTarget);
    const editable = sheetEditable();
    $('#sheetReadonly').hidden = editable;
    $$('[data-edit-only]', sheetForm).forEach((x) => { x.hidden = !editable; });
    for (const input of sheetForm.elements) {
      if (!input.name) continue;
      input.disabled = !editable;
      if (input === document.activeElement) continue; // don't fight the person typing
      if (input.name.startsWith('save_')) input.checked = !!s.saveProf[input.name.slice(5)];
      else input.value = s[input.name] ?? '';
    }
    updateMods();
  }

  function updateMods() {
    const s = readSheetForm();
    for (const [key] of ABILITIES) {
      $(`.ability[data-ability=${key}] .mod`).textContent = signed(modOf(s[key]));
    }
  }

  let sheetTimer;
  sheetForm.addEventListener('input', () => {
    if (!sheetEditable()) return;
    updateMods();
    sheetDirty = true;
    clearTimeout(sheetTimer);
    sheetTimer = setTimeout(pushSheet, 400);
  });
  sheetForm.addEventListener('change', () => { if (sheetDirty) pushSheet(); });
  function pushSheet() {
    clearTimeout(sheetTimer);
    sheetDirty = null;
    send({ t: 'sheet:update', playerId: sheetTarget, sheet: readSheetForm() });
  }
  sheetForm.addEventListener('submit', (e) => e.preventDefault());

  $('#sheetWho').onchange = (e) => {
    if (sheetDirty) pushSheet();
    sheetTarget = e.target.value;
    renderSheet();
  };

  $('#abilities').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-roll]');
    if (!btn) return;
    const key = btn.closest('.ability').dataset.ability;
    const s = readSheetForm();
    let bonus = modOf(s[key]);
    const label = ABILITIES.find(([k]) => k === key)[1];
    const isSave = btn.dataset.roll === 'save';
    if (isSave && s.saveProf[key]) bonus += Number(s.prof) || 0;
    const who = sheetTarget === me.id ? '' : `${s.name || playerName(sheetTarget)}: `;
    rollDice(`1d20${signed(bonus)}`, `${who}${label} ${isSave ? 'save' : 'check'}`);
  });

  $$('[data-hp]').forEach((b) => {
    b.onclick = () => {
      const amt = Math.abs(Number($('#hpAmount').value) || 0);
      if (!amt) return toast('Type an amount first.');
      const hp = sheetForm.elements.hp;
      const temp = sheetForm.elements.tempHp;
      const max = Number(sheetForm.elements.maxHp.value) || 0;
      if (b.dataset.hp === '-1') {
        let left = amt;
        const t = Number(temp.value) || 0;
        const fromTemp = Math.min(t, left);
        temp.value = t - fromTemp;
        left -= fromTemp;
        hp.value = (Number(hp.value) || 0) - left;
      } else {
        hp.value = Math.min(max || Infinity, (Number(hp.value) || 0) + amt);
      }
      $('#hpAmount').value = '';
      pushSheet();
    };
  });

  // ---------- initiative ----------
  function renderInit() {
    const init = S.initiative;
    $('#round').textContent = init.round;
    $('#initEmpty').hidden = init.list.length > 0;
    const list = $('#initList');
    if (list.contains(document.activeElement)) return;
    list.replaceChildren(...init.list.map((entry) => {
      const li = el('li', entry.id === init.current ? 'current' : '');
      if (me.isDM) {
        const v = el('input', 'val');
        v.type = 'number';
        v.value = entry.value;
        v.onchange = () => send({ t: 'init:update', id: entry.id, value: v.value });
        li.append(v);
      } else li.append(el('span', 'val', String(entry.value)));
      li.append(el('span', 'nm', entry.name + (entry.owner === me.id ? ' (you)' : '')));
      if (me.isDM || entry.owner === me.id) {
        const x = el('button', '', '×');
        x.title = 'Remove';
        x.onclick = () => send({ t: 'init:remove', id: entry.id });
        li.append(x);
      }
      return li;
    }));
  }
  $('#rollInit').onclick = () => send({ t: 'init:roll' });
  $('#initNext').onclick = () => send({ t: 'init:next' });
  $('#initPrev').onclick = () => send({ t: 'init:prev' });
  $('#initClear').onclick = () => { if (confirm('End combat and clear the initiative list?')) send({ t: 'init:clear' }); };
  $('#initAdd').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    send({ t: 'init:add', name: f.name.value, value: f.value.value, bonus: f.bonus.value });
    f.name.value = ''; f.value.value = '';
    f.name.focus();
  };

  // ---------- token panel ----------
  let selectedId = null;
  const selectedToken = () => (S && S.tokens.find((t) => t.id === selectedId)) || null;

  function ownerOptions(select, value) {
    if (document.activeElement === select) return;
    const opts = [el('option', '', 'Nobody (DM only)')];
    opts[0].value = '';
    for (const p of S.players) {
      if (p.isDM) continue;
      const o = el('option', '', p.name);
      o.value = p.id;
      opts.push(o);
    }
    select.replaceChildren(...opts);
    select.value = value || '';
  }

  function setVal(input, v) {
    if (document.activeElement === input) return;
    if (input.type === 'checkbox') input.checked = !!v;
    else input.value = v ?? '';
  }

  function renderTokenPanel() {
    const t = selectedToken();
    if (!t) selectedId = null;
    const editable = t && canEditToken(t);
    $('#tokenEditor').hidden = !editable;
    $('#tokenReadonly').hidden = !t || editable;
    if (editable) {
      setVal($('#teLabel'), t.label);
      setVal($('#teColor'), t.color);
      setVal($('#teHp'), t.hp);
      setVal($('#teMaxHp'), t.maxHp);
      setVal($('#teSize'), t.size);
      setVal($('#teHidden'), t.hidden);
      ownerOptions($('#teOwner'), t.owner);
    }
    ownerOptions($('#taOwner'), $('#taOwner').value);
    const mf = $('#mapForm');
    setVal(mf.cols, S.map.cols);
    setVal(mf.rows, S.map.rows);
    setVal(mf.grid, S.map.grid);
    $('#clearMap').hidden = !S.map.bg;
  }

  const patchToken = (patch) => { if (selectedId) send({ t: 'token:update', id: selectedId, patch }); };
  $('#teLabel').onchange = (e) => patchToken({ label: e.target.value });
  $('#teColor').onchange = (e) => patchToken({ color: e.target.value });
  $('#teHp').onchange = (e) => patchToken({ hp: e.target.value });
  $('#teMaxHp').onchange = (e) => patchToken({ maxHp: e.target.value });
  $('#teSize').onchange = (e) => patchToken({ size: e.target.value });
  $('#teOwner').onchange = (e) => patchToken({ owner: e.target.value || null });
  $('#teHidden').onchange = (e) => patchToken({ hidden: e.target.checked });
  $('#teDelete').onclick = () => {
    if (!selectedId) return;
    send({ t: 'token:delete', id: selectedId });
    selectedId = null;
  };

  $('#tokenAdd').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    const center = toWorld(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const size = me.isDM ? Number(f.size.value) || 1 : 1;
    const mySheet = S.sheets[me.id];
    send({
      t: 'token:add',
      label: f.label.value || (!me.isDM && mySheet?.name) || (me.isDM ? 'Monster' : activeSeat().name),
      color: f.color.value,
      size,
      owner: me.isDM ? f.owner.value || null : me.id,
      hidden: me.isDM && f.hidden.checked,
      ...freeSpot(Math.floor(center.x - size / 2 + 0.5), Math.floor(center.y - size / 2 + 0.5), size),
      hp: !me.isDM && mySheet ? mySheet.hp : '',
      maxHp: !me.isDM && mySheet ? mySheet.maxHp : '',
    });
    f.label.value = '';
  };

  // Nearest empty square (spiralling out from x,y) so new tokens don't stack up.
  function freeSpot(x, y, size) {
    const maxX = S.map.cols - size;
    const maxY = S.map.rows - size;
    const blocked = (cx, cy) => S.tokens.some((t) =>
      cx < t.x + t.size && cx + size > t.x && cy < t.y + t.size && cy + size > t.y);
    x = clampCell(x, maxX);
    y = clampCell(y, maxY);
    for (let r = 0; r < Math.max(S.map.cols, S.map.rows); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = x + dx;
          const cy = y + dy;
          if (cx < 0 || cy < 0 || cx > maxX || cy > maxY) continue;
          if (!blocked(cx, cy)) return { x: cx, y: cy };
        }
      }
    }
    return { x, y };
  }

  $('#mapForm').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    send({ t: 'map:update', cols: f.cols.value, rows: f.rows.value, grid: f.grid.checked });
    setTimeout(fitView, 200);
  };
  $('#clearMap').onclick = () => send({ t: 'map:update', clearBg: true });
  $('#mapFile').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return toast('That image is over 15 MB.', true);
    toast('Uploading map…');
    try {
      const res = await fetch(`/api/rooms/${roomCode}/map`, {
        method: 'POST',
        headers: { 'Content-Type': file.type, 'X-DM-Key': store.get(`dnd.dm.${roomCode}`) || '' },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast('Map uploaded. Set columns and rows to line up the grid.');
    } catch (err) { toast(err.message || 'Upload failed.', true); }
  };

  // ---------- map canvas ----------
  const CELL = 50;
  const canvas = $('#map');
  const ctx = canvas.getContext('2d');
  const view = { ox: 20, oy: 20, s: 1 };
  let bgImg = null;
  let bgSrc = '';
  let drag = null;
  let pan = null;
  const pings = [];

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  new ResizeObserver(resizeCanvas).observe(canvas);

  function toWorld(sx, sy) {
    return { x: (sx - view.ox) / view.s / CELL, y: (sy - view.oy) / view.s / CELL };
  }
  function pointer(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function fitView() {
    if (!S) return;
    const w = S.map.cols * CELL;
    const h = S.map.rows * CELL;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (!cw || !ch) return;
    view.s = Math.max(0.15, Math.min(3, Math.min((cw - 40) / w, (ch - 40) / h)));
    view.ox = (cw - w * view.s) / 2;
    view.oy = (ch - h * view.s) / 2;
    draw();
  }

  function zoomAt(factor, sx, sy) {
    const s = Math.max(0.15, Math.min(4, view.s * factor));
    view.ox = sx - (sx - view.ox) * (s / view.s);
    view.oy = sy - (sy - view.oy) * (s / view.s);
    view.s = s;
    draw();
  }

  function loadBackground() {
    if (S.map.bg === bgSrc) return;
    bgSrc = S.map.bg;
    bgImg = null;
    if (!bgSrc) return draw();
    const img = new Image();
    img.onload = () => { if (bgSrc === S.map.bg) { bgImg = img; draw(); } };
    img.src = bgSrc;
  }

  function visibleTokens() {
    return S.tokens.slice().sort((a, b) => b.size - a.size); // big tokens underneath
  }

  function initials(label) {
    const words = label.trim().split(/\s+/);
    const s = words.length > 1 ? words[0][0] + words[1][0] : label.slice(0, 2);
    return s.toUpperCase();
  }

  let rafPending = false;
  function draw() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(paint);
  }

  function paint() {
    rafPending = false;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    ctx.clearRect(0, 0, cw, ch);
    if (!S) return;
    const W = S.map.cols * CELL;
    const H = S.map.rows * CELL;

    ctx.save();
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.s, view.s);

    ctx.fillStyle = '#2a241d';
    ctx.fillRect(0, 0, W, H);
    if (bgImg) ctx.drawImage(bgImg, 0, 0, W, H);

    if (S.map.grid) {
      ctx.beginPath();
      for (let x = 0; x <= S.map.cols; x++) { ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, H); }
      for (let y = 0; y <= S.map.rows; y++) { ctx.moveTo(0, y * CELL); ctx.lineTo(W, y * CELL); }
      ctx.strokeStyle = bgImg ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.08)';
      ctx.lineWidth = 1 / view.s;
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(216,169,72,.5)';
    ctx.lineWidth = 2 / view.s;
    ctx.strokeRect(0, 0, W, H);

    for (const t of visibleTokens()) {
      const pos = drag && drag.id === t.id ? drag : t;
      drawToken(t, pos.x, pos.y);
    }

    // drop target preview while dragging
    if (drag) {
      const t = S.tokens.find((x) => x.id === drag.id);
      if (t) {
        const gx = clampCell(Math.round(drag.x), S.map.cols - t.size);
        const gy = clampCell(Math.round(drag.y), S.map.rows - t.size);
        ctx.strokeStyle = 'rgba(216,169,72,.9)';
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 2;
        ctx.strokeRect(gx * CELL + 1, gy * CELL + 1, t.size * CELL - 2, t.size * CELL - 2);
        ctx.setLineDash([]);
        const dist = Math.max(Math.abs(gx - t.x), Math.abs(gy - t.y)) * 5;
        if (dist) {
          ctx.font = 'bold 14px system-ui, sans-serif';
          ctx.fillStyle = '#f1e7d6';
          ctx.textAlign = 'left';
          ctx.fillText(`${dist} ft`, (gx + t.size) * CELL + 6, gy * CELL + 16);
        }
      }
    }

    // pings
    const now = performance.now();
    for (let i = pings.length - 1; i >= 0; i--) {
      const p = pings[i];
      const age = (now - p.start) / 1600;
      if (age >= 1) { pings.splice(i, 1); continue; }
      for (const off of [0, 0.3]) {
        const a = Math.max(0, age - off);
        if (a <= 0) continue;
        ctx.beginPath();
        ctx.arc(p.x * CELL, p.y * CELL, 8 + a * 60, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(216,169,72,${1 - a})`;
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(241,231,214,${1 - age})`;
      ctx.fillText(p.name, p.x * CELL, p.y * CELL - 20);
    }
    ctx.restore();
    if (pings.length) draw();
  }

  function drawToken(t, x, y) {
    const r = (t.size * CELL) / 2;
    const cx = x * CELL + r;
    const cy = y * CELL + r;
    ctx.globalAlpha = t.hidden ? 0.45 : 1;

    ctx.beginPath();
    ctx.arc(cx, cy + 3, r - 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, r - 4, 0, Math.PI * 2);
    ctx.fillStyle = t.color;
    ctx.fill();
    ctx.lineWidth = t.id === selectedId ? 4 : 2;
    ctx.strokeStyle = t.id === selectedId ? '#d8a948' : t.owner === me.id ? '#ffffff' : 'rgba(0,0,0,.6)';
    if (t.hidden) ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(r * 0.75)}px Georgia, serif`;
    ctx.fillText(initials(t.label), cx, cy + 1);

    // name tag
    ctx.font = 'bold 12px system-ui, sans-serif';
    const tw = ctx.measureText(t.label).width + 10;
    ctx.fillStyle = 'rgba(21,17,14,.85)';
    ctx.fillRect(cx - tw / 2, y * CELL + t.size * CELL - 2, tw, 16);
    ctx.fillStyle = '#f1e7d6';
    ctx.fillText(t.label, cx, y * CELL + t.size * CELL + 6);

    // HP bar
    if (t.maxHp && t.hp !== null && (me.isDM || t.owner === me.id || t.owner)) {
      const pct = Math.max(0, Math.min(1, t.hp / t.maxHp));
      const bw = t.size * CELL - 12;
      const bx = x * CELL + 6;
      const by = y * CELL + 1;
      ctx.fillStyle = 'rgba(0,0,0,.7)';
      ctx.fillRect(bx, by, bw, 6);
      ctx.fillStyle = pct > 0.5 ? '#6fbf73' : pct > 0.25 ? '#d8a948' : '#e26a5a';
      ctx.fillRect(bx, by, bw * pct, 6);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 1;
  }

  const clampCell = (v, max) => Math.max(0, Math.min(Math.max(0, max), v));

  function hitToken(w) {
    const list = visibleTokens();
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      if (w.x >= t.x && w.x < t.x + t.size && w.y >= t.y && w.y < t.y + t.size) return t;
    }
    return null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!S || e.button > 0) return;
    canvas.setPointerCapture(e.pointerId);
    const p = pointer(e);
    const w = toWorld(p.x, p.y);
    const t = hitToken(w);
    if (t) {
      selectedId = t.id;
      renderTokenPanel();
      if (canEditToken(t)) {
        drag = { id: t.id, dx: w.x - t.x, dy: w.y - t.y, x: t.x, y: t.y };
        canvas.classList.add('dragging');
      }
      draw();
    } else {
      pan = { sx: p.x, sy: p.y, ox: view.ox, oy: view.oy, moved: false };
      canvas.classList.add('dragging');
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pointer(e);
    if (drag) {
      const w = toWorld(p.x, p.y);
      drag.x = w.x - drag.dx;
      drag.y = w.y - drag.dy;
      draw();
    } else if (pan) {
      if (Math.abs(p.x - pan.sx) + Math.abs(p.y - pan.sy) > 4) pan.moved = true;
      view.ox = pan.ox + (p.x - pan.sx);
      view.oy = pan.oy + (p.y - pan.sy);
      draw();
    }
  });

  function endPointer() {
    canvas.classList.remove('dragging');
    if (drag) {
      const t = S.tokens.find((x) => x.id === drag.id);
      if (t) {
        const nx = clampCell(Math.round(drag.x), S.map.cols - t.size);
        const ny = clampCell(Math.round(drag.y), S.map.rows - t.size);
        if (nx !== t.x || ny !== t.y) {
          t.x = nx; t.y = ny; // optimistic
          send({ t: 'token:move', id: t.id, x: nx, y: ny });
        }
      }
      drag = null;
      draw();
    } else if (pan) {
      if (!pan.moved && selectedId) {
        selectedId = null;
        renderTokenPanel();
        draw();
      }
      pan = null;
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('dblclick', (e) => {
    const p = pointer(e);
    const w = toWorld(p.x, p.y);
    send({ t: 'ping', x: w.x, y: w.y });
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = pointer(e);
    zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  }, { passive: false });

  $$('.zoom button').forEach((b) => {
    b.onclick = () => {
      const cx = canvas.clientWidth / 2;
      const cy = canvas.clientHeight / 2;
      if (b.dataset.zoom === 'in') zoomAt(1.25, cx, cy);
      else if (b.dataset.zoom === 'out') zoomAt(0.8, cx, cy);
      else fitView();
    };
  });

  function addPing(m) {
    pings.push({ x: m.x, y: m.y, name: m.name, start: performance.now() });
    draw();
  }

  document.addEventListener('keydown', (e) => {
    if (!selectedId || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    const t = selectedToken();
    if (!t || !canEditToken(t)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      send({ t: 'token:delete', id: t.id });
      selectedId = null;
      return;
    }
    const dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const d = dirs[e.key];
    if (!d) return;
    e.preventDefault();
    const nx = clampCell(t.x + d[0], S.map.cols - t.size);
    const ny = clampCell(t.y + d[1], S.map.rows - t.size);
    if (nx === t.x && ny === t.y) return;
    t.x = nx; t.y = ny;
    send({ t: 'token:move', id: t.id, x: nx, y: ny });
    draw();
  });

  // Auto-join when opened with ?room=CODE and we already know our name.
  if (roomCode && myName) enter(roomCode);
})();
