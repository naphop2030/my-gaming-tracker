'use strict';
// Self-hosted D&D virtual tabletop server.
// Serves the web app, keeps game state in memory (saved to data/rooms.json),
// and syncs every connected browser over WebSockets.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { roll } = require('./dice');
const adventure = require('./adventure');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const MAP_DIR = path.join(DATA_DIR, 'maps');
const PORTRAIT_DIR = path.join(DATA_DIR, 'portraits');
const MAX_PORTRAIT_BYTES = 2 * 1024 * 1024;
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const MAX_ROOMS = 200;
const MAX_PLAYERS = 40;
const MAX_TOKENS = 400;
const CHAT_LIMIT = 300;
const MAX_MAP_BYTES = 15 * 1024 * 1024;

const HELP = [
  'Commands:',
  '/r 1d20+5 Stealth  - roll dice (label is optional)',
  '/gr 2d6            - secret roll, only you and the DM see it',
  '/r adv  /r dis     - roll with advantage / disadvantage',
  'Dice: 2d6+3, 1d8+1d6, d%, 4d6kh3 (keep highest 3), 2d20kl1 (keep lowest)',
  'Map: drag tokens you own, drag empty space to pan, scroll to zoom, double-click to ping.',
].join('\n');

fs.mkdirSync(MAP_DIR, { recursive: true });
fs.mkdirSync(PORTRAIT_DIR, { recursive: true });

// ---------- persistence ----------
const rooms = new Map();
try {
  for (const r of JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'))) rooms.set(r.code, r);
  console.log(`Loaded ${rooms.size} saved game(s).`);
} catch (e) {
  if (e.code !== 'ENOENT') console.warn('Could not read saved games:', e.message);
}

let saveTimer = null;
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const tmp = ROOMS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify([...rooms.values()]));
  fs.renameSync(tmp, ROOMS_FILE);
}
function save() {
  if (!saveTimer) saveTimer = setTimeout(saveNow, 1000);
}

// ---------- helpers ----------
const rid = (bytes = 6) => crypto.randomBytes(bytes).toString('base64url');
const str = (v, max = 80) => String(v ?? '').slice(0, max);
const num = (v, min, max, def) => {
  if (v === '' || v === null || v === undefined) return def;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const color = (v, def) => (/^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : def);
const safeEq = (a, b) => {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};
const mod = (score) => Math.floor((score - 10) / 2);
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function newRoom(mode = 'tabletop', adventureId = null) {
  return {
    code: newCode(),
    mode,
    adventure: mode === 'adventure' ? adventure.create(adventureId) : null,
    dmKey: rid(18),
    createdAt: Date.now(),
    players: {}, // secret browser id -> { id (public), name, isDM }
    map: { bg: '', cols: 30, rows: 20, grid: true },
    tokens: [],
    chat: [],
    sheets: {}, // public player id -> sheet
    portraits: {}, // public player id -> image url
    initiative: { list: [], current: null, round: 1 },
  };
}

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SHEET_TEXT = { name: 60, race: 40, cls: 60, background: 60, notes: 5000, inventory: 5000 };
const SHEET_NUM = {
  level: [1, 30, 1], hp: [-999, 9999, 10], maxHp: [0, 9999, 10], tempHp: [0, 9999, 0],
  ac: [0, 50, 10], speed: [0, 500, 30], prof: [0, 10, 2], initBonus: [-20, 20, 0],
  str: [1, 30, 10], dex: [1, 30, 10], con: [1, 30, 10], int: [1, 30, 10], wis: [1, 30, 10], cha: [1, 30, 10],
};
function sanitizeSheet(s = {}) {
  const out = {};
  for (const [k, max] of Object.entries(SHEET_TEXT)) out[k] = str(s[k], max);
  for (const [k, [min, max, def]] of Object.entries(SHEET_NUM)) out[k] = num(s[k], min, max, def);
  out.saveProf = {};
  for (const a of ABILITIES) out.saveProf[a] = !!(s.saveProf && s.saveProf[a]);
  return out;
}

function playerByPublicId(room, id) {
  return Object.values(room.players).find((p) => p.id === id) || null;
}

function addChat(room, entry) {
  room.chat.push({ id: rid(6), ts: Date.now(), ...entry });
  if (room.chat.length > CHAT_LIMIT) room.chat.splice(0, room.chat.length - CHAT_LIMIT);
}

function sortInitiative(room) {
  room.initiative.list.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

// ---------- connections ----------
const sockets = new Map(); // room code -> Set<ws>

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function viewFor(room, client) {
  const online = new Set([...(sockets.get(room.code) || [])].map((ws) => ws.client.publicId));
  const dm = client.isDM;
  return {
    code: room.code,
    players: Object.values(room.players).map((p) => ({
      id: p.id, name: p.name, isDM: p.isDM, online: online.has(p.id),
    })),
    map: room.map,
    tokens: dm ? room.tokens : room.tokens.filter((t) => !t.hidden),
    chat: dm ? room.chat : room.chat.filter((m) => !m.private || m.from === client.publicId),
    sheets: room.sheets,
    portraits: room.portraits || {},
    initiative: room.initiative,
    mode: room.mode || 'tabletop',
    adventure: room.adventure ? adventure.view(room, client.publicId) : null,
  };
}

function broadcast(room) {
  for (const ws of sockets.get(room.code) || []) {
    send(ws, { t: 'state', state: viewFor(room, ws.client) });
  }
  save();
}

function doRoll(room, me, expr, isPrivate, label) {
  const result = roll(expr);
  addChat(room, {
    kind: 'roll', from: me.id, name: me.name, label: str(label, 60),
    roll: result, private: !!isPrivate,
  });
  return result;
}

// Splits "/r 1d20 + 5 Stealth check" into the dice part and the label.
function splitRoll(text) {
  const words = text.trim().split(/\s+/);
  const exprWords = [];
  while (words.length && (/^[0-9d%+\-khl]+$/i.test(words[0]) || /^(adv|dis)$/i.test(words[0]))) {
    exprWords.push(words.shift());
  }
  return { expr: exprWords.join(' '), label: words.join(' ') };
}

function handle(ws, msg) {
  const client = ws.client;
  const room = rooms.get(client.code);
  if (!room) return;
  const me = room.players[client.pid];
  if (!me) return;
  const dm = client.isDM;
  const fail = (text) => send(ws, { t: 'error', text });
  const ownsOrDM = (ownerId) => dm || (ownerId && ownerId === me.id);

  try {
    if (room.adventure && /^(init|token|map):/.test(msg.t)) {
      return fail('The adventure handles that for you.');
    }
    switch (msg.t) {
      case 'chat': {
        const text = str(msg.text, 1000).trim();
        if (!text) return;
        const cmd = text.match(/^\/(r|roll|gr|gmroll)\s+(.+)$/i);
        if (cmd) {
          const { expr, label } = splitRoll(cmd[2]);
          doRoll(room, me, expr, /^g/i.test(cmd[1]), label);
          break;
        }
        if (/^\/(help|\?)$/i.test(text)) return send(ws, { t: 'notice', text: HELP });
        if (text.startsWith('/')) return fail('Unknown command. Type /help for the list.');
        addChat(room, { kind: 'chat', from: me.id, name: me.name, text });
        break;
      }

      case 'roll':
        doRoll(room, me, str(msg.expr, 100), !!msg.private, msg.label);
        break;

      case 'rename': {
        const name = str(msg.name, 30).trim();
        if (!name) return;
        me.name = name;
        break;
      }

      case 'ping':
        for (const other of sockets.get(room.code) || []) {
          send(other, { t: 'ping', x: Number(msg.x) || 0, y: Number(msg.y) || 0, name: me.name });
        }
        return;

      // ----- tokens -----
      case 'token:add': {
        if (room.tokens.length >= MAX_TOKENS) return fail('This map has too many tokens.');
        const owner = dm ? (playerByPublicId(room, msg.owner) ? msg.owner : null) : me.id;
        const size = dm ? num(msg.size, 1, 6, 1) : 1;
        room.tokens.push({
          id: rid(6),
          x: num(msg.x, 0, room.map.cols - size, 0),
          y: num(msg.y, 0, room.map.rows - size, 0),
          label: str(msg.label, 40).trim() || 'Token',
          color: color(msg.color, '#c0392b'),
          size,
          owner,
          hidden: dm ? !!msg.hidden : false,
          hp: num(msg.hp, -999, 9999, null),
          maxHp: num(msg.maxHp, 0, 9999, null),
        });
        break;
      }

      case 'token:move': {
        const t = room.tokens.find((x) => x.id === msg.id);
        if (!t) return;
        if (!ownsOrDM(t.owner)) return fail("You can only move your own tokens.");
        t.x = num(msg.x, 0, room.map.cols - t.size, t.x);
        t.y = num(msg.y, 0, room.map.rows - t.size, t.y);
        break;
      }

      case 'token:update': {
        const t = room.tokens.find((x) => x.id === msg.id);
        if (!t) return;
        if (!ownsOrDM(t.owner)) return fail('You can only edit your own tokens.');
        const p = msg.patch || {};
        if ('label' in p) t.label = str(p.label, 40).trim() || 'Token';
        if ('color' in p) t.color = color(p.color, t.color);
        if ('hp' in p) t.hp = num(p.hp, -999, 9999, null);
        if ('maxHp' in p) t.maxHp = num(p.maxHp, 0, 9999, null);
        if (dm) {
          if ('size' in p) t.size = num(p.size, 1, 6, t.size);
          if ('hidden' in p) t.hidden = !!p.hidden;
          if ('owner' in p) t.owner = playerByPublicId(room, p.owner) ? p.owner : null;
          t.x = Math.min(t.x, Math.max(0, room.map.cols - t.size));
          t.y = Math.min(t.y, Math.max(0, room.map.rows - t.size));
        }
        break;
      }

      case 'token:delete': {
        const i = room.tokens.findIndex((x) => x.id === msg.id);
        if (i < 0) return;
        if (!ownsOrDM(room.tokens[i].owner)) return fail('You can only remove your own tokens.');
        room.tokens.splice(i, 1);
        break;
      }

      // ----- map -----
      case 'map:update': {
        if (!dm) return fail('Only the DM can change the map.');
        room.map.cols = num(msg.cols, 5, 200, room.map.cols);
        room.map.rows = num(msg.rows, 5, 200, room.map.rows);
        if ('grid' in msg) room.map.grid = !!msg.grid;
        if (msg.clearBg) {
          removeMapFile(room.map.bg);
          room.map.bg = '';
        }
        for (const t of room.tokens) {
          t.x = Math.min(t.x, Math.max(0, room.map.cols - t.size));
          t.y = Math.min(t.y, Math.max(0, room.map.rows - t.size));
        }
        break;
      }

      // ----- character sheets -----
      case 'sheet:update': {
        let targetId = me.id;
        if (msg.playerId && msg.playerId !== me.id) {
          if (!dm) return fail("You can only edit your own character sheet.");
          if (!playerByPublicId(room, msg.playerId)) return;
          targetId = msg.playerId;
        }
        if (room.adventure && room.adventure.party[targetId]) {
          return fail('In an adventure, the game keeps your hero\'s sheet up to date for you.');
        }
        room.sheets[targetId] = sanitizeSheet(msg.sheet);
        break;
      }

      // ----- initiative -----
      // (In adventure games the engine runs initiative itself.)
      case 'init:roll': {
        const sheet = room.sheets[me.id] || sanitizeSheet({});
        const bonus = mod(sheet.dex) + sheet.initBonus;
        const r = doRoll(room, me, `1d20${signed(bonus)}`, false, 'Initiative');
        const name = sheet.name || me.name;
        const list = room.initiative.list;
        const existing = list.find((e) => e.owner === me.id);
        if (existing) Object.assign(existing, { value: r.total, name });
        else list.push({ id: rid(6), name, value: r.total, owner: me.id });
        sortInitiative(room);
        break;
      }

      case 'init:add': {
        if (!dm) return fail('Only the DM can add to initiative.');
        const name = str(msg.name, 40).trim() || 'Monster';
        let value = num(msg.value, -50, 100, null);
        if (value === null) {
          const r = doRoll(room, me, `1d20${signed(num(msg.bonus, -20, 20, 0))}`, true, `Initiative: ${name}`);
          value = r.total;
        }
        room.initiative.list.push({ id: rid(6), name, value, owner: null });
        sortInitiative(room);
        break;
      }

      case 'init:update': {
        if (!dm) return fail('Only the DM can edit initiative.');
        const e = room.initiative.list.find((x) => x.id === msg.id);
        if (!e) return;
        if ('value' in msg) e.value = num(msg.value, -50, 100, e.value);
        if ('name' in msg) e.name = str(msg.name, 40).trim() || e.name;
        sortInitiative(room);
        break;
      }

      case 'init:remove': {
        const init = room.initiative;
        const i = init.list.findIndex((x) => x.id === msg.id);
        if (i < 0) return;
        if (!ownsOrDM(init.list[i].owner)) return fail('Only the DM can remove that.');
        if (init.current === msg.id) {
          const next = init.list[i + 1] || init.list[0];
          init.current = next && next.id !== msg.id ? next.id : null;
        }
        init.list.splice(i, 1);
        break;
      }

      case 'init:next':
      case 'init:prev': {
        if (!dm) return fail('Only the DM can change turns.');
        const init = room.initiative;
        if (!init.list.length) return;
        const step = msg.t === 'init:next' ? 1 : -1;
        let i = init.list.findIndex((x) => x.id === init.current);
        if (i < 0) {
          i = 0;
        } else {
          i += step;
          if (i >= init.list.length) { i = 0; init.round += 1; }
          if (i < 0) { i = init.list.length - 1; init.round = Math.max(1, init.round - 1); }
        }
        init.current = init.list[i].id;
        const e = init.list[i];
        addChat(room, { kind: 'system', text: `Round ${init.round}: ${e.name}'s turn` });
        break;
      }

      case 'init:clear':
        if (!dm) return fail('Only the DM can end combat.');
        room.initiative = { list: [], current: null, round: 1 };
        addChat(room, { kind: 'system', text: 'Combat ended.' });
        break;

      default:
        if (typeof msg.t === 'string' && msg.t.startsWith('adv:')) {
          if (!room.adventure) return fail('This game has no adventure running.');
          adventure.handle(room, me, dm, msg);
          adventure.syncSheets(room);
          break;
        }
        return;
    }
  } catch (e) {
    if (!(e instanceof adventure.GameError)) console.error(e);
    return fail(e.message);
  }
  broadcast(room);
}

function join(ws, msg) {
  const code = str(msg.room, 6).toUpperCase();
  const room = rooms.get(code);
  if (!room) return send(ws, { t: 'fatal', text: `No game with code ${code}. Check the code with your DM.` });
  const pid = str(msg.pid, 64);
  if (pid.length < 16) return send(ws, { t: 'fatal', text: 'Bad browser id. Try reloading the page.' });

  const isDM = safeEq(msg.dmKey, room.dmKey);
  const name = str(msg.name, 30).trim() || (isDM ? 'Dungeon Master' : 'Adventurer');
  let p = room.players[pid];
  if (!p) {
    if (Object.keys(room.players).length >= MAX_PLAYERS) return send(ws, { t: 'fatal', text: 'This game is full.' });
    p = room.players[pid] = { id: rid(6), name, isDM };
    addChat(room, { kind: 'system', text: `${name} joined the game${isDM ? (room.adventure ? ' as host' : ' as DM') : ''}.` });
  } else {
    p.name = name;
    p.isDM = isDM;
  }

  ws.client = { code, pid, publicId: p.id, isDM };
  if (!sockets.has(code)) sockets.set(code, new Set());
  sockets.get(code).add(ws);
  send(ws, { t: 'welcome', you: { id: p.id, isDM } });
  broadcast(room);
}

// ---------- map image uploads ----------
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAP_FILE_RE = /^[A-Za-z0-9_-]+\.(png|jpg|webp|gif)$/;

function removeMapFile(bg) {
  const file = String(bg || '').replace(/^\/maps\//, '');
  if (MAP_FILE_RE.test(file)) fs.rm(path.join(MAP_DIR, file), { force: true }, () => {});
}
function removePortraitFile(url) {
  const file = String(url || '').replace(/^\/portraits\//, '');
  if (MAP_FILE_RE.test(file)) fs.rm(path.join(PORTRAIT_DIR, file), { force: true }, () => {});
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Image is too large (max 15 MB).'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8',
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveFile(res, file, cache) {
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (req.method === 'POST' && p === '/api/rooms') {
      if (rooms.size >= MAX_ROOMS) return json(res, 503, { error: 'This server has too many games. Delete data/rooms.json to start fresh.' });
      let opts = {};
      try { opts = JSON.parse((await readBody(req, 4096)).toString() || '{}'); } catch { opts = {}; }
      const mode = opts.mode === 'adventure' ? 'adventure' : 'tabletop';
      if (mode === 'adventure' && !adventure.exists(opts.adventure)) return json(res, 400, { error: 'Unknown adventure.' });
      const room = newRoom(mode, opts.adventure);
      rooms.set(room.code, room);
      saveNow();
      return json(res, 200, { code: room.code, dmKey: room.dmKey });
    }

    if (req.method === 'GET' && p === '/api/adventures') return json(res, 200, adventure.list());

    let m = p.match(/^\/api\/rooms\/([A-Z0-9]{6})$/);
    if (m && req.method === 'GET') {
      return rooms.has(m[1]) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'No game with that code.' });
    }

    m = p.match(/^\/api\/rooms\/([A-Z0-9]{6})\/map$/);
    if (m && req.method === 'POST') {
      const room = rooms.get(m[1]);
      if (!room) return json(res, 404, { error: 'No game with that code.' });
      if (!safeEq(req.headers['x-dm-key'], room.dmKey)) return json(res, 403, { error: 'Only the DM can upload maps.' });
      const ext = IMAGE_TYPES[String(req.headers['content-type'] || '').split(';')[0].trim()];
      if (!ext) return json(res, 415, { error: 'Upload a PNG, JPEG, WebP or GIF image.' });
      const body = await readBody(req, MAX_MAP_BYTES);
      const file = `${room.code}-${rid(6)}.${ext}`;
      await fs.promises.writeFile(path.join(MAP_DIR, file), body);
      removeMapFile(room.map.bg);
      room.map.bg = `/maps/${file}`;
      broadcast(room);
      return json(res, 200, { bg: room.map.bg });
    }

    m = p.match(/^\/api\/rooms\/([A-Z0-9]{6})\/portrait$/);
    if (m && (req.method === 'POST' || req.method === 'DELETE')) {
      const room = rooms.get(m[1]);
      if (!room) return json(res, 404, { error: 'No game with that code.' });
      const player = room.players[String(req.headers['x-player-id'] || '')];
      if (!player) return json(res, 403, { error: 'Join the game first.' });
      room.portraits = room.portraits || {};
      if (req.method === 'DELETE') {
        removePortraitFile(room.portraits[player.id]);
        delete room.portraits[player.id];
        broadcast(room);
        return json(res, 200, { ok: true });
      }
      const ext = IMAGE_TYPES[String(req.headers['content-type'] || '').split(';')[0].trim()];
      if (!ext) return json(res, 415, { error: 'Upload a PNG, JPEG, WebP or GIF image.' });
      const body = await readBody(req, MAX_PORTRAIT_BYTES);
      const file = `${room.code}-${player.id.replace(/[^A-Za-z0-9_-]/g, '')}-${rid(4)}.${ext}`;
      await fs.promises.writeFile(path.join(PORTRAIT_DIR, file), body);
      removePortraitFile(room.portraits[player.id]);
      room.portraits[player.id] = `/portraits/${file}`;
      broadcast(room);
      return json(res, 200, { url: room.portraits[player.id] });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });

    m = p.match(/^\/portraits\/(.+)$/);
    if (m) {
      if (!MAP_FILE_RE.test(m[1])) return json(res, 404, { error: 'Not found' });
      return serveFile(res, path.join(PORTRAIT_DIR, m[1]), 'public, max-age=31536000, immutable');
    }

    m = p.match(/^\/maps\/(.+)$/);
    if (m) {
      if (!MAP_FILE_RE.test(m[1])) return json(res, 404, { error: 'Not found' });
      return serveFile(res, path.join(MAP_DIR, m[1]), 'public, max-age=31536000, immutable');
    }

    const file = path.normalize(path.join(PUBLIC_DIR, p === '/' ? 'index.html' : decodeURIComponent(p)));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return json(res, 404, { error: 'Not found' });
    return serveFile(res, file, 'no-cache');
  } catch (e) {
    if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
    if (!e.status) console.error(e);
  }
});

// ---------- WebSockets ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  ws.client = null;
  ws.isAlive = true;
  let budget = 40; // simple flood protection: ~20 messages/second sustained
  const refill = setInterval(() => { budget = Math.min(40, budget + 10); }, 500);

  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    if (--budget < 0) return;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (!ws.client) return msg.t === 'join' ? join(ws, msg) : undefined;
    handle(ws, msg);
  });
  ws.on('close', () => {
    clearInterval(refill);
    if (!ws.client) return;
    const set = sockets.get(ws.client.code);
    if (set) {
      set.delete(ws);
      if (!set.size) sockets.delete(ws.client.code);
    }
    const room = rooms.get(ws.client.code);
    if (room) broadcast(room);
  });
});

// Drop connections that silently went away (closed laptop, lost wifi).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000).unref();

function shutdown() {
  try { saveNow(); } catch (e) { console.error('Could not save games:', e.message); }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  console.log(`\n  D&D table is running!\n`);
  console.log(`  On this computer:   http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets || []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`  On your network:    http://${n.address}:${PORT}`);
    }
  }
  console.log(`\n  Saved games live in ${DATA_DIR}\n  Press Ctrl+C to stop.\n`);
});
