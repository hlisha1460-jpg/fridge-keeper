// ── 冰箱管家 v3 ── PostgreSQL 持久化 ─────────────────────────────────
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, ".data", "db.json");

// ── Middleware ────────────────────────────────────────────────────────
app.use(express.json());

// CORS - allow all origins for family sharing
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (_req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ── Data Layer ────────────────────────────────────────────────────────
let pool = null;
let _diag = { db_url_set: false, db_url_prefix: "", error: "", tried_ssl: false, pg_available: false };

async function initDB() {
  // Check if pg module is available
  try {
    require.resolve("pg");
    _diag.pg_available = true;
  } catch (_) {
    _diag.pg_available = false;
  }

  const dbUrl = process.env.DATABASE_URL;
  _diag.db_url_set = !!dbUrl;
  if (dbUrl) {
    _diag.db_url_prefix = dbUrl.substring(0, 40) + "...";
  }

  if (!dbUrl) {
    console.log("⚠ DATABASE_URL 未设置，使用文件存储");
    _diag.error = "DATABASE_URL 未设置";
    return;
  }

  // Try with SSL (Supabase requires it)
  pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    family: 4, // 强制 IPv4（Railway 不支持 IPv6）
  });
  _diag.tried_ssl = true;
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS fridge_data (key TEXT PRIMARY KEY, value JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
    console.log("✅ 已连接 PostgreSQL");
    _diag.error = "";
  } catch (e) {
    console.error("PostgreSQL 初始化失败:", e.message);
    _diag.error = e.message;
    try { pool.end(); } catch (_) {}
    pool = null;
  }
}

function loadDBFile() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, "utf-8");
      const db = JSON.parse(raw);
      return { rooms: db.rooms || {}, members: db.members || {} };
    }
  } catch (e) {
    console.error("DB load error:", e.message);
  }
  return { rooms: {}, members: {} };
}

function saveDBFile(db) {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf-8");
  fs.renameSync(tmp, DB_PATH);
}

async function loadDB() {
  if (!pool) return loadDBFile();
  try {
    const { rows } = await pool.query("SELECT value FROM fridge_data WHERE key = $1", ["db"]);
    if (rows.length === 0) return { rooms: {}, members: {} };
    const data = rows[0].value;
    return { rooms: data.rooms || {}, members: data.members || {} };
  } catch (e) {
    console.error("PG load error:", e.message);
    return loadDBFile();
  }
}

async function saveDB(db) {
  if (!pool) return saveDBFile(db);
  try {
    await pool.query(
      "INSERT INTO fridge_data (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()",
      ["db", JSON.stringify(db)]
    );
  } catch (e) {
    console.error("PG save error:", e.message);
    saveDBFile(db);
  }
}

function genId(len = 10) {
  return crypto.randomBytes(len).toString("hex").slice(0, len);
}

function genRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I,O,0,1 for clarity
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ── API: Health ───────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: Date.now(), storage: pool ? "postgresql" : "file" });
});

// Diagnostic: see what's wrong with PostgreSQL connection
app.get("/api/diag", (_req, res) => {
  res.json({
    storage: pool ? "postgresql" : "file",
    pg_available: _diag.pg_available,
    db_url_set: _diag.db_url_set,
    db_url_prefix: _diag.db_url_prefix,
    tried_ssl: _diag.tried_ssl,
    error: _diag.error,
    node_version: process.version,
    env_keys: Object.keys(process.env).filter(k => k.includes("DB") || k.includes("PG") || k.includes("DATABASE")),
  });
});

// ── API: Rooms ────────────────────────────────────────────────────────
// Create room
app.post("/api/rooms", async (req, res) => {
  const { name, userName } = req.body;
  if (!name || !userName) {
    return res.status(400).json({ error: "Missing name or userName" });
  }

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

  res.json({
    ok: true,
    roomCode,
    memberId,
    room: sanitizeRoom(db.rooms[roomCode], memberId),
  });
});

// Join room
app.post("/api/rooms/:code/join", async (req, res) => {
  const { code } = req.params;
  const { userName } = req.body;
  if (!userName) {
    return res.status(400).json({ error: "Missing userName" });
  }

  const db = await loadDB();
  const room = db.rooms[code];
  if (!room) {
    return res.status(404).json({ error: "房间不存在" });
  }

  // Check if this name already exists in room → reuse
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

  res.json({
    ok: true,
    memberId,
    room: sanitizeRoom(room, memberId),
  });
});

// Get room (full state for sync)
app.get("/api/rooms/:code", async (req, res) => {
  const { code } = req.params;
  const db = await loadDB();
  const room = db.rooms[code];
  if (!room) {
    return res.status(404).json({ error: "房间不存在" });
  }

  res.json({
    ok: true,
    room: sanitizeRoom(room),
  });
});

// ── API: Items ────────────────────────────────────────────────────────
// Add item
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

// Update item
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

// Delete item
app.delete("/api/rooms/:code/items/:itemId", async (req, res) => {
  const { code, itemId } = req.params;
  const db = await loadDB();
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: "房间不存在" });

  delete room.items[itemId];
  await saveDB(db);

  res.json({ ok: true });
});

// ── Helpers ───────────────────────────────────────────────────────────
function sanitizeRoom(room, memberId) {
  return {
    code: room.code,
    name: room.name,
    members: room.members.map((m) => ({ id: m.id, name: m.name })),
    items: Object.values(room.items),
  };
}

// ── Static Files (after API routes) ───────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

// SPA fallback: serve index.html for any non-API GET
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Start ─────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log("冰箱管家后端已启动 → http://localhost:" + PORT);
  });
});
