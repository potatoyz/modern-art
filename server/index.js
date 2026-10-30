import http from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createGame, command, publicView, chooseBotAction, expireAuction } from '../packages/modern-art/src/rules.js';
import { CARDS } from '../packages/modern-art/src/catalog.js';
import { assignBotTemperatures } from '../packages/modern-art/src/bot-personality.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = () => randomBytes(24).toString('hex');
const id = () => randomBytes(8).toString('hex');
function shuffled() {
  const deck = CARDS.map(c => c.id);
  for (let i = deck.length - 1; i > 0; i--) { const j = randomInt(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}
const check = (ok, message) => { if (!ok) throw new Error(message); };
const cleanName = value => {
  check(typeof value === 'string', '请输入昵称。');
  const result = value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0,16);
  check(result.length > 0, '请输入昵称。'); return result;
};
const send = (ws, message) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); };

export function createServer({ dataDir = process.env.DATA_DIR || path.join(ROOT, '.data'), persist = true, botDelay = 1000, allowedOrigin = process.env.ALLOWED_ORIGIN || '' } = {}) {
  const rooms = new Map();
  const storeFile = path.join(dataDir, 'rooms.json');
  if (persist) {
    mkdirSync(dataDir, { recursive: true });
    if (existsSync(storeFile)) {
      // Fail visibly on damaged data; never replace a corrupt save with an empty store.
      const saved = JSON.parse(readFileSync(storeFile, 'utf8'));
      for (const r of saved.rooms || []) if (Date.now() - r.updatedAt < 7 * 86400000) {
        assignBotTemperatures(r.game.players);
        rooms.set(r.code, { ...r, sockets: new Map(), nextBotAt: 0 });
      }
    }
  }
  function save() {
    if (!persist) return;
    const output = { version: 1, rooms: [...rooms.values()].map(({ sockets, nextBotAt, ...r }) => r) };
    writeFileSync(`${storeFile}.tmp`, JSON.stringify(output), { mode: 0o600 });
    renameSync(`${storeFile}.tmp`, storeFile);
  }
  function broadcast(r) {
    for (const [playerId, ws] of r.sockets) send(ws, { type: 'state', room: r.code, hostId: r.hostId, serverNow: Date.now(),
      online: [...r.sockets.keys()], ...publicView(r.game, playerId) });
  }
  function changed(r) { r.updatedAt = Date.now(); r.nextBotAt = Date.now() + botDelay; save(); broadcast(r); }
  function attach(ws, r, playerId, secret) {
    const old = r.sockets.get(playerId);
    r.sockets.set(playerId, ws); ws.room = r.code; ws.playerId = playerId;
    if (old && old !== ws) { send(old, { type: 'replaced' }); old.close(4001, 'Session replaced'); }
    send(ws, { type: 'session', room: r.code, playerId, token: secret });
    broadcast(r);
  }
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webm': 'video/webm', '.ico': 'image/x-icon' };
  const server = http.createServer((req,res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
    if (req.url?.split('?')[0] === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true,"service":"modern-art"}'); return; }
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    let urlPath;
    try { urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); res.end(); return; }
    const dist = path.join(ROOT,'dist');
    const target = path.resolve(dist, `.${urlPath === '/' ? '/index.html' : urlPath}`);
    if (!target.startsWith(`${dist}${path.sep}`) || !existsSync(target) || !statSync(target).isFile()) { res.writeHead(404); res.end('Not found. Build with npm run build first.'); return; }
    const compressed = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && existsSync(`${target}.gz`);
    if (compressed) res.setHeader('Content-Encoding','gzip');
    res.setHeader('Vary','Accept-Encoding');
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
    if (req.method === 'HEAD') res.end(); else createReadStream(compressed ? `${target}.gz` : target).pipe(res);
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  server.on('upgrade', (req,socket,head) => {
    if (req.url !== '/ws') { socket.destroy(); return; }
    // Same-origin by default, including a Vite reverse proxy. No browser cross-origin room access.
    const origin = req.headers.origin;
    try {
      if (origin && (allowedOrigin ? origin !== allowedOrigin : new URL(origin).host !== req.headers.host)) { socket.destroy(); return; }
    } catch { socket.destroy(); return; }
    if (wss.clients.size >= 500) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', ws => {
    ws.alive = true; ws.rateAt = Date.now(); ws.rateCount = 0;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {});
    ws.on('message', raw => {
      try {
        if (Date.now() - ws.rateAt > 10000) { ws.rateAt = Date.now(); ws.rateCount = 0; }
        check(++ws.rateCount <= 60, '操作太快，请稍后重试。');
        const msg = JSON.parse(raw.toString());
        check(msg && typeof msg === 'object', '无效消息。');
        if (msg.type === 'resume') {
          check(!ws.room, '已在房间中。');
          const r = rooms.get(String(msg.room).toUpperCase());
          check(r && typeof msg.token === 'string' && r.tokens[msg.playerId] === msg.token, '重连凭证失效，请重新进入房间。');
          attach(ws,r,msg.playerId,msg.token); return;
        }
        if (msg.type === 'create' || msg.type === 'join') {
          check(!ws.room, '请先离开当前房间。');
          const name = cleanName(msg.name), playerId = id(), secret = token();
          let r;
          if (msg.type === 'create') {
            check(rooms.size < 200, '房间已满，请稍后再试。');
            let code; do { code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(31)]).join(''); } while (rooms.has(code));
            r = { code, hostId: playerId, tokens: { [playerId]: secret }, game: createGame([{ id: playerId, name }], shuffled(), msg.settings), sockets: new Map(), updatedAt: Date.now(), nextBotAt: 0 };
            rooms.set(code,r);
          } else {
            r = rooms.get(String(msg.room).trim().toUpperCase()); check(r, '找不到这个房间，请检查房间码。');
            check(r.game.phase === 'lobby', '这局已经开始，请等待下一局。'); check(r.game.players.length < 5, '房间已满（最多 5 人）。');
            r.game.players.push({ id: playerId, name, bot: false, cash: 100, hand: [], collection: [] });
            r.tokens[playerId] = secret; r.game.revision++;
          }
          attach(ws,r,playerId,secret); changed(r); return;
        }
        const r = rooms.get(ws.room); check(r && r.sockets.get(ws.playerId) === ws, '请先加入房间。');
        if (msg.type === 'leave') {
          if (!['lobby', 'finished'].includes(r.game.phase)) {
            const player = r.game.players.find(p => p.id === ws.playerId);
            player.bot = true;
            assignBotTemperatures(r.game.players,n=>randomInt(n));
          }
          r.sockets.delete(ws.playerId); delete r.tokens[ws.playerId];
          if (r.game.phase === 'lobby') r.game.players = r.game.players.filter(p => p.id !== ws.playerId);
          if (r.hostId === ws.playerId) r.hostId = r.game.players.find(p => !p.bot && r.tokens[p.id])?.id || '';
          if (!r.hostId) rooms.delete(r.code);
          r.game.revision++; ws.room = null; ws.playerId = null; send(ws,{ type: 'left' }); changed(r); return;
        }
        if (msg.type === 'claimHost') {
          check(!r.sockets.has(r.hostId), '房主仍然在线。'); r.hostId = ws.playerId; changed(r); return;
        }
        if (msg.type === 'addBot' || msg.type === 'removeBot') {
          check(ws.playerId === r.hostId && r.game.phase === 'lobby', '只有房主可以在大厅调整机器人。');
          if (msg.type === 'addBot') {
            check(r.game.players.length < 5, '最多 5 个席位。');
            const names = ['阿橘','小蓝','米米','桃子'];
            const name = names.find(n => !r.game.players.some(p => p.name === n)) || '画廊助手';
            r.game.players.push({ id: id(), name, bot: true, cash: 100, hand: [], collection: [] });
            assignBotTemperatures(r.game.players,n=>randomInt(n));
          } else {
            const target = r.game.players.find(p => p.id === msg.playerId && p.bot); check(target, '只能移除机器人。');
            r.game.players = r.game.players.filter(p => p !== target);
          }
          r.game.revision++; changed(r); return;
        }
        if (msg.type === 'rematch') {
          check(ws.playerId === r.hostId && r.game.phase === 'finished', '等待房主开启下一局。');
          r.game = createGame(r.game.players.filter(p => p.bot || r.tokens[p.id]), shuffled(), r.game.settings); changed(r); return;
        }
        check(msg.type === 'action', '未知请求。');
        check(msg.revision === r.game.revision, '桌面刚刚更新，请重新操作。');
        check(msg.action && typeof msg.action.type === 'string', '无效操作。');
        if (['start','nextRound'].includes(msg.action.type)) check(ws.playerId === r.hostId, '请等待房主继续。');
        r.game = command(r.game, ws.playerId, msg.action);
        changed(r);
      } catch (err) { send(ws, { type: 'error', message: err instanceof SyntaxError ? '无法读取请求。' : err.message }); }
    });
    ws.on('close', () => {
      const r = rooms.get(ws.room);
      if (r?.sockets.get(ws.playerId) === ws) { r.sockets.delete(ws.playerId); broadcast(r); }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } }
  }, 20000);
  const tick = setInterval(() => {
    for (const [code,r] of rooms) {
      if (!r.sockets.size) { if (Date.now() - r.updatedAt > 7 * 86400000) { rooms.delete(code); save(); } continue; }
      try {
        const advanced = expireAuction(r.game);
        if (advanced !== r.game) { r.game = advanced; changed(r); continue; }
        if (Date.now() < r.nextBotAt) continue;
        for (const p of r.game.players.filter(p => p.bot)) {
          const action = chooseBotAction(publicView(r.game,p.id),p.botTemperature);
          if (action) { r.game = command(r.game,p.id,action); changed(r); break; }
        }
      } catch (err) { console.error('Room transition failed:', code, err.message); }
    }
  }, 200);
  return { server, rooms, close: async () => {
    clearInterval(tick); clearInterval(heartbeat); for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createServer();
  const port = Number(process.env.PORT || 8787), host = process.env.HOST || '127.0.0.1';
  app.server.listen(port, host, () => console.log(`Modern Art: http://${host}:${port}`));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
