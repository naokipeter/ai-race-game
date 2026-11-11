'use strict';
// AI Race Game – server. No dependencies, no database: rooms live in memory.
//   node server.js        (PORT=3000 by default)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const G = require('./game.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const ROOM_TTL_MS = 3 * 60 * 60 * 1000;
const MAX_PLAYERS = 5;
const MIN_PLAYERS = 2;
const MAX_ROOMS = 500;

/** @type {Map<string, any>} */
const rooms = new Map();

const token = () => crypto.randomBytes(16).toString('hex');
function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += letters[crypto.randomInt(letters.length)];
    if (!rooms.has(c)) return c;
  }
}

function createRoom() {
  if (rooms.size >= MAX_ROOMS) throw fail(503, 'Too many games running. Try again later.');
  const room = { code: newCode(), hostToken: token(), players: [], game: null, streams: new Set(), lastActive: Date.now(), seq: 0 };
  rooms.set(room.code, room);
  return room;
}

function fail(status, message) { const e = new Error(message); e.status = status; return e; }
const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 12);
const isConnected = (room, id) => [...room.streams].some((s) => s.id === id);

// ---------- state sent to clients ----------
function view(room, client) {
  const g = room.game;
  const order = g ? g.seats.map((id) => room.players.find((p) => p.id === id)) : room.players;
  const active = g ? G.activeIds(g) : [];
  const choosing = g && g.phase === 'choose';
  const state = {
    code: room.code, seq: room.seq,
    phase: g ? g.phase : 'lobby',
    gen: g ? g.gen : 0, round: g ? g.round : 0, safety: g ? g.safety : 12, genOver: g ? g.genOver : false,
    players: order.map((p, i) => {
      const gp = g ? g.players[p.id] : null;
      return {
        id: p.id, name: p.name, seat: i + 1, connected: isConnected(room, p.id),
        capability: gp ? gp.capability : 0,
        saved: gp ? gp.saved : [null, null, null],
        total: g ? G.total(g, p.id) : 0,
        released: gp ? gp.released : false,
        skipping: gp ? gp.skipping : false,
        active: active.includes(p.id),
        locked: choosing ? !!g.choices[p.id] : false,
      };
    }),
    allLocked: choosing ? G.allChosen(g) : false,
    resolution: g ? g.resolution : null,   // null until the reveal: cards stay secret
    rollResult: g ? g.rollResult : null,
    ranking: g && g.phase === 'final' ? G.ranking(g) : null,
  };
  if (client.role === 'player') {
    const name = (id) => { const p = room.players.find((x) => x.id === id); return p ? p.name : null; };
    state.you = {
      id: client.id,
      choice: choosing ? g.choices[client.id] || null : null,
      targets: choosing && active.includes(client.id)
        ? { exposeLeft: name(G.targetOf(g, client.id, 'exposeLeft')), exposeRight: name(G.targetOf(g, client.id, 'exposeRight')) }
        : null,
    };
  }
  return state;
}

function broadcast(room) {
  room.seq++;
  room.lastActive = Date.now();
  for (const s of room.streams) send(s, view(room, s));
}
function send(stream, data) {
  if (stream.res.writableEnded || stream.res.destroyed) return;
  stream.res.write(`data: ${JSON.stringify(data)}\n\n`);
}
function drop(room, stream, last) {
  room.streams.delete(stream);
  if (last) send(stream, last);
  stream.res.end();
}

// ---------- actions ----------
function join(body) {
  const room = rooms.get(String(body.code || '').toUpperCase());
  if (!room) throw fail(404, 'Game not found. Check the code on the big screen.');
  const name = cleanName(body.name);
  if (!name) throw fail(400, 'Please enter a name.');
  const same = room.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (same) {
    if (isConnected(room, same.id)) throw fail(409, 'That name is already taken at this table.');
    same.token = token(); // take over the seat of a phone that dropped out
    broadcast(room);
    return { code: room.code, token: same.token };
  }
  if (room.game) throw fail(409, 'This game has already started.');
  if (room.players.length >= MAX_PLAYERS) throw fail(409, 'This table is full (5 players).');
  const p = { id: crypto.randomBytes(4).toString('hex'), token: token(), name };
  room.players.push(p);
  broadcast(room);
  return { code: room.code, token: p.token };
}

function action(body) {
  const room = rooms.get(String(body.code || '').toUpperCase());
  if (!room) throw fail(404, 'Game not found.');
  const g = room.game;
  if (body.token === room.hostToken) {
    switch (body.type) {
      case 'start':
        if (g) throw fail(409, 'Already started.');
        if (room.players.length < MIN_PLAYERS) throw fail(409, 'At least 2 players are needed.');
        room.game = G.createGame(room.players.map((p) => p.id));
        break;
      case 'restart':
        if (!g) throw fail(409, 'Not started.');
        room.game = G.createGame(g.seats);
        break;
      case 'lobby': // back to the lobby (e.g. to change players)
        room.game = null;
        break;
      case 'move': { // lobby: move a seat up/down
        if (g) throw fail(409, 'Seats are fixed once the game has started.');
        const i = room.players.findIndex((p) => p.id === body.id);
        const j = i + (body.dir < 0 ? -1 : 1);
        if (i < 0 || j < 0 || j >= room.players.length) break;
        [room.players[i], room.players[j]] = [room.players[j], room.players[i]];
        break;
      }
      case 'kick': {
        if (g) throw fail(409, 'Players cannot be removed during a game.');
        room.players = room.players.filter((p) => p.id !== body.id);
        for (const s of [...room.streams]) if (s.id === body.id) drop(room, s, { error: 'gone' });
        break;
      }
      case 'autoplay': // phone gone: host plays COOPERATE for that player
        if (!g) throw fail(409, 'Not started.');
        G.choose(g, body.id, 'cooperate');
        break;
      case 'reveal': if (!g) throw fail(409, 'Not started.'); G.reveal(g); break;
      case 'roll': if (!g) throw fail(409, 'Not started.'); G.roll(g, () => crypto.randomInt(12) / 12); break;
      case 'next': if (!g) throw fail(409, 'Not started.'); G.next(g); break;
      default: throw fail(400, 'Unknown action.');
    }
  } else {
    const p = room.players.find((x) => x.token === body.token);
    if (!p) throw fail(403, 'Not part of this game.');
    if (!g) throw fail(409, 'The game has not started yet.');
    if (body.type === 'choose') G.choose(g, p.id, body.card);
    else if (body.type === 'unchoose') G.choose(g, p.id, null);
    else throw fail(400, 'Unknown action.');
  }
  broadcast(room);
  return { ok: true };
}

function events(req, res, q) {
  const room = rooms.get(String(q.get('room') || '').toUpperCase());
  const t = q.get('token');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
  });
  res.write('retry: 1500\n\n');
  let client = null;
  if (room && t === room.hostToken) client = { role: 'host', id: null };
  else if (room) {
    const p = room.players.find((x) => x.token === t);
    if (p) client = { role: 'player', id: p.id };
  }
  if (!client) { res.write(`data: ${JSON.stringify({ error: 'gone' })}\n\n`); res.end(); return; }
  client.res = res;
  res.on('error', () => {});
  room.streams.add(client);
  if (client.role === 'player') broadcast(room); else send(client, view(room, client));
  req.on('close', () => {
    room.streams.delete(client);
    if (client.role === 'player' && rooms.has(room.code)) broadcast(room);
  });
}

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${PORT}`);
  }
  return out;
}

// ---------- http ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};
const PAGES = { '/': 'index.html', '/host': 'host.html', '/play': 'play.html' };

function serveStatic(res, pathname) {
  const rel = PAGES[pathname] || decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': /\.(jpg|png|webp|woff2)$/.test(ext) ? 'public, max-age=86400' : 'no-cache',
    }).end(data);
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 10000) { reject(fail(413, 'Too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(fail(400, 'Bad JSON')); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (status, obj) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(obj));
  try {
    if (req.method === 'GET' && url.pathname === '/api/events') return events(req, res, url.searchParams);
    if (req.method === 'GET' && url.pathname === '/api/info') return json(200, { lan: lanUrls() });
    if (req.method === 'POST' && url.pathname === '/api/create') {
      const room = createRoom();
      return json(200, { code: room.code, token: room.hostToken });
    }
    if (req.method === 'POST' && url.pathname === '/api/join') return json(200, join(await readJson(req)));
    if (req.method === 'POST' && url.pathname === '/api/action') return json(200, action(await readJson(req)));
    if (req.method === 'GET') return serveStatic(res, url.pathname);
    res.writeHead(405).end();
  } catch (e) {
    json(e.status || 409, { error: e.message || 'Error' });
  }
});

// keep SSE connections alive through proxies; drop idle rooms
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const s of room.streams) if (!s.res.writableEnded) s.res.write(': ping\n\n');
    if (now - room.lastActive > ROOM_TTL_MS) {
      for (const s of [...room.streams]) drop(room, s);
      rooms.delete(room.code);
    }
  }
}, 20000).unref();

// All games live in this process: log unexpected errors instead of dying.
process.on('uncaughtException', (e) => console.error('Unexpected error:', e));

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`AI Race Game running:\n  http://localhost:${PORT}`);
    for (const u of lanUrls()) console.log(`  ${u}   (same Wi-Fi)`);
  });
}
module.exports = { server };
