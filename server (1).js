'use strict';
// 의존성 없는 밴픽 서버 (Node 18+)
// - 방/좌석 관리, SSE 실시간 푸시, 토너먼트 드래프트 20단계, 턴 타이머
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const TURN_SECONDS = Number(process.env.TURN_SECONDS || 30);
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const TAKEOVER_MS = 2 * 60 * 1000; // 주인이 2분 넘게 접속이 없으면 다른 사람이 자리를 이어받을 수 있음

// 토너먼트 드래프트 순서 (밴 6 -> 픽 6 -> 밴 4 -> 픽 4)
const BASE_STEPS = [
  ['ban', 'blue', 0], ['ban', 'red', 0], ['ban', 'blue', 1], ['ban', 'red', 1], ['ban', 'blue', 2], ['ban', 'red', 2],
  ['pick', 'blue', 0], ['pick', 'red', 0], ['pick', 'red', 1], ['pick', 'blue', 1], ['pick', 'blue', 2], ['pick', 'red', 2],
  ['ban', 'red', 3], ['ban', 'blue', 3], ['ban', 'red', 4], ['ban', 'blue', 4],
  ['pick', 'red', 3], ['pick', 'blue', 3], ['pick', 'blue', 4], ['pick', 'red', 4],
];

// firstPick이 'red'면 팀을 서로 바꿔서 레드팀이 선픽(먼저 밴/픽)을 가진다
function buildSteps(firstPick) {
  const flip = firstPick === 'red';
  return BASE_STEPS.map(([type, team, slot]) => ({
    type, slot, team: flip ? (team === 'blue' ? 'red' : 'blue') : team,
  }));
}

const MODES = new Set(['solo', '1v1', '5v5']);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const newToken = () => crypto.randomBytes(9).toString('base64url');

// ---------- 챔피언 목록 (서버 검증/시간초과 자동픽용, 실패해도 동작) ----------
let champIds = null;
function getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000 }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}
async function loadChampIds() {
  try {
    const versions = await getJSON('https://ddragon.leagueoflegends.com/api/versions.json');
    const data = await getJSON(`https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/en_US/champion.json`);
    champIds = Object.keys(data.data);
    console.log(`[champs] ${champIds.length}개 로드 (패치 ${versions[0]})`);
  } catch (e) {
    console.warn('[champs] 챔피언 목록 로드 실패 - 서버 검증/자동픽 제한:', e.message);
  }
}

// ---------- 방 ----------
const rooms = new Map();   // roomId -> room
const tokens = new Map();  // token -> { room, seat|null }

function createRoom({ blueName, redName, mode, firstPick, hostSide }) {
  const room = {
    id: newToken(), blueName, redName, mode, firstPick, steps: buildSteps(firstPick),
    status: 'lobby', step: 0,
    picks: { blue: Array(5).fill(null), red: Array(5).fill(null) },
    bans: { blue: Array(5).fill(null), red: Array(5).fill(null) },
    turnEndsAt: null, seats: [], specToken: newToken(), specConns: 0,
    clients: new Set(), touched: Date.now(),
  };
  const mk = (team, slot) => ({ token: newToken(), team, slot, ready: false, conns: 0, host: false, owner: null, lastSeen: 0 });
  if (mode === 'solo') room.seats.push(mk('both', null));
  else if (mode === '1v1') room.seats.push(mk('blue', null), mk('red', null));
  else for (const team of ['blue', 'red']) for (let i = 0; i < 5; i++) room.seats.push(mk(team, i));
  // 방장은 선택한 진영의 첫 좌석 (혼자 모드는 유일한 좌석)
  const hostSeat = (mode !== 'solo' && room.seats.find((s) => s.team === hostSide)) || room.seats[0];
  hostSeat.host = true;
  rooms.set(room.id, room);
  for (const seat of room.seats) tokens.set(seat.token, { room, seat });
  tokens.set(room.specToken, { room, seat: null });
  return room;
}

function viewFor(room, seat, taken = false) {
  const v = {
    mode: room.mode, blueName: room.blueName, redName: room.redName,
    status: room.status, step: room.step, steps: room.steps, firstPick: room.firstPick,
    picks: room.picks, bans: room.bans,
    turnEndsAt: room.turnEndsAt, turnSeconds: TURN_SECONDS, serverNow: Date.now(),
    seats: room.seats.map((s) => ({ team: s.team, slot: s.slot, joined: s.conns > 0, ready: s.ready, host: s.host })),
    spectators: room.specConns,
    me: seat
      ? { role: 'seat', team: seat.team, slot: seat.slot, host: seat.host, ready: seat.ready }
      : { role: 'spectator', taken },
  };
  if (seat && seat.host) {
    v.links = room.seats.map((s) => s.token);
    v.specToken = room.specToken;
  }
  return v;
}

function broadcast(room) {
  room.touched = Date.now();
  for (const c of room.clients) {
    c.res.write(`data: ${JSON.stringify(viewFor(room, c.seat, c.taken))}\n\n`);
  }
}

function usedSet(room) {
  const s = new Set();
  for (const t of ['blue', 'red']) {
    for (const x of room.picks[t]) if (x && x !== 'none') s.add(x);
    for (const x of room.bans[t]) if (x && x !== 'none') s.add(x);
  }
  return s;
}

function canAct(seat, st) {
  if (!seat) return false;
  if (seat.team === 'both') return true;
  return seat.team === st.team && (seat.slot == null || seat.slot === st.slot);
}

function applyStep(room, value) {
  const st = room.steps[room.step];
  (st.type === 'ban' ? room.bans : room.picks)[st.team][st.slot] = value;
  room.step += 1;
  if (room.step >= room.steps.length) {
    room.status = 'finished';
    room.turnEndsAt = null;
  } else {
    room.turnEndsAt = Date.now() + TURN_SECONDS * 1000;
  }
  broadcast(room);
}

function startIfReady(room) {
  if (room.status === 'lobby' && room.seats.every((s) => s.ready)) {
    room.status = 'drafting';
    room.step = 0;
    room.turnEndsAt = Date.now() + TURN_SECONDS * 1000;
  }
}

function doAction(room, seat, championId) {
  if (room.status !== 'drafting') throw new HttpError(409, '진행 중인 밴픽이 아닙니다.');
  const st = room.steps[room.step];
  if (!canAct(seat, st)) throw new HttpError(403, '지금은 내 차례가 아닙니다.');
  if (championId === 'none') {
    if (st.type !== 'ban') throw new HttpError(400, '픽은 건너뛸 수 없습니다.');
    return applyStep(room, 'none');
  }
  if (typeof championId !== 'string' || !/^[A-Za-z0-9]{1,30}$/.test(championId)) throw new HttpError(400, '잘못된 챔피언입니다.');
  if (champIds && !champIds.includes(championId)) throw new HttpError(400, '존재하지 않는 챔피언입니다.');
  if (usedSet(room).has(championId)) throw new HttpError(409, '이미 밴/픽된 챔피언입니다.');
  applyStep(room, championId);
}

// 턴 타이머: 시간 초과 시 밴은 건너뛰고, 픽은 무작위 선택
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.status !== 'drafting' || !room.turnEndsAt || now < room.turnEndsAt) continue;
    const st = room.steps[room.step];
    if (st.type === 'ban' || !champIds) return applyStep(room, 'none');
    const used = usedSet(room);
    const pool = champIds.filter((id) => !used.has(id));
    applyStep(room, pool[Math.floor(Math.random() * pool.length)] || 'none');
  }
}, 500);

// 오래된 방 정리
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.clients.size === 0 && now - room.touched > ROOM_TTL_MS) {
      rooms.delete(id);
      for (const s of room.seats) tokens.delete(s.token);
      tokens.delete(room.specToken);
    }
  }
}, 10 * 60 * 1000);

// ---------- HTTP ----------
const STATIC = {
  '/app.js': 'app.js', '/style.css': 'style.css', '/lanes.js': 'lanes.js',
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function serveFile(res, file) {
  fs.readFile(path.join(__dirname, file), (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 10_000) { reject(new HttpError(413, '요청이 너무 큽니다.')); req.destroy(); } });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { reject(new HttpError(400, '잘못된 JSON')); } });
    req.on('error', reject);
  });
}

const cleanName = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 20) : fallback);

// 좌석 링크는 한 명(브라우저)만 사용 가능. 이미 주인이 있으면 false -> 관전자로 입장시킨다.
function claim(seat, cid) {
  if (typeof cid !== 'string' || !/^[\w-]{8,64}$/.test(cid)) throw new HttpError(400, '잘못된 접속입니다. 페이지를 새로고침해 주세요.');
  const now = Date.now();
  const free = !seat.owner || seat.owner === cid || (seat.conns === 0 && now - seat.lastSeen > TAKEOVER_MS);
  if (!free) return false;
  seat.owner = cid;
  seat.lastSeen = now;
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const cid = u.searchParams.get('cid');

    if (req.method === 'GET') {
      if (STATIC[p]) return serveFile(res, STATIC[p]);
      if (p === '/' || /^\/r\/[\w-]+$/.test(p)) return serveFile(res, 'index.html');
      if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
    }

    if (req.method === 'POST' && p === '/api/rooms') {
      const b = await readBody(req);
      const mode = MODES.has(b.mode) ? b.mode : 'solo';
      const firstPick = b.firstPick === 'red' ? 'red' : 'blue';
      const hostSide = b.hostSide === 'red' ? 'red' : 'blue';
      const room = createRoom({ blueName: cleanName(b.blueName, '블루팀'), redName: cleanName(b.redName, '레드팀'), mode, firstPick, hostSide });
      return sendJSON(res, 200, { hostToken: room.seats.find((s) => s.host).token });
    }

    const m = p.match(/^\/api\/(state|events|ready|action)\/([\w-]+)$/);
    if (m) {
      const [, kind, token] = m;
      const entry = tokens.get(token);
      if (!entry) throw new HttpError(404, '존재하지 않거나 만료된 방입니다.');
      const { room } = entry;
      let seat = entry.seat;
      let taken = false;
      if (seat && !claim(seat, cid)) { seat = null; taken = true; } // 이미 사용 중인 링크 -> 관전자로

      if (kind === 'state' && req.method === 'GET') return sendJSON(res, 200, viewFor(room, seat, taken));

      if (kind === 'events' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
        });
        const client = { res, seat, taken };
        room.clients.add(client);
        if (seat) seat.conns += 1; else room.specConns += 1;
        res.write(`data: ${JSON.stringify(viewFor(room, seat, taken))}\n\n`);
        const ping = setInterval(() => res.write(': ping\n\n'), 15000);
        req.on('close', () => {
          clearInterval(ping);
          room.clients.delete(client);
          if (seat) { seat.conns = Math.max(0, seat.conns - 1); seat.lastSeen = Date.now(); } else room.specConns = Math.max(0, room.specConns - 1);
          broadcast(room);
        });
        broadcast(room);
        return;
      }

      if (kind === 'ready' && req.method === 'POST') {
        if (!seat) throw new HttpError(403, '관전자는 준비할 수 없습니다.');
        if (room.status !== 'lobby') throw new HttpError(409, '이미 시작되었습니다.');
        seat.ready = true;
        startIfReady(room);
        broadcast(room);
        return sendJSON(res, 200, { ok: true });
      }

      if (kind === 'action' && req.method === 'POST') {
        const b = await readBody(req);
        doAction(room, seat, b.championId);
        return sendJSON(res, 200, { ok: true });
      }
    }

    throw new HttpError(404, 'Not found');
  } catch (e) {
    if (res.headersSent) return res.end();
    sendJSON(res, e.status || 500, { error: e.status ? e.message : '서버 오류' });
    if (!e.status) console.error(e);
  }
});

server.listen(PORT, () => {
  console.log(`밴픽 서버 실행 중: http://localhost:${PORT}`);
  if (!process.env.SKIP_CHAMPS) loadChampIds();
});
