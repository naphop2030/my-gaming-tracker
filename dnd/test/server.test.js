'use strict';
// Starts the real server on a random port and plays a short session over WebSockets.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let proc;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-test-'));
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT, HOST: '127.0.0.1', DATA_DIR: dataDir },
    stdio: 'pipe',
  });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (String(d).includes('running')) resolve(); });
    proc.on('exit', () => reject(new Error('server exited')));
  });
});
test.after(async () => {
  const exited = new Promise((resolve) => proc.on('exit', resolve));
  proc.kill();
  await exited;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function client(room, name, dmKey) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const c = { ws, state: null, you: null, errors: [], waiters: [] };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') c.you = m.you;
    if (m.t === 'state') c.state = m.state;
    if (m.t === 'error' || m.t === 'fatal') c.errors.push(m.text);
    c.waiters = c.waiters.filter((w) => !w(m));
  });
  c.send = (msg) => ws.send(JSON.stringify(msg));
  c.next = (pred) => new Promise((resolve) => c.waiters.push((m) => (pred(m) ? (resolve(m), true) : false)));
  c.ready = new Promise((resolve) => ws.on('open', () => {
    c.send({ t: 'join', room, pid: `${name}-browser-id-0000000`, name, dmKey });
    c.next((m) => m.t === 'state').then(resolve);
  }));
  return c;
}
const state = (c) => c.next((m) => m.t === 'state').then((m) => m.state);
// Resolves with the first state (current or upcoming) that matches.
const until = (c, pred) => (c.state && pred(c.state) ? Promise.resolve(c.state)
  : c.next((m) => m.t === 'state' && pred(m.state)).then((m) => m.state));

test('a short session', async () => {
  const res = await fetch(`${BASE}/api/rooms`, { method: 'POST' });
  const { code, dmKey } = await res.json();
  assert.match(code, /^[A-Z0-9]{6}$/);

  const dm = client(code, 'Dee', dmKey);
  await dm.ready;
  assert.strictEqual(dm.you.isDM, true);

  const pl = client(code, 'Pat');
  await pl.ready;
  assert.strictEqual(pl.you.isDM, false);

  // Players can't fake being the DM.
  pl.send({ t: 'map:update', cols: 10 });
  await pl.next((m) => m.t === 'error');

  // DM places a hidden goblin; the player must not see it.
  dm.send({ t: 'token:add', label: 'Goblin', hidden: true, x: 3, y: 3 });
  let s = await state(pl);
  assert.strictEqual(s.tokens.length, 0);
  const goblin = (await until(dm, (st) => st.tokens.some((t) => t.label === 'Goblin'))).tokens.find((t) => t.label === 'Goblin');
  assert.ok(goblin);

  // Player can't move the goblin, but can add and move their own token.
  pl.send({ t: 'token:move', id: goblin.id, x: 0, y: 0 });
  await pl.next((m) => m.t === 'error');
  pl.send({ t: 'token:add', label: 'Pat', x: 1, y: 1, hidden: true, size: 4 });
  s = await state(pl);
  const mine = s.tokens.find((t) => t.label === 'Pat');
  assert.strictEqual(mine.owner, pl.you.id);
  assert.strictEqual(mine.hidden, false);
  assert.strictEqual(mine.size, 1);
  pl.send({ t: 'token:move', id: mine.id, x: 5, y: 6 });
  s = await state(pl);
  assert.deepStrictEqual([s.tokens[0].x, s.tokens[0].y], [5, 6]);

  // Secret rolls only reach the roller and the DM.
  dm.send({ t: 'chat', text: '/gr 1d20+2 Perception' });
  s = await state(pl);
  assert.ok(!s.chat.some((m) => m.kind === 'roll'));
  const secret = (await until(dm, (st) => st.chat.some((m) => m.kind === 'roll'))).chat.find((m) => m.kind === 'roll');
  assert.strictEqual(secret.label, 'Perception');
  assert.strictEqual(secret.private, true);

  // Sheets: own sheet only.
  pl.send({ t: 'sheet:update', sheet: { name: 'Pat the Brave', dex: 14, initBonus: 1 } });
  s = await state(pl);
  assert.strictEqual(s.sheets[pl.you.id].name, 'Pat the Brave');
  pl.send({ t: 'sheet:update', playerId: dm.you.id, sheet: { name: 'hax' } });
  await pl.next((m) => m.t === 'error');

  // Initiative: player rolls with dex mod (+2) and bonus (+1).
  pl.send({ t: 'init:roll' });
  s = await state(pl);
  const entry = s.initiative.list[0];
  assert.strictEqual(entry.name, 'Pat the Brave');
  assert.ok(entry.value >= 4 && entry.value <= 23);
  dm.send({ t: 'init:add', name: 'Goblin', value: 99 });
  dm.send({ t: 'init:next' });
  s = (await dm.next((m) => m.t === 'state' && m.state.initiative.current)).state;
  assert.strictEqual(s.initiative.list[0].name, 'Goblin');
  assert.strictEqual(s.initiative.current, s.initiative.list[0].id);

  dm.ws.close();
  pl.ws.close();
});

test('unknown room is refused', async () => {
  const c = client('ZZZZZZ', 'Nobody');
  const ws = c.ws;
  const fatal = await new Promise((resolve) => {
    ws.on('open', () => c.send({ t: 'join', room: 'ZZZZZZ', pid: 'x'.repeat(20), name: 'n' }));
    c.next((m) => m.t === 'fatal').then(resolve);
  });
  assert.match(fatal.text, /No game/);
  ws.close();
});

test('only the DM can upload a map', async () => {
  const { code, dmKey } = await (await fetch(`${BASE}/api/rooms`, { method: 'POST' })).json();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  let r = await fetch(`${BASE}/api/rooms/${code}/map`, { method: 'POST', headers: { 'Content-Type': 'image/png', 'X-DM-Key': 'nope' }, body: png });
  assert.strictEqual(r.status, 403);
  r = await fetch(`${BASE}/api/rooms/${code}/map`, { method: 'POST', headers: { 'Content-Type': 'image/png', 'X-DM-Key': dmKey }, body: png });
  assert.strictEqual(r.status, 200);
  const { bg } = await r.json();
  r = await fetch(BASE + bg);
  assert.strictEqual(r.headers.get('content-type'), 'image/png');
  r = await fetch(`${BASE}/..%2fserver.js`);
  assert.strictEqual(r.status, 404);
});
