"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "accounts.json");
const PUB = path.join(__dirname, "public");
const T0 = Date.now(), DAY_MS = 300000; // 1 ngày trong game = 5 phút thật
let dayOff = 0;
const dayNow = () => ((((Date.now() - T0) / DAY_MS + 0.25 + dayOff) % 1) + 1) % 1;

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".mp3": "audio/mpeg" };

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

/* ===== Hằng số phải khớp với client ===== */
const W = 112, FARM = { x0: 6, y0: 15, w: 10, h: 6 }; // luống đất làng: x 6..15, y 15..20
const CROPS_S = {
  carrot: { n: "Cà rốt", t: 8, item: "carrot", qty: 1 }, straw: { n: "Dâu", t: 12, item: "straw", qty: 1 }, pump: { n: "Bí ngô", t: 18, item: "pump", qty: 1 },
  tomato: { n: "Cà chua", t: 10, regrow: 8, multi: true, item: "tomato", qty: 1 },
  chili: { n: "Ớt", t: 14, regrow: 10, multi: true, item: "chili", qty: 1 },
  melon: { n: "Dưa hấu", t: 24, item: "melon", qty: 1 },
  grape: { n: "Nho", t: 12, regrow: 10, multi: true, item: "grape", qty: 1 },
  durian: { n: "Sầu riêng", t: 20, item: "durian", qty: 1 },
  mango: { n: "Xoài", t: 14, regrow: 12, multi: true, item: "mango", qty: 1 },
  corn: { n: "Bắp", t: 6, item: "corn", qty: 1 },
  apple: { n: "Táo", t: 12, regrow: 10, multi: true, item: "apple", qty: 1 },
  pine: { n: "Dứa", t: 16, item: "pine", qty: 1 },
  coconut: { n: "Dừa", t: 30, regrow: 20, multi: true, item: "coconut", qty: 1 }
};
const PLOTN = 8;
const plotX = p => 40 + (p % 2) * 14, plotY = p => 14 + (p >> 1) * 17;
// Ô vườn: luống 10x6 nằm dưới nhà. Luống trong ô tương ứng với luống đất làng.
function plotAt(x, y){
  for (let p = 0; p < PLOTN; p++) { const x0 = plotX(p), y0 = plotY(p); if (x >= x0 + 1 && x <= x0 + 10 && y >= y0 + 6 && y <= y0 + 11) return p; }
  return -1;
}
const gardenToVillage = (p, gx, gy) => ({ x: gx - (plotX(p) + 1) + FARM.x0, y: gy - (plotY(p) + 6) + FARM.y0 });
const villageToGarden = (p, vx, vy) => ({ x: vx - FARM.x0 + plotX(p) + 1, y: vy - FARM.y0 + plotY(p) + 6 });
const inFarm = (vx, vy) => vx >= FARM.x0 && vx < FARM.x0 + FARM.w && vy >= FARM.y0 && vy < FARM.y0 + FARM.h;

/* ===== Dữ liệu: tài khoản, bản lưu, chủ ô vườn ===== */
let accounts = Object.create(null);   // key (tên chữ thường) -> {name, salt, hash, tok, save}
const tokens = new Map();             // token -> key
const plots = Array.from({ length: PLOTN }, () => null); // key chủ ô hoặc null
let dirty = false;

function loadData(){
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    accounts = Object.assign(Object.create(null), d.accounts || {});
    if (Array.isArray(d.plots)) d.plots.forEach((k, i) => { if (i < PLOTN && k && accounts[k]) plots[i] = k; });
    for (const k in accounts) if (accounts[k].tok) tokens.set(accounts[k].tok, k);
    console.log("Đã tải " + Object.keys(accounts).length + " tài khoản từ " + DATA_FILE);
  } catch (e) { if (e.code !== "ENOENT") console.error("Không đọc được dữ liệu:", e.message); }
}
function flush(){
  if (!dirty) return; dirty = false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ accounts, plots }));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) { dirty = true; console.error("Không lưu được dữ liệu:", e.message); }
}
setInterval(flush, 3000);
process.on("SIGTERM", () => { flush(); process.exit(0); });

const newFarm = () => ({ gv: 4, tilled: {}, crops: {} });
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString("hex");
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const newToken = () => crypto.randomBytes(24).toString("hex");
const validName = n => /^[\p{L}\p{N} ]{2,12}$/u.test(n);

/* Lọc bản lưu gửi lên: chỉ nhận đúng phiên bản và ô đất/cây hợp lệ */
function sanitizeSave(s){
  if (!s || typeof s !== "object" || s.gv !== 4) return null;
  if (JSON.stringify(s).length > 200000) return null;
  const tilled = {}, crops = {};
  for (const k in (s.tilled || {})) {
    const id = +k, vx = id % W, vy = Math.floor(id / W);
    if (Number.isInteger(id) && id >= 0 && inFarm(vx, vy) && s.tilled[k]) tilled[id] = 1;
  }
  for (const k in (s.crops || {})) {
    const id = +k, c = s.crops[k], vx = id % W, vy = Math.floor(id / W);
    if (!Number.isInteger(id) || id < 0 || !inFarm(vx, vy) || !c || !CROPS_S[c.t]) continue;
    crops[id] = { t: c.t, s: Math.max(0, Math.min(3, c.s | 0)), p: Math.max(0, Math.min(999, +c.p || 0)), w: !!c.w, h: Math.max(0, c.h | 0) };
  }
  return Object.assign({}, s, { tilled, crops });
}

/* Tiles hiển thị trong ô vườn: lấy từ bản lưu của chủ ô */
function plotTiles(p, save){
  const out = {}; if (!save) return out;
  for (let vy = FARM.y0; vy < FARM.y0 + FARM.h; vy++) for (let vx = FARM.x0; vx < FARM.x0 + FARM.w; vx++) {
    const vid = vy * W + vx, tl = save.tilled && save.tilled[vid], c = save.crops && save.crops[vid];
    if (!tl && !c) continue;
    const g = villageToGarden(p, vx, vy);
    out[g.y * W + g.x] = { tl: tl ? 1 : 0, c: c || null };
  }
  return out;
}

/* ===== Mạng ===== */
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 300000 });
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

function loginAs(ws, key, tok){
  ws.acc = key;
  const msg = { t: "auth", ok: true, name: accounts[key].name, save: accounts[key].save };
  if (tok) msg.token = tok;
  send(ws, msg);
}

wss.on("connection", ws => {
  ws.p = null; ws.admin = false; ws.acc = null; ws.alive = true; ws.lastChat = 0; ws.fails = 0;
  ws.on("pong", () => { ws.alive = true; });
  ws.on("error", () => {});
  ws.on("message", raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== "string") return;

    /* Đăng ký, đăng nhập, đăng nhập bằng phiên (token) */
    if (m.t === "acc_reg" || m.t === "acc_login") {
      if (ws.fails >= 10) return send(ws, { t: "auth", ok: false, err: "Thử quá nhiều lần, đợi một lát rồi thử lại" });
      const name = clean(m.n, 12), pw = String(m.pw || "");
      if (!validName(name)) return send(ws, { t: "auth", ok: false, err: "Tên 2–12 ký tự: chữ, số hoặc khoảng trắng" });
      if (pw.length < 4 || pw.length > 60) return send(ws, { t: "auth", ok: false, err: "Mật khẩu 4–60 ký tự" });
      const k = name.toLowerCase();
      if (m.t === "acc_reg") {
        if (accounts[k]) return send(ws, { t: "auth", ok: false, err: "Tên này đã có người dùng" });
        const salt = crypto.randomBytes(16).toString("hex"), tok = newToken();
        accounts[k] = { name, salt, hash: hashPw(pw, salt), tok, save: null };
        tokens.set(tok, k); dirty = true;
        return loginAs(ws, k, tok);
      }
      const a = accounts[k];
      if (!a || !safeEq(hashPw(pw, a.salt), a.hash)) { ws.fails++; return send(ws, { t: "auth", ok: false, err: "Sai tên hoặc mật khẩu" }); }
      const tok = newToken(); tokens.delete(a.tok); a.tok = tok; tokens.set(tok, k); dirty = true;
      return loginAs(ws, k, tok);
    }
    if (m.t === "acc_token") {
      const k = tokens.get(String(m.tk || ""));
      if (!k) return send(ws, { t: "auth", ok: false, err: "Phiên đăng nhập hết hạn, hãy đăng nhập lại" });
      return loginAs(ws, k, null);
    }
    if (m.t === "sync") { // gửi bản lưu của máy: gộp ô đất, giữ thông tin nhân vật theo chủ tài khoản
      if (!ws.acc) return;
      const inc = sanitizeSave(m.save); if (!inc) return send(ws, { t: "gmsg", m: "Dữ liệu không hợp lệ, tải lại trang" });
      const a = accounts[ws.acc];
      if (!a.save) a.save = inc;
      else {
        const cur = a.save, merged = Object.assign({}, m.same ? inc : cur, { gv: 4 });
        merged.tilled = Object.assign({}, cur.tilled, inc.tilled);
        merged.crops = Object.assign({}, inc.crops, cur.crops); // cây trên server được ưu tiên
        a.save = merged;
      }
      dirty = true;
      return send(ws, { t: "synced", save: a.save });
    }
    if (m.t === "push") { // đang online: giữ luống đất trên server, nhận phần còn lại từ máy
      if (!ws.acc) return;
      const inc = sanitizeSave(m.save); if (!inc) return;
      const a = accounts[ws.acc];
      if (!a.save) { a.save = inc; }
      else a.save = Object.assign({}, inc, { gv: 4, tilled: a.save.tilled, crops: a.save.crops });
      dirty = true;
      return;
    }

    if (m.t === "hello") {
      if (ws.p || !ws.acc) return;
      const id = nextId++, name = accounts[ws.acc].name;
      ws.p = { id, n: name, g: m.g === "girl" ? "girl" : "boy", x: 0, y: 0, f: "down", m: 0, r: "out" };
      send(ws, { t: "welcome", id }); send(ws, { t: "day", d: dayNow() });
      all({ t: "sys", m: name + " đã vào làng" });
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
      if (!ws.acc || !Number.isInteger(m.p) || m.p < 0 || m.p >= PLOTN) return;
      if (plots[m.p]) return send(ws, { t: "gmsg", m: "Ô này đã có chủ rồi" });
      if (plots.includes(ws.acc)) return send(ws, { t: "gmsg", m: "Bạn đã có một ô vườn rồi" });
      plots[m.p] = ws.acc; accounts[ws.acc].save = accounts[ws.acc].save || newFarm(); dirty = true;
      send(ws, { t: "gmsg", m: "Bạn đã nhận ô vườn số " + (m.p + 1) });
    } else if (m.t === "gact") {
      if (!ws.acc) return;
      const pi = Number.isInteger(m.p) ? m.p : -1, gid = Number.isInteger(m.id) ? m.id : -1;
      if (pi < 0 || pi >= PLOTN || gid < 0) return;
      const gx = gid % W, gy = Math.floor(gid / W);
      if (plotAt(gx, gy) !== pi) return;
      const key = plots[pi]; if (!key) return;
      const owner = accounts[key]; owner.save = owner.save || newFarm();
      const v = gardenToVillage(pi, gx, gy), vid = v.y * W + v.x;
      const sv = owner.save; sv.tilled = sv.tilled || {}; sv.crops = sv.crops || {};
      const mine = key === ws.acc;
      if (m.a === "water") { const c = sv.crops[vid]; if (c && !c.w && c.s < 3) { c.w = true; dirty = true; } return; }
      if (!mine) return;
      if (m.a === "hoe") { sv.tilled[vid] = 1; }
      else if (m.a === "seed") { if (!sv.tilled[vid] || sv.crops[vid] || !CROPS_S[m.seed]) return; sv.crops[vid] = { t: m.seed, s: 0, p: 0, w: false }; }
      else if (m.a === "harvest") {
        const c = sv.crops[vid]; if (!c || c.s < 3) return;
        const d = CROPS_S[c.t]; send(ws, { t: "gitem", k: d.item, q: d.qty, n: d.n });
        if (d.multi) { c.s = 2; c.p = 0; c.w = false; c.h = (c.h | 0) + 1; } else delete sv.crops[vid];
      }
      else return;
      dirty = true;
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
setInterval(() => { // cây lớn trên bản lưu của mọi tài khoản, kể cả khi chủ đang offline
  for (const k in accounts) {
    const sv = accounts[k].save; if (!sv || !sv.crops) continue;
    for (const id in sv.crops) {
      const c = sv.crops[id];
      if (c.s < 3 && c.w) { const d = CROPS_S[c.t], need = (c.h && d.multi) ? d.regrow : d.t; c.p += 1; dirty = true; if (c.p >= need) { c.s++; c.p = 0; c.w = false; } }
    }
  }
}, 1000);
setInterval(() => { // trạng thái các ô vườn; mỗi người có cờ "m" cho ô của mình và luống của mình
  const base = plots.map((k, i) => k ? { p: i, o: accounts[k].name, tiles: plotTiles(i, accounts[k].save) } : { p: i, o: "", tiles: {} });
  wss.clients.forEach(c => {
    if (!c.p || c.readyState !== 1) return;
    const pl = base.map((b, i) => Object.assign({}, b, { m: plots[i] !== null && plots[i] === c.acc }));
    const msg = { t: "gardens", pl };
    if (c.acc && plots.includes(c.acc)) msg.farm = accounts[c.acc].save ? { tilled: accounts[c.acc].save.tilled, crops: accounts[c.acc].save.crops } : null;
    send(c, msg);
  });
}, 1000);
setInterval(() => wss.clients.forEach(c => { if (!c.alive) return c.terminate(); c.alive = false; c.ping(); }), 30000);

loadData();
server.listen(PORT, () => console.log("Vườn Câu Pixel online chạy ở cổng " + PORT + (ADMIN_KEY ? "" : " (chưa đặt ADMIN_KEY: lệnh admin bị khóa khi chơi online)")));
