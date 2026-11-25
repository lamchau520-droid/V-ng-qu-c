"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const PUB = path.join(__dirname, "public");
const T0 = Date.now(), DAY_MS = 300000; // 1 ngày trong game = 5 phút thật
let dayOff = 0;
const dayNow = () => ((((Date.now() - T0) / DAY_MS + 0.25 + dayOff) % 1) + 1) % 1;

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent((req.url || "/").split("?")[0]); } catch (e) { res.writeHead(400); return res.end(); }
  if (url === "/healthz") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("ok"); }
  const rel = url === "/" ? "index.html" : url.replace(/^\/+/, "");
  const file = path.normalize(path.join(PUB, rel));
  if (!file.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
});

/* ===== Vườn chung: 8 ô, lưu trong bộ nhớ server (mất khi server khởi động lại) ===== */
const W = 80;
const CROPS_S = { carrot: { n: "Cà rốt", t: 8, item: "carrot", qty: 1 }, straw: { n: "Dâu", t: 12, item: "straw", qty: 1 }, pump: { n: "Bí ngô", t: 18, item: "pump", qty: 1 } };
const PLOTN = 8;
const plotX = p => 41 + (p % 4) * 9, plotY = p => 4 + ((p / 4) | 0) * 11;
function plotAt(x, y){
  for (let p = 0; p < PLOTN; p++) { const x0 = plotX(p), y0 = plotY(p); if (x >= x0 && x < x0 + 6 && y >= y0 && y < y0 + 7) return p; }
  return -1;
}
const plots = Array.from({ length: PLOTN }, () => ({ owner: null, name: "", tiles: {} }));

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 1024 });
let nextId = 1;
const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const all = o => { const s = JSON.stringify(o); wss.clients.forEach(c => { if (c.readyState === 1 && c.p) c.send(s); }); };
const num = (v, lo, hi) => Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo;
function keyOk(k){
  if (!ADMIN_KEY) return false;
  const a = Buffer.from(String(k)), b = Buffer.from(ADMIN_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

wss.on("connection", ws => {
  ws.p = null; ws.admin = false; ws.alive = true; ws.lastChat = 0; ws.fails = 0;
  ws.on("pong", () => { ws.alive = true; });
  ws.on("error", () => {});
  ws.on("message", raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== "string") return;
    if (m.t === "hello") {
      if (ws.p) return;
      const id = nextId++;
      ws.uid = clean(m.u, 40) || ("u" + id);
      plots.forEach(pl => { if (pl.owner === ws.uid) pl.name = clean(m.n, 12) || "Khách" + id; });
      ws.p = { id, n: clean(m.n, 12) || "Khách" + id, g: m.g === "girl" ? "girl" : "boy", x: 0, y: 0, f: "down", m: 0, r: "out" };
      send(ws, { t: "welcome", id }); send(ws, { t: "day", d: dayNow() });
      all({ t: "sys", m: ws.p.n + " đã vào làng" });
      return;
    }
    if (!ws.p) return;
    const p = ws.p;
    if (m.t === "pos") {
      p.x = num(m.x, 0, 4000); p.y = num(m.y, 0, 4000);
      if (["up", "down", "left", "right"].includes(m.f)) p.f = m.f;
      p.m = (m.m | 0) & 255;
      p.r = ["out", "home", "shop"].includes(m.r) ? m.r : "out";
    } else if (m.t === "chat") {
      const now = Date.now(), txt = clean(m.m, 120);
      if (!txt || now - ws.lastChat < 500) return;
      ws.lastChat = now;
      const s = JSON.stringify({ t: "chat", id: p.id, n: p.n, m: txt });
      wss.clients.forEach(c => { if (c !== ws && c.readyState === 1 && c.p) c.send(s); });
    } else if (m.t === "login") {
      if (ws.fails >= 5) return send(ws, { t: "login", ok: false });
      ws.admin = keyOk(m.k); if (!ws.admin) ws.fails++;
      send(ws, { t: "login", ok: ws.admin });
    } else if (m.t === "gclaim") {
      const pi = Number.isInteger(m.p) ? m.p : -1;
      if (!plots[pi]) return;
      if (plots[pi].owner) return send(ws, { t: "gmsg", m: "Ô này đã có chủ rồi" });
      if (plots.some(pl => pl.owner === ws.uid)) return send(ws, { t: "gmsg", m: "Bạn đã có một ô vườn rồi" });
      plots[pi].owner = ws.uid; plots[pi].name = p.n;
      send(ws, { t: "gmsg", m: "Bạn đã nhận ô vườn số " + (pi + 1) });
    } else if (m.t === "gact") {
      const pi = Number.isInteger(m.p) ? m.p : -1, id = Number.isInteger(m.id) ? m.id : -1;
      const pl = plots[pi]; if (!pl || id < 0) return;
      if (plotAt(id % W, Math.floor(id / W)) !== pi) return;
      const key = String(id), tile = pl.tiles[key] || { tl: 0, c: null }, mine = pl.owner === ws.uid;
      if (m.a === "water") { if (tile.c && !tile.c.w && tile.c.s < 3) tile.c.w = true; }
      else if (!mine) return;
      else if (m.a === "hoe") { tile.tl = 1; }
      else if (m.a === "seed") { if (!tile.tl || tile.c || !CROPS_S[m.seed]) return; tile.c = { t: m.seed, s: 0, p: 0, w: false }; }
      else if (m.a === "harvest") {
        if (!tile.c || tile.c.s < 3) return;
        const d = CROPS_S[tile.c.t]; send(ws, { t: "gitem", k: d.item, q: d.qty, n: d.n }); tile.c = null;
      }
      else return;
      if (tile.tl || tile.c) pl.tiles[key] = tile; else delete pl.tiles[key];
    } else if (m.t === "gio") {
      if (!ws.admin || !Number.isFinite(m.v)) return;
      dayOff = (((m.v % 24) + 24) % 24) / 24 - ((Date.now() - T0) / DAY_MS + 0.25);
      all({ t: "day", d: dayNow() });
    }
  });
  ws.on("close", () => { if (ws.p) all({ t: "sys", m: ws.p.n + " đã rời làng" }); });
});

setInterval(() => { // đồng bộ vị trí người chơi 10 lần/giây
  const list = []; wss.clients.forEach(c => { if (c.p) list.push(c.p); });
  if (!list.length) return;
  const s = JSON.stringify({ t: "players", p: list });
  wss.clients.forEach(c => { if (c.p && c.readyState === 1) c.send(s); });
}, 100);
setInterval(() => all({ t: "day", d: dayNow() }), 5000);
setInterval(() => { // lớn cây trong vườn chung
  plots.forEach(pl => { for (const k in pl.tiles) { const c = pl.tiles[k].c; if (c && c.s < 3 && c.w) { c.p += 1; if (c.p >= CROPS_S[c.t].t) { c.s++; c.p = 0; c.w = false; } } } });
}, 1000);
setInterval(() => { // gửi trạng thái vườn chung, mỗi người thấy cờ "m" = ô của mình
  wss.clients.forEach(c => { if (!c.p || c.readyState !== 1) return;
    send(c, { t: "gardens", pl: plots.map((pl, i) => ({ p: i, o: pl.name, m: pl.owner === c.uid, tiles: pl.tiles })) });
  });
}, 1000);
setInterval(() => wss.clients.forEach(c => { if (!c.alive) return c.terminate(); c.alive = false; c.ping(); }), 30000);

server.listen(PORT, () => console.log("Vườn Câu Pixel online chạy ở cổng " + PORT + (ADMIN_KEY ? "" : " (chưa đặt ADMIN_KEY: lệnh admin bị khóa khi chơi online)")));
