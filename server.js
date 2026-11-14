// Madness Combat - server multiplayer (Node 18+, TANPA dependency).
// Jalankan:  node server.js     (PORT dari env, default 8080)
// - Websocket di path mana saja, room lewat ?room=nama (default "main"), maks 8 pemain per room.
// - Server menentukan HP, kill, skor, respawn (autoritatif). Deteksi kena-tidaknya peluru dilakukan klien penembak.
// - Sekaligus melayani file game (index.html, Image/, Sound/) supaya bisa dites lokal / dipakai tanpa GitHub Pages.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = +process.env.PORT || 8080, MAX_PLAYERS = +process.env.MAX_PLAYERS || 8;
const HP_MAX = 100, RESPAWN_MS = 3000, SPAWN_PROTECT_MS = 1500, RW = 3800, ZMIN = -155, ZMAX = 145;
// damage per senjata [badan, kepala]; index sama dgn game: 0 AK, 1 Glock, 2 M4, 3 Benelli (1 tembakan = mati)
const DMG = [[26, 60], [20, 48], [22, 52], [HP_MAX, HP_MAX]];
const ROOT = __dirname, MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.json': 'application/json', '.css': 'text/css', '.ico': 'image/x-icon' };
const BLOCK = /^(server\.js|package(-lock)?\.json|render\.yaml|README.*|node_modules|\.git)/i;

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/healthz') { res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); return res.end('ok'); }
  if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(ROOT, p));
  if (!f.startsWith(ROOT + path.sep) || BLOCK.test(path.relative(ROOT, f))) { res.writeHead(404); return res.end('not found'); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(d);
  });
});

// ---------- websocket minimal (RFC 6455) ----------
function frame(op, payload) {
  const n = payload.length; let h;
  if (n < 126) h = Buffer.from([0x80 | op, n]);
  else if (n < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(n, 2) }
  else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2) }
  return Buffer.concat([h, payload]);
}
class Conn {
  constructor(sock, onMsg, onClose) { this.s = sock; this.buf = Buffer.alloc(0); this.onMsg = onMsg; this.onClose = onClose; this.alive = true; this.frag = null; this.dead = false;
    sock.on('data', d => { this.alive = true; this.buf = Buffer.concat([this.buf, d]); try { this.parse() } catch (e) { this.close() } });
    sock.on('close', () => this.end()); sock.on('error', () => this.end()); sock.setNoDelay(true) }
  parse() {
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const fin = !!(b[0] & 0x80), op = b[0] & 15, masked = !!(b[1] & 0x80); let len = b[1] & 127, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4 }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10 }
      if (len > 65536) return this.close();
      if (!masked) return this.close();
      if (b.length < off + 4 + len) return;
      const mk = b.subarray(off, off + 4), pl = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) pl[i] ^= mk[i & 3];
      this.buf = b.subarray(off + 4 + len);
      if (op === 8) return this.close();
      if (op === 9) { this.s.write(frame(10, pl)); continue }
      if (op === 10) { this.alive = true; continue }
      if (op === 1 || op === 0) {
        if (op === 1) this.frag = [];
        if (!this.frag) continue;
        this.frag.push(pl);
        if (fin) { const t = Buffer.concat(this.frag).toString('utf8'); this.frag = null; this.onMsg(t) }
      }
    }
  }
  send(str) { if (!this.dead && this.s.writable) this.s.write(frame(1, Buffer.from(str))) }
  ping() { if (!this.dead && this.s.writable) this.s.write(frame(9, Buffer.alloc(0))) }
  close() { if (!this.dead) { try { this.s.write(frame(8, Buffer.alloc(0))) } catch (e) {} this.s.destroy() } this.end() }
  end() { if (this.dead) return; this.dead = true; this.onClose() }
}

// ---------- room & game ----------
const rooms = new Map();
const rnd = (a, b) => a + Math.random() * (b - a);
const clean = (s, n) => String(s || '').replace(/[^\w .\-]/g, '').trim().slice(0, n);
let nextId = 1;
function getRoom(name) { let r = rooms.get(name); if (!r) { r = { name, players: new Map() }; rooms.set(name, r) } return r }
function bcast(room, obj, except) { const s = JSON.stringify(obj); for (const p of room.players.values()) if (p !== except) p.c.send(s) }
function pub(p) { return { id: p.id, name: p.name, hp: p.hp, k: p.k, d: p.d, dead: p.dead, st: p.st } }
function spawnPoint(room) { // titik jauh dari pemain lain
  let best = null, bd = -1;
  for (let i = 0; i < 12; i++) { const x = rnd(-RW + 400, RW - 400), z = rnd(ZMIN + 20, ZMAX - 20); let md = 1e9;
    for (const q of room.players.values()) if (!q.dead && q.st) md = Math.min(md, Math.abs(q.st.x - x));
    if (md > bd) { bd = md; best = { x, z } } }
  return best;
}
function respawn(room, p) {
  if (!room.players.has(p.id)) return; const sp = spawnPoint(room);
  p.dead = false; p.hp = HP_MAX; p.prot = Date.now() + SPAWN_PROTECT_MS; p.st = null; p.sx = sp.x; p.sz = sp.z;
  bcast(room, { t: 'resp', id: p.id, x: sp.x, z: sp.z, hp: p.hp });
}
function onMessage(room, p, txt) {
  let m; try { m = JSON.parse(txt) } catch (e) { return }
  if (!m || typeof m.t !== 'string') return;
  const now = Date.now();
  switch (m.t) {
    case 's': { // state ~20Hz: relay apa adanya (dibatasi angkanya)
      if (p.dead) return;
      const x = +m.x, z = +m.z; if (!isFinite(x) || !isFinite(z)) return;
      m.id = p.id; p.st = { x, z }; bcast(room, m, p); break }
    case 'ev': { if (p.dead) return; m.id = p.id; bcast(room, m, p); break }
    case 'hit': {
      const v = room.players.get(+m.v); if (!v || v === p || v.dead || p.dead || now < v.prot) return;
      // batas laju: maks ~40 hit/detik per penembak
      p.hw = (p.hw || 0) + 1; if (now - (p.hws || 0) > 1000) { p.hws = now; p.hw = 1 } if (p.hw > 40) return;
      const w = m.w | 0, part = m.part === 'h' ? 1 : 0, dm = (DMG[w] || DMG[0])[part];
      v.hp = Math.max(0, v.hp - dm);
      const info = { ux: +m.ux || 0, uy: +m.uy || 0, hx: +m.hx || 0, hy: +m.hy || 0, part: part ? 'h' : 'b', pw: +m.pw || 1 };
      if (v.hp > 0) { bcast(room, Object.assign({ t: 'dmg', id: v.id, by: p.id, hp: v.hp }, info)); break }
      v.dead = true; v.d++; p.k++; v.st = null;
      bcast(room, Object.assign({ t: 'kill', id: v.id, by: p.id, w, kk: p.k, vd: v.d }, info));
      setTimeout(() => respawn(room, v), RESPAWN_MS); break }
    case 'name': { p.name = clean(m.name, 14) || p.name; bcast(room, { t: 'name', id: p.id, name: p.name }); break }
    case 'p': p.c.send(JSON.stringify({ t: 'pp', ts: m.ts })); break;
  }
}
server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return }
  let u; try { u = new URL(req.url, 'http://x') } catch (e) { sock.destroy(); return }
  const rn = clean(u.searchParams.get('room'), 24) || 'main', room = getRoom(rn);
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  let p = null;
  const c = new Conn(sock, t => { if (p) onMessage(room, p, t) }, () => {
    if (!p) return; room.players.delete(p.id); bcast(room, { t: 'left', id: p.id, name: p.name });
    if (!room.players.size) rooms.delete(rn) });
  if (room.players.size >= MAX_PLAYERS) { c.send(JSON.stringify({ t: 'full', max: MAX_PLAYERS })); setTimeout(() => c.close(), 200); return }
  const sp = spawnPoint(room);
  p = { id: nextId++, c, name: clean(u.searchParams.get('name'), 14) || 'Player' + (nextId - 1), hp: HP_MAX, k: 0, d: 0, dead: false, prot: Date.now() + SPAWN_PROTECT_MS, st: null };
  for (const q of room.players.values()) if (q.name === p.name) p.name += '#' + p.id;
  room.players.set(p.id, p);
  c.send(JSON.stringify({ t: 'welcome', id: p.id, name: p.name, room: rn, x: sp.x, z: sp.z, max: MAX_PLAYERS, players: [...room.players.values()].map(pub) }));
  bcast(room, { t: 'joined', p: pub(p) }, p);
});
setInterval(() => { for (const r of rooms.values()) for (const p of r.players.values()) { if (!p.c.alive) { p.c.close(); continue } p.c.alive = false; p.c.ping() } }, 20000);
server.listen(PORT, () => console.log('Madness Combat server di port ' + PORT));
