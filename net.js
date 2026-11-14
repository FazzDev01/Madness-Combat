// Madness Combat - lapisan multiplayer (klien). Server: server.js
(() => {
'use strict';
const NET = window.NET = { on: false, id: 0, name: '', pl: {}, ping: 0 };
const Q = new URLSearchParams(location.search);
let ws = null, sendAt = 0, hudAt = 0, pingAt = 0, feed = [], me = { hp: 100, k: 0, d: 0 }, deadUntil = 0, deadMsg = '';
const $ = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r2 = v => Math.round(v * 100) / 100;

// ---------- UI ----------
const css = $('style', '', `
#mpm{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;background:rgba(10,8,10,.78);font:600 14px system-ui;color:#fff}
#mpm .bx{width:min(340px,88vw);padding:18px;border-radius:14px;background:#1b1618;border:2px solid rgba(255,255,255,.35);display:flex;flex-direction:column;gap:10px}
#mpm h2{margin:0;font:800 18px system-ui;letter-spacing:.5px}#mpm small{opacity:.7;font-weight:500}
#mpm input{height:38px;padding:0 10px;border-radius:8px;border:2px solid rgba(255,255,255,.3);background:#0f0c0d;color:#fff;font:600 15px system-ui;outline:0;user-select:text;-webkit-user-select:text}
#mpm button{height:42px;border-radius:9px;border:2px solid rgba(255,255,255,.5);background:#2a2326;color:#fff;font:800 14px system-ui;letter-spacing:.4px}
#mpm button.pr{background:#2e9e6b;border-color:#58e070}#mpm button:active{filter:brightness(1.3)}
#mps{min-height:16px;color:#ffb36b;font-size:12px}
#mph{position:fixed;top:10px;left:max(12px,env(safe-area-inset-left,0px));z-index:6;display:none;flex-direction:column;gap:5px;font:700 12px system-ui;color:#fff;pointer-events:none;text-shadow:0 1px 3px #000;width:190px}
body.online #mph{display:flex}body.online #bs{display:none}
#mph .hp{height:12px;border-radius:6px;background:rgba(10,10,12,.72);border:2px solid rgba(255,255,255,.5);overflow:hidden}#mph .hp i{display:block;height:100%;background:#58e070;transition:width .15s}
#mph .ch{pointer-events:auto;display:flex;justify-content:space-between;gap:8px;padding:3px 8px;border-radius:7px;background:rgba(14,14,16,.78);border:2px solid rgba(255,255,255,.3)}
#mph .sb{padding:4px 8px;border-radius:7px;background:rgba(14,14,16,.62);display:flex;flex-direction:column;gap:2px}
#mph .sb div{display:flex;justify-content:space-between;gap:8px}#mph .sb .me{color:#8cf0a4}
#mpf{position:fixed;top:48px;left:50%;transform:translateX(-50%);z-index:6;display:flex;flex-direction:column;align-items:center;gap:3px;font:700 12px system-ui;color:#fff;pointer-events:none}
#mpf div{padding:3px 9px;border-radius:6px;background:rgba(14,14,16,.78);text-shadow:0 1px 2px #000}
#mpd{position:fixed;inset:0;z-index:9;display:none;align-items:center;justify-content:center;flex-direction:column;gap:4px;background:radial-gradient(circle,rgba(120,0,0,.15),rgba(90,0,0,.55));color:#fff;font:800 22px system-ui;text-shadow:0 2px 6px #000;pointer-events:none;text-align:center}
#mpd small{font:600 14px system-ui}
#mpx{position:fixed;inset:0;z-index:8;pointer-events:none;background:rgba(200,0,0,.38);opacity:0;transition:opacity .35s}
`);
document.head.appendChild(css);
const modal = $('div', '', ''); modal.id = 'mpm';
modal.innerHTML = `<div class="bx"><h2>MADNESS COMBAT ONLINE</h2><small>Main bareng pemain lain secara real-time.</small>
<input id="mpn" maxlength="14" placeholder="Nama kamu" autocomplete="off"><input id="mpr" maxlength="24" placeholder="Room (kosong = main)" autocomplete="off">
<div id="mps"></div><button class="pr" id="mpj">MAIN ONLINE</button><button id="mpo">SOLO (OFFLINE)</button></div>`;
const hud = $('div', '', '<div class="hp"><i id="mphp" style="width:100%"></i></div><div class="ch"><span id="mpk">K 0 / D 0</span><span id="mpp">--</span></div><div class="sb" id="mpb"></div>'); hud.id = 'mph';
const feedEl = $('div'); feedEl.id = 'mpf';
const deadEl = $('div'); deadEl.id = 'mpd';
const flash = $('div'); flash.id = 'mpx';
const tag = $('div'); // dummy
document.body.append(modal, hud, feedEl, deadEl, flash);
const nameIn = modal.querySelector('#mpn'), roomIn = modal.querySelector('#mpr'), stat = modal.querySelector('#mps');
try { nameIn.value = localStorage.getItem('mcname') || '' } catch (e) {}
roomIn.value = Q.get('room') || '';
for (const el of [nameIn, roomIn]) el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') join() }); // jangan picu kontrol game
modal.querySelector('#mpj').onclick = join;
modal.querySelector('#mpo').onclick = () => { modal.style.display = 'none' };
hud.querySelector('.ch').onclick = () => { if (confirm('Keluar dari online?')) { try { ws && ws.close() } catch (e) {} } };
const say = m => { stat.textContent = m || '' };

// ---------- koneksi ----------
function serverUrl(room, name) {
  let base = Q.get('server') || window.MC_SERVER || '';
  if (!base) {
    if (/github\.io$/i.test(location.hostname) || location.protocol === 'file:') return null;
    base = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  }
  base = base.replace(/^http/, 'ws').replace(/\/$/, '');
  return base + '/?room=' + encodeURIComponent(room) + '&name=' + encodeURIComponent(name);
}
function join() {
  if (ws) return;
  const name = nameIn.value.trim().slice(0, 14), room = (roomIn.value.trim() || 'main').slice(0, 24);
  try { localStorage.setItem('mcname', name) } catch (e) {}
  const u = serverUrl(room, name);
  if (!u) return say('Server belum diatur. Isi config.js (MC_SERVER) dengan alamat server.');
  say('Menghubungkan... (server gratis bisa butuh ~30 detik untuk bangun)');
  let opened = false, w;
  try { w = ws = new WebSocket(u) } catch (e) { ws = null; return say('Alamat server salah.') }
  const to = setTimeout(() => { if (!opened) { try { w.close() } catch (e) {} } }, 60000);
  w.onopen = () => { opened = true };
  w.onmessage = e => { let m; try { m = JSON.parse(e.data) } catch (x) { return } try { onMsg(m) } catch (x) { console.error(x) } };
  w.onclose = () => {
    clearTimeout(to); const was = NET.on; cleanup(); ws = null;
    modal.style.display = 'flex';
    say(was ? 'Terputus dari server.' : opened ? 'Room penuh / koneksi ditolak.' : 'Gagal terhubung ke server.');
  };
  w.onerror = () => {};
}
function cleanup() {
  NET.on = false; document.body.classList.remove('online'); deadEl.style.display = 'none';
  for (let i = bots.length - 1; i >= 0; i--) if (bots[i].net) bots.splice(i, 1);
  NET.pl = {}; feed = []; if (ME.dead) respawnLocal(b.x, b.z);
}
const send = o => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)) };
const peer = id => bots.find(o => o.nid === id);
const nm = id => (NET.pl[id] && NET.pl[id].name) || ('P' + id);
function addFeed(t) { feed.push({ t, u: performance.now() + 5000 }); if (feed.length > 5) feed.shift(); drawFeed() }
function drawFeed() { feedEl.innerHTML = feed.map(f => '<div>' + f.t + '</div>').join('') }

function mkPeer(id, x, z) {
  const r = mkRig(); r.pid = 'p' + id; r.b.x = x; r.b.z = z; r.b.dir = r.b.t = 1;
  withRig(r, () => { for (let i = 0; i < 40; i++) step(1) });
  const o = { id: r.pid, nid: id, net: true, rig: r, hp: (NET.pl[id] || {}).hp || 100, hx: x, hz: z, dir: 1, in: null, name: nm(id) };
  bots.push(o); puff(x, z); return o;
}
function respawnLocal(x, z) {
  ME.dead = false; me.hp = 100; b.x = x; b.z = z; b.vx = b.vz = 0;
  b.rl = -1; b.sw = -1; b.swG = null; b.safe = false; b.kq = 0; b.sl = -1; b.wt = -1; b.ck = -1; b.flash = 0; b.fn = 0;
  try { if (FIN.t >= 0) finEnd() } catch (e) {}
  AMM.splice(0, 4, 30, 17, 30, 7); ammo = MAGN; frz = 0; drops.length = 0;
  const s = [mx, my, ax, ay]; mx = my = ax = ay = 0; fireS = false;
  for (let i = 0; i < 40; i++) step(1);
  [mx, my, ax, ay] = s; camX = cl(b.x - VW / 2, -RW, Math.max(-RW, RW - VW));
  try { updAmmo() } catch (e) {} deadEl.style.display = 'none'; puff(x, z);
}
function fx(m, kill) { // percikan + darah di titik kena (untuk penonton)
  const hs = m.part === 'h'; hitFx(m.hx, m.hy, m.ux, m.uy, hs);
  const o = peer(m.id); if (o && !o.dying) bloodHit(o, null, m.hx, m.hy, m.ux, m.uy, hs, !!kill, o.rig.b.z + 10);
}

function onMsg(m) {
  switch (m.t) {
    case 'welcome': {
      NET.on = true; NET.id = m.id; NET.name = m.name; NET.pl = {};
      for (const p of m.players) NET.pl[p.id] = p;
      me = NET.pl[m.id] || me; modal.style.display = 'none'; document.body.classList.add('online');
      respawnLocal(m.x, m.z); say(''); addFeed('Masuk room <b>' + esc(m.room) + '</b> sebagai <b>' + esc(m.name) + '</b>'); hudAt = 0; break }
    case 'full': say('Room penuh (maks ' + m.max + '). Coba nama room lain.'); break;
    case 'joined': NET.pl[m.p.id] = m.p; addFeed(esc(m.p.name) + ' masuk'); break;
    case 'left': { const o = peer(m.id); if (o) { bots.splice(bots.indexOf(o), 1); puff(o.rig.b.x, o.rig.b.z) } delete NET.pl[m.id]; addFeed(esc(m.name) + ' keluar'); break }
    case 'name': if (NET.pl[m.id]) { NET.pl[m.id].name = m.name; const o = peer(m.id); if (o) o.name = m.name } break;
    case 's': {
      const p = NET.pl[m.id]; if (!p || p.dead) return;
      let o = peer(m.id); if (!o) o = mkPeer(m.id, m.x, m.z);
      if (o.dying) return; m.t0 = performance.now(); o.in = m; break }
    case 'ev': { const o = peer(m.id); if (o && !o.dying && m.k === 'katk') withRig(o.rig, () => { b.kq = 1; b.kqt = .5 }); break }
    case 'dmg': {
      const p = NET.pl[m.id]; if (p) p.hp = m.hp;
      if (m.id === NET.id) {
        me.hp = m.hp; flash.style.opacity = 1; setTimeout(() => flash.style.opacity = 0, 60);
        const ux = m.ux; b.sbv = (b.sbv || 0) + ux * .2; b.hrv = (b.hrv || 0) + ux * .05; b.vx += ux * 1.5; head.vx += ux * 6; head.vy += m.uy * 2; b.fz = Math.max(b.fz || 0, 2); shk = Math.max(shk, 3.5);
        hitFx(m.hx, m.hy, m.ux, m.uy, m.part === 'h'); try { vib([30, 20, 30]) } catch (e) {}
      } else { const o = peer(m.id); if (o) o.hp = m.hp; if (m.by !== NET.id) fx(m, false) }
      break }
    case 'kill': {
      const p = NET.pl[m.id], by = NET.pl[m.by]; if (p) { p.dead = true; p.hp = 0; p.d = m.vd } if (by) by.k = m.kk;
      addFeed('<b>' + esc(nm(m.by)) + '</b> ' + ['(AK)', '(Glock)', '(M4)', '(Benelli)'][m.w | 0] + ' ➜ <b>' + esc(nm(m.id)) + '</b>');
      const hs = m.part === 'h';
      if (m.id === NET.id) {
        me.hp = 0; ME.dead = true; fireS = false; ax = ay = mx = my = 0;
        KPW = m.pw || 1; const c = makeCorpse(m.ux, m.uy, m.part, m.hx, m.hy, true); KPW = 1;
        try { bloodHit(null, c, m.hx, m.hy, m.ux, m.uy, hs, true, c.gy) } catch (e) {}
        shk = 6; flash.style.opacity = 1; setTimeout(() => flash.style.opacity = 0, 120);
        deadUntil = performance.now() + 3000; deadMsg = 'Dibunuh oleh ' + esc(nm(m.by)); deadEl.style.display = 'flex';
      } else {
        const o = peer(m.id);
        if (o && !o.dying) {
          if (m.by !== NET.id) fx(m, true);
          const ux = m.ux, uy = m.uy, PW = m.pw || 1, k = (hs ? 1.3 : 1) * PW;
          o.hp = 0; o.dying = { ux, uy, part: m.part, hx: m.hx, hy: m.hy, t: 0, pw: PW };
          withRig(o.rig, () => { b.dyg = o.dying; b.dyt = 0; b.hrv = ux * .004 * k; b.sbv = (b.sbv || 0) + ux * .16 * k; b.hxv = ux * 1.2 * k; b.vx = cl(b.vx, -1, 1) + ux * .8 * PW; b.fz = 2.2; head.vx += ux * 7 * k; head.vy += uy * 3 * k - (hs ? 3 : 1.2); gA.vx += ux * 2 * PW; gA.vy += uy * 1.2 - 1.4; gA.vr += ux * .1 * PW; for (const F of foot) { F.vx += ux * 1.4 * PW; F.vy -= (1 + Math.random()) * (PW > 1 ? 1.6 : 1) } });
        }
      }
      break }
    case 'resp': {
      const p = NET.pl[m.id]; if (p) { p.dead = false; p.hp = m.hp }
      if (m.id === NET.id) respawnLocal(m.x, m.z);
      else { const o = peer(m.id); if (o) { bots.splice(bots.indexOf(o), 1) } mkPeer(m.id, m.x, m.z) }
      break }
    case 'pp': NET.ping = Math.round(performance.now() - m.ts); break;
  }
}

// ---------- dipanggil dari game ----------
NET.hit = (o, q, part, hx, hy, ux, uy) => send({ t: 'hit', v: o.nid, w: q.w == null ? 0 : q.w, part, ux: r2(ux), uy: r2(uy), hx: Math.round(hx), hy: Math.round(hy), pw: q.pw || 1 });
NET.ev = k => send({ t: 'ev', k });
NET.bar = o => {
  const w = 44, x0 = b.x - w / 2, y = head.y - IM.Head5.height * K * .55 - 14, hp = Math.max(0, o.hp);
  ctx.fillStyle = 'rgba(10,10,12,.72)'; ctx.fillRect(x0 - 2, y - 2, w + 4, 8);
  ctx.fillStyle = hp > 35 ? '#58e070' : '#e05a4a'; ctx.fillRect(x0, y, w * hp / 100, 4);
  ctx.font = '700 13px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)';
  ctx.strokeText(o.name, b.x, y - 6); ctx.fillStyle = '#fff'; ctx.fillText(o.name, b.x, y - 6); ctx.textAlign = 'left';
};
// jalankan rig pemain lain: input yang sama dengan pengirim + koreksi posisi + sinkron senjata/safety/pisau/reload
NET.drive = (o, f) => {
  const i = o.in, now = performance.now();
  if (!i || now - i.t0 > 700) { mx = my = ax = ay = 0; fireS = false; if (i) { o.in = null } step(f); return }
  mx = i.mx; my = i.my; ax = i.ax; ay = i.ay; fireS = !!i.fs;
  const gw = i.gw | 0;
  if ((b.gw | 0) !== gw && b.sw < 0 && b.rl < 0 && b.wt < 0 && !b.fn) { if (b.wm) setGun(gw); else { b.sw = 0; b.swG = gw; b.swd = 0; b.safe = true; ax = ay = 0; fireS = false } }
  if (!!b.wm !== !!i.wm && b.wt < 0 && b.sw < 0 && b.rl < 0 && !b.fn) { b.wto = i.wm ? 1 : 0; b.wt = 0; b.ck = -1; b.sl = -1; b.kq = 0; b.katk = 0; b.kfl = -1; b.gsi = 0; ax = ay = 0; fireS = false }
  if (!!b.fsafe !== !!i.sf && b.sw < 0 && b.wt < 0 && !b.wm) startSw(!!i.sf);
  if (i.rl && b.rl < 0) { b.rmNext = i.rm | 0; reload() }
  else if (!i.rl && b.rl < 0 && ammo !== i.am) ammo = i.am;
  const age = Math.min(6, (now - i.t0) / 16.667), px = i.x + i.vx * age, pz = i.z + i.vz * age, dx = px - b.x, dz = pz - b.z;
  if (Math.abs(dx) > 350 || Math.abs(dz) > 200) { b.x = px; b.z = pz } else { const k = 1 - Math.pow(.85, f); b.x += dx * k; b.z += dz * k }
  o.hx = b.x; o.hz = b.z; step(f);
};
// tiap frame: kirim state ~20x/detik, ping, HUD
NET.frame = (t, f) => {
  if (!NET.on) return; const now = performance.now();
  if (now - sendAt >= 50 && !ME.dead) {
    sendAt = now;
    send({ t: 's', x: r2(b.x), z: r2(b.z), vx: r2(b.vx), vz: r2(b.vz), mx: r2(mx), my: r2(my), ax: r2(ax), ay: r2(ay),
      fs: (fireS || KY.Space || KY.KeyF) ? 1 : 0, gw: b.gw | 0, sf: b.fsafe ? 1 : 0, wm: b.wm ? 1 : 0, am: ammo, rl: b.rl >= 0 ? 1 : 0, rm: b.rm | 0 });
  }
  if (now - pingAt > 2000) { pingAt = now; send({ t: 'p', ts: now }) }
  if (now - hudAt > 250) {
    hudAt = now; document.getElementById('mphp').style.width = Math.max(0, me.hp) + '%';
    document.getElementById('mphp').style.background = me.hp > 35 ? '#58e070' : '#e05a4a';
    document.getElementById('mpk').textContent = 'K ' + (me.k | 0) + ' / D ' + (me.d | 0);
    document.getElementById('mpp').textContent = NET.ping + ' ms · ' + Object.keys(NET.pl).length + ' org';
    const L = Object.values(NET.pl).sort((a, c) => c.k - a.k || a.d - c.d).slice(0, 5);
    document.getElementById('mpb').innerHTML = L.map(p => '<div class="' + (p.id === NET.id ? 'me' : '') + '"><span>' + esc(p.name) + '</span><span>' + (p.k | 0) + '/' + (p.d | 0) + '</span></div>').join('');
    if (feed.length && feed[0].u < now) { feed = feed.filter(x => x.u > now); drawFeed() }
    if (ME.dead) deadEl.innerHTML = deadMsg + '<small>Respawn dalam ' + Math.max(0, Math.ceil((deadUntil - now) / 1000)) + '...</small>';
  }
};
})();
