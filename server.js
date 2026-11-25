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
setInterval(() => wss.clients.forEach(c => { if (!c.alive) return c.terminate(); c.alive = false; c.ping(); }), 30000);

server.listen(PORT, () => console.log("Vườn Câu Pixel online chạy ở cổng " + PORT + (ADMIN_KEY ? "" : " (chưa đặt ADMIN_KEY: lệnh admin bị khóa khi chơi online)")));
