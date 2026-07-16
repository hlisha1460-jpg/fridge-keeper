// ── 冰箱管家 v4 ── Supabase REST API 持久化 ──────────────────────────
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, ".data", "db.json");

// Supabase REST API config (set via Railway environment variables)
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";

// ── Middleware ────────────────────────────────────────────────────────
app.use(express.json());
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (_req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ── Data Layer · Supabase REST API ────────────────────────────────────
let storageMode = "file";

async function supabaseFetch(method, path, body) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };
  // upsert: insert or update on PK conflict
  if (method === "POST") headers["Prefer"] = "resolution=merge-duplicates";
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${path}: ${res.status} ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function initDB() {
  console.log("DATABASE_URL:", process.env.DATABASE_URL ? "已设置" : "未设置");
  // Use Supabase REST API (HTTPS → works on any network incl. IPv4-only)
  try {
    await supabaseFetch("GET", "fridge_data?select=key&limit=1");
    storageMode = "supabase";
    console.log("✅ 已连接 Supabase REST API (HTTPS)");
  } catch (e) {
    console.error("Supabase REST 初始化失败，降级到文件存储:", e.message);
    storageMode = "file";
  }
}

// ── File storage (fallback) ───────────────────────────────────────────
function loadDBFile() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
      return { rooms: db.rooms || {}, members: db.members || {} };
    }
  } catch (e) { console.error("DB load error:", e.message); }
  return { rooms: {}, members: {} };
}

function saveDBFile(db) {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf-8");
  fs.renameSync(tmp, DB_PATH);
}

// ── Unified load/save ─────────────────────────────────────────────────
async function loadDB() {
  if (storageMode !== "supabase") return loadDBFile();
  try {
    const rows = await supabaseFetch("GET", "fridge_data?key=eq.db&select=value");
    if (!rows || rows.length === 0) return { rooms: {}, members: {} };
    const data = rows[0].value;
    return { rooms: data.rooms || {}, members: data.members || {} };
  } catch (e) {
    console.error("Supabase load error:", e.message);
    return loadDBFile();
  }
}

async function saveDB(db) {
  if (storageMode !== "supabase") return saveDBFile(db);
  try {
    await supabaseFetch("POST", "fridge_data", {
      key: "db",
      value: db,
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Supabase save error:", e.message);
    saveDBFile(db);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────
function genId(len = 10) {
  return crypto.randomBytes(len).toString("hex").slice(0, len);
}

function genRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function sanitizeRoom(room) {
  return {
    code: room.code,
    name: room.name,
    members: room.members.map((m) => ({ id: m.id, name: m.name })),
    items: Object.values(room.items),
  };
}

// ── API: Health ───────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    time: Date.now(),
    version: "v4-rest",
    storage: storageMode,
    supabase_url_set: !!SUPABASE_URL,
    supabase_key_set: !!SUPABASE_KEY,
  });
});

// ── API: Rooms ────────────────────────────────────────────────────────
app.post("/api/rooms", async (req, res) => {
  const { name, userName } = req.body;
  if (!name || !userName) return res.status(400).json({ error: "Missing name or userName" });

  const db = await loadDB();
  const roomCode = genRoomCode();
  const memberId = genId(8);

  db.rooms[roomCode] = {
    code: roomCode,
    name: String(name).slice(0, 30),
    createdAt: Date.now(),
    members: [{ id: memberId, name: String(userName).slice(0, 20), joinedAt: Date.now() }],
    items: {},
  };
  db.members[memberId] = { name: String(userName).slice(0, 20), rooms: [roomCode] };
  await saveDB(db);

  res.json({ ok: true, roomCode, memberId, room: sanitizeRoom(db.rooms[roomCode]) });
});

app.post("/api/rooms/:code/join", async (req, res) => {
  const { code } = req.params;
  const { userName } = req.body;
  if (!userName) return res.status(400).json({ error: "Missing userName" });

  const db = await loadDB();
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: "房间不存在" });

  let member = room.members.find((m) => m.name === String(userName).slice(0, 20));
  let memberId;
  if (member) {
    memberId = member.id;
  } else {
    memberId = genId(8);
    member = { id: memberId, name: String(userName).slice(0, 20), joinedAt: Date.now() };
    room.members.push(member);
  }

  if (!db.members[memberId]) {
    db.members[memberId] = { name: String(userName).slice(0, 20), rooms: [code] };
  } else if (!db.members[memberId].rooms.includes(code)) {
    db.members[memberId].rooms.push(code);
  }

  await saveDB(db);
  res.json({ ok: true, memberId, room: sanitizeRoom(room) });
});

app.get("/api/rooms/:code", async (req, res) => {
  const { code } = req.params;
  const db = await loadDB();
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: "房间不存在" });
  res.json({ ok: true, room: sanitizeRoom(room) });
});

// ── API: Items ────────────────────────────────────────────────────────
app.post("/api/rooms/:code/items", async (req, res) => {
  const { code } = req.params;
  const db = await loadDB();
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: "房间不存在" });

  const itemId = genId(10);
  const now = Date.now();
  const item = {
    id: itemId,
    name: String(req.body.name || "").slice(0, 30),
    category: req.body.category || "other",
    expiryDate: req.body.expiryDate || "",
    quantity: Number(req.body.quantity) || 1,
    unit: String(req.body.unit || "份").slice(0, 10),
    note: String(req.body.note || "").slice(0, 100),
    addedBy: String(req.body.addedBy || "").slice(0, 20),
    addedAt: now,
    updatedAt: now,
  };

  room.items[itemId] = item;
  await saveDB(db);
  res.json({ ok: true, item });
});

app.put("/api/rooms/:code/items/:itemId", async (req, res) => {
  const { code, itemId } = req.params;
  const db = await loadDB();
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: "房间不存在" });
  if (!room.items[itemId]) return res.status(404).json({ error: "食材不存在" });

  const existing = room.items[itemId];
  const updated = {
    ...existing,
    name: req.body.name !== undefined ? String(req.body.name).slice(0, 30) : existing.name,
    category: req.body.category !== undefined ? req.body.category : existing.category,
    expiryDate: req.body.expiryDate !== undefined ? req.body.expiryDate : existing.expiryDate,
    quantity: req.body.quantity !== undefined ? Number(req.body.quantity) : existing.quantity,
    unit: req.body.unit !== undefined ? String(req.body.unit).slice(0, 10) : existing.unit,
    note: req.body.note !== undefined ? String(req.body.note).slice(0, 100) : existing.note,
    updatedAt: Date.now(),
  };

  room.items[itemId] = updated;
  await saveDB(db);
  res.json({ ok: true, item: updated });
});

app.delete("/api/rooms/:code/items/:itemId", async (req, res) => {
  const { code, itemId } = req.params;
  const db = await loadDB();
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: "房间不存在" });
  delete room.items[itemId];
  await saveDB(db);
  res.json({ ok: true });
});

// ── Static Files ──────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Start ─────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`冰箱管家 v4 (${storageMode}) → port ${PORT}`);
  });
});
