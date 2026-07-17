// ── 冰箱管家 v5 ── 分表存储 · 并发安全 · 频率限制 ──────────────────
const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase REST API config (Railway 环境变量)
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";

// ── Rate Limiting ─────────────────────────────────────────────────────
const RATE_WINDOW = 60000; // 1 分钟窗口
const RATE_MAX    = 60;    // 每窗口最多 60 次请求
const rateMap = new Map();
setInterval(() => rateMap.clear(), RATE_WINDOW * 2); // 定期清理

function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = rateMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) { entry.count = 0; entry.start = now; }
  entry.count++;
  rateMap.set(ip, entry);
  if (entry.count > RATE_MAX) return res.status(429).json({ error: "请求过于频繁，请稍后再试" });
  next();
}

// ── Middleware ────────────────────────────────────────────────────────
app.use(express.json({ limit: "100kb" }));
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (_req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
app.use("/api", rateLimit);

// ── Data Layer · Supabase REST API (v5 分表) ─────────────────────────
let storageMode = "file";

async function supabaseFetch(method, table, opts = {}) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };

  // Query params
  if (opts.select) url += `?select=${opts.select}`;
  if (opts.filter) {
    const sep = url.includes("?") ? "&" : "?";
    url += `${sep}${opts.filter}`;
  }

  // Headers for upsert / returning
  if (method === "POST" && opts.upsert) {
    headers["Prefer"] = "resolution=merge-duplicates,return=representation";
  } else if (method === "POST") {
    headers["Prefer"] = "return=representation";
  }
  if (method === "PATCH") headers["Prefer"] = "return=representation";

  const fetchOpts = { method, headers };
  if (opts.body) fetchOpts.body = JSON.stringify(opts.body);

  const res = await fetch(url, fetchOpts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${table}: ${res.status} ${text.slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── Room CRUD ─────────────────────────────────────────────────────────
async function getRoom(code) {
  if (storageMode !== "supabase") throw new Error("not_supabase");
  const rows = await supabaseFetch("GET", "fridge_rooms", {
    filter: `code=eq.${encodeURIComponent(code)}`, select: "*",
  });
  return (rows && rows.length > 0) ? rows[0] : null;
}

async function createRoom(room) {
  return supabaseFetch("POST", "fridge_rooms", { body: room, upsert: true });
}

async function updateRoom(code, data) {
  return supabaseFetch("PATCH", "fridge_rooms", {
    filter: `code=eq.${encodeURIComponent(code)}`, body: data,
  });
}

async function deleteRoom(code) {
  // Delete items first, then room
  await supabaseFetch("DELETE", "fridge_items", {
    filter: `room_code=eq.${encodeURIComponent(code)}`,
  });
  return supabaseFetch("DELETE", "fridge_rooms", {
    filter: `code=eq.${encodeURIComponent(code)}`,
  });
}

// ── Item CRUD ─────────────────────────────────────────────────────────
async function getItems(roomCode) {
  return supabaseFetch("GET", "fridge_items", {
    filter: `room_code=eq.${encodeURIComponent(roomCode)}&order=expiry_date.asc`,
    select: "*",
  }) || [];
}

async function createItem(item) {
  return supabaseFetch("POST", "fridge_items", { body: item, upsert: true });
}

async function updateItem(id, data) {
  // 乐观锁：仅当 updated_at 匹配时才更新，防止并发覆盖
  const filter = `id=eq.${encodeURIComponent(id)}`;
  if (data._expectedVersion !== undefined) {
    return supabaseFetch("PATCH", "fridge_items", {
      filter: `${filter}&updated_at=eq.${data._expectedVersion}`,
      body: { ...data, updated_at: Date.now() },
    });
  }
  return supabaseFetch("PATCH", "fridge_items", {
    filter, body: { ...data, updated_at: Date.now() },
  });
}

async function deleteItem(id) {
  return supabaseFetch("DELETE", "fridge_items", {
    filter: `id=eq.${encodeURIComponent(id)}`,
  });
}

// ── Init ──────────────────────────────────────────────────────────────
async function initDB() {
  try {
    await supabaseFetch("GET", "fridge_rooms", { select: "code", filter: "limit=1" });
    storageMode = "supabase";
    console.log("✅ 已连接 Supabase (v5 分表架构)");
  } catch (e) {
    console.error("Supabase 不可用，降级到文件存储:", e.message);
    storageMode = "file";
    // 文件存储兜底
    const fs = require("fs");
    const DB_PATH = path.join(__dirname, ".data", "db.json");
    if (!global._fileDB) {
      try {
        global._fileDB = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
      } catch (_) { global._fileDB = { rooms: {} }; }
    }
    global._fileDBPath = DB_PATH;
    global._fileSaveDB = function(db) {
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(DB_PATH + ".tmp", JSON.stringify(db, null, 2), "utf-8");
      fs.renameSync(DB_PATH + ".tmp", DB_PATH);
    };
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

function sanitizeMembers(members) {
  if (!Array.isArray(members)) return [];
  return members.map((m) => ({ id: m.id, name: m.name }));
}

function sanitizeItem(item) {
  return {
    id: item.id,
    name: item.name || "",
    category: item.category || "other",
    expiryDate: item.expiry_date !== undefined ? item.expiry_date : (item.expiryDate || ""),
    quantity: item.quantity || 1,
    unit: item.unit || "份",
    note: item.note || "",
    addedBy: item.added_by !== undefined ? item.added_by : (item.addedBy || ""),
    updatedAt: item.updated_at || item.updatedAt || 0,
    addedAt: item.added_at || item.addedAt || 0,
  };
}

function sanitize(item) {
  return {
    name: String(item.name || "").slice(0, 30),
    category: item.category || "other",
    expiryDate: item.expiryDate || "",
    quantity: Number(item.quantity) || 1,
    unit: String(item.unit || "份").slice(0, 10),
    note: String(item.note || "").slice(0, 100),
    addedBy: String(item.addedBy || "").slice(0, 20),
  };
}

// ── API: Health ───────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true, time: Date.now(), version: "v5-tables",
    storage: storageMode,
  });
});

// ── API: Create Room ──────────────────────────────────────────────────
app.post("/api/rooms", async (req, res) => {
  const { name, userName } = req.body;
  if (!name || !userName) return res.status(400).json({ error: "请填写冰箱名称和昵称" });

  const roomCode = genRoomCode();
  const memberId = genId(8);
  const now = Date.now();
  const safeName = String(name).slice(0, 30);
  const safeUser = String(userName).slice(0, 20);

  if (storageMode === "supabase") {
    try {
      await createRoom({
        code: roomCode, name: safeName, owner_id: memberId,
        members: [{ id: memberId, name: safeUser, joinedAt: now }],
        created_at: now, updated_at: now,
      });
      return res.json({
        ok: true, roomCode, memberId,
        room: { code: roomCode, name: safeName,
          members: [{ id: memberId, name: safeUser }], items: [] },
      });
    } catch (e) {
      return res.status(500).json({ error: "创建失败：" + e.message });
    }
  }

  // File fallback
  const db = global._fileDB;
  db.rooms[roomCode] = { code: roomCode, name: safeName, ownerId: memberId,
    members: [{ id: memberId, name: safeUser, joinedAt: now }], items: {}, createdAt: now };
  global._fileSaveDB(db);
  res.json({ ok: true, roomCode, memberId,
    room: { code: roomCode, name: safeName,
      members: [{ id: memberId, name: safeUser }], items: [] } });
});

// ── API: Join Room ────────────────────────────────────────────────────
app.post("/api/rooms/:code/join", async (req, res) => {
  const { code } = req.params;
  const { userName } = req.body;
  if (!userName) return res.status(400).json({ error: "请输入昵称" });
  const safeUser = String(userName).slice(0, 20);

  if (storageMode === "supabase") {
    try {
      const room = await getRoom(code);
      if (!room) return res.status(404).json({ error: "房间不存在" });

      // 始终创建新成员，不用名字匹配（修复同名冲突）
      const memberId = genId(8);
      const members = Array.isArray(room.members) ? [...room.members] : [];
      members.push({ id: memberId, name: safeUser, joinedAt: Date.now() });

      await updateRoom(code, { members, updated_at: Date.now() });

      // 获取食材
      const items = await getItems(code);

      return res.json({
        ok: true, memberId,
        room: { code: room.code, name: room.name, members: sanitizeMembers(members),
          items: items.map(sanitizeItem) },
      });
    } catch (e) {
      return res.status(500).json({ error: "加入失败：" + e.message });
    }
  }

  // File fallback
  const db = global._fileDB;
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: "房间不存在" });
  // 在同名情况下也创建新成员
  const memberId = genId(8);
  room.members.push({ id: memberId, name: safeUser, joinedAt: Date.now() });
  global._fileSaveDB(db);
  res.json({ ok: true, memberId,
    room: { code: room.code, name: room.name,
      members: room.members, items: Object.values(room.items) } });
});

// ── API: Remove Member ────────────────────────────────────────────────
app.post("/api/rooms/:code/remove-member", async (req, res) => {
  const { code } = req.params;
  const { memberId } = req.body;
  if (!memberId) return res.status(400).json({ error: "请指定要移除的成员" });

  if (storageMode === "supabase") {
    try {
      const room = await getRoom(code);
      if (!room) return res.status(404).json({ error: "房间不存在" });

      // 不能移除创建者
      if (room.owner_id === memberId) {
        return res.status(403).json({ error: "不能移除冰箱创建者" });
      }

      const members = (Array.isArray(room.members) ? room.members : [])
        .filter((m) => m.id !== memberId);

      await updateRoom(code, { members, updated_at: Date.now() });
      return res.json({ ok: true, members: sanitizeMembers(members) });
    } catch (e) {
      return res.status(500).json({ error: "移除失败：" + e.message });
    }
  }

  res.status(500).json({ error: "当前模式不支持此操作" });
});

// ── API: Get Room ─────────────────────────────────────────────────────
app.get("/api/rooms/:code", async (req, res) => {
  const { code } = req.params;

  if (storageMode === "supabase") {
    try {
      const room = await getRoom(code);
      if (!room) return res.status(404).json({ error: "房间不存在" });

      const items = await getItems(code);

      return res.json({
        ok: true,
        room: {
          code: room.code, name: room.name,
          members: sanitizeMembers(room.members),
          ownerId: room.owner_id,
          items: items.map(sanitizeItem),
        },
      });
    } catch (e) {
      return res.status(500).json({ error: "获取失败：" + e.message });
    }
  }

  // File fallback
  const db = global._fileDB;
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: "房间不存在" });
  res.json({ ok: true,
    room: { code: room.code, name: room.name,
      members: room.members, items: Object.values(room.items) } });
});

// ── API: Add Item ─────────────────────────────────────────────────────
app.post("/api/rooms/:code/items", async (req, res) => {
  const { code } = req.params;
  const clean = sanitize(req.body);
  if (!clean.name) return res.status(400).json({ error: "请输入食材名称" });

  const itemId = genId(10);
  const now = Date.now();

  if (storageMode === "supabase") {
    try {
      const room = await getRoom(code);
      if (!room) return res.status(404).json({ error: "房间不存在" });

      const item = {
        id: itemId, room_code: code, name: clean.name,
        category: clean.category, expiry_date: clean.expiryDate,
        quantity: clean.quantity, unit: clean.unit, note: clean.note,
        added_by: clean.addedBy, updated_at: now, added_at: now,
      };
      await createItem(item);

      // 更新房间时间戳
      await updateRoom(code, { updated_at: now });

      return res.json({ ok: true, item: sanitizeItem(item) });
    } catch (e) {
      return res.status(500).json({ error: "添加失败：" + e.message });
    }
  }

  // File fallback
  const db = global._fileDB;
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: "房间不存在" });
  const item = { id: itemId, name: clean.name, category: clean.category,
    expiryDate: clean.expiryDate, quantity: clean.quantity, unit: clean.unit,
    note: clean.note, addedBy: clean.addedBy, addedAt: now, updatedAt: now };
  room.items[itemId] = item;
  global._fileSaveDB(db);
  res.json({ ok: true, item });
});

// ── API: Update Item (带版本检查) ──────────────────────────────────────
app.put("/api/rooms/:code/items/:itemId", async (req, res) => {
  const { code, itemId } = req.params;
  const clean = sanitize(req.body);

  if (storageMode === "supabase") {
    try {
      // 先查当前版本
      const rows = await supabaseFetch("GET", "fridge_items", {
        filter: `id=eq.${encodeURIComponent(itemId)}&room_code=eq.${encodeURIComponent(code)}`,
        select: "updated_at",
      });
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: "食材不存在" });
      }

      const serverVersion = rows[0].updated_at;
      const clientVersion = req.body._clientVersion;
      const now = Date.now();

      // 版本检查：如果客户端版本落后于服务端，说明被他人修改过
      if (clientVersion !== undefined && serverVersion !== clientVersion) {
        return res.status(409).json({
          error: "该食材已被他人修改，请刷新后重试",
          conflict: true, serverVersion, clientVersion,
        });
      }

      const updateData = {
        name: clean.name, category: clean.category,
        expiry_date: clean.expiryDate, quantity: clean.quantity,
        unit: clean.unit, note: clean.note, updated_at: now,
      };

      const updated = await supabaseFetch("PATCH", "fridge_items", {
        filter: `id=eq.${encodeURIComponent(itemId)}`,
        body: updateData,
      });

      await updateRoom(code, { updated_at: now });

      return res.json({
        ok: true,
        item: updated && updated.length > 0 ? sanitizeItem(updated[0]) : { ...updateData, id: itemId },
      });
    } catch (e) {
      return res.status(500).json({ error: "更新失败：" + e.message });
    }
  }

  // File fallback
  const db = global._fileDB;
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: "房间不存在" });
  const existing = room.items[itemId];
  if (!existing) return res.status(404).json({ error: "食材不存在" });
  const updated = { ...existing, ...clean, updatedAt: Date.now() };
  room.items[itemId] = updated;
  global._fileSaveDB(db);
  res.json({ ok: true, item: updated });
});

// ── API: Delete Item ──────────────────────────────────────────────────
app.delete("/api/rooms/:code/items/:itemId", async (req, res) => {
  const { code, itemId } = req.params;

  if (storageMode === "supabase") {
    try {
      await deleteItem(itemId);
      await updateRoom(code, { updated_at: Date.now() });
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: "删除失败：" + e.message });
    }
  }

  // File fallback
  const db = global._fileDB;
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: "房间不存在" });
  delete room.items[itemId];
  global._fileSaveDB(db);
  res.json({ ok: true });
});

// ── API: Delete Room (创建者可删除) ───────────────────────────────────
app.delete("/api/rooms/:code", async (req, res) => {
  const { code } = req.params;
  const { memberId } = req.body;

  if (storageMode === "supabase") {
    try {
      const room = await getRoom(code);
      if (!room) return res.status(404).json({ error: "房间不存在" });
      if (room.owner_id && memberId && room.owner_id !== memberId) {
        return res.status(403).json({ error: "仅创建者可删除冰箱" });
      }
      await deleteRoom(code);
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: "删除失败：" + e.message });
    }
  }

  const db = global._fileDB;
  if (!db.rooms[code]) return res.status(404).json({ error: "房间不存在" });
  delete db.rooms[code];
  global._fileSaveDB(db);
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
    console.log(`冰箱管家 v5 (${storageMode}) → port ${PORT}`);
  });
});
