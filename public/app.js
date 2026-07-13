// ================================================================
// 冰箱管家 v3 — 双模运行
// 有后端(Express) → 服务端同步，所有人共享
// 无后端(静态部署) → localStorage + hash分享
// ================================================================

// ── Constants ──────────────────────────────────────────────────
var CATEGORY_META = {
  vegetable: { label: "蔬菜", icon: "🥬", stripe: "stripe-vegetable" },
  cooked: { label: "熟食", icon: "🍱", stripe: "stripe-cooked" },
  baby_food: { label: "宝宝食材", icon: "👶", stripe: "stripe-baby" },
  raw_meat: { label: "生肉", icon: "🥩", stripe: "stripe-raw_meat" },
  bakery: { label: "面包点心", icon: "🥐", stripe: "stripe-bakery" },
  leftovers: { label: "剩饭", icon: "🍚", stripe: "stripe-leftovers" },
  other: { label: "其他", icon: "📦", stripe: "stripe-other" },
};

var PRESETS = [
  { name: "西红柿", emoji: "🍅", category: "vegetable" },
  { name: "黄瓜", emoji: "🥒", category: "vegetable" },
  { name: "胡萝卜", emoji: "🥕", category: "vegetable" },
  { name: "西兰花", emoji: "🥦", category: "vegetable" },
  { name: "生菜", emoji: "🥬", category: "vegetable" },
  { name: "菠菜", emoji: "🥬", category: "vegetable" },
  { name: "青椒", emoji: "🫑", category: "vegetable" },
  { name: "土豆", emoji: "🥔", category: "vegetable" },
  { name: "玉米", emoji: "🌽", category: "vegetable" },
  { name: "蘑菇", emoji: "🍄", category: "vegetable" },
  { name: "茄子", emoji: "🍆", category: "vegetable" },
  { name: "白菜", emoji: "🥬", category: "vegetable" },
  { name: "红烧肉", emoji: "🍖", category: "cooked" },
  { name: "炒菜", emoji: "🥘", category: "cooked" },
  { name: "红烧排骨", emoji: "🍖", category: "cooked" },
  { name: "炖鸡汤", emoji: "🍲", category: "cooked" },
  { name: "凉拌菜", emoji: "🥗", category: "cooked" },
  { name: "卤牛肉", emoji: "🥩", category: "cooked" },
  { name: "鳕鱼", emoji: "🐟", category: "baby_food" },
  { name: "三文鱼", emoji: "🐟", category: "baby_food" },
  { name: "南瓜泥", emoji: "🎃", category: "baby_food" },
  { name: "山药泥", emoji: "🥔", category: "baby_food" },
  { name: "猪肝粉", emoji: "🍖", category: "baby_food" },
  { name: "牛肉泥", emoji: "🥩", category: "baby_food" },
  { name: "米粉", emoji: "🍚", category: "baby_food" },
  { name: "果泥", emoji: "🍎", category: "baby_food" },
  { name: "猪肉", emoji: "🥩", category: "raw_meat" },
  { name: "牛肉", emoji: "🥩", category: "raw_meat" },
  { name: "鸡肉", emoji: "🍗", category: "raw_meat" },
  { name: "鸡胸肉", emoji: "🍗", category: "raw_meat" },
  { name: "鸡翅", emoji: "🍗", category: "raw_meat" },
  { name: "排骨", emoji: "🥩", category: "raw_meat" },
  { name: "虾", emoji: "🦐", category: "raw_meat" },
  { name: "鱼", emoji: "🐟", category: "raw_meat" },
  { name: "面包", emoji: "🍞", category: "bakery" },
  { name: "牛角包", emoji: "🥐", category: "bakery" },
  { name: "蛋糕", emoji: "🍰", category: "bakery" },
  { name: "吐司", emoji: "🍞", category: "bakery" },
  { name: "馒头", emoji: "🥟", category: "bakery" },
  { name: "月饼", emoji: "🥮", category: "bakery" },
  { name: "米饭", emoji: "🍚", category: "leftovers" },
  { name: "剩意面", emoji: "🍝", category: "leftovers" },
  { name: "剩菜", emoji: "🥘", category: "leftovers" },
  { name: "牛奶", emoji: "🥛", category: "other" },
  { name: "酸奶", emoji: "🥛", category: "other" },
  { name: "芝士", emoji: "🧀", category: "other" },
  { name: "鸡蛋", emoji: "🥚", category: "other" },
  { name: "咸菜", emoji: "🥒", category: "other" },
];

// ── State ──────────────────────────────────────────────────────
var state = {
  roomCode: null,
  roomName: "",
  memberId: null,
  userName: "",
  rawItems: {},
  members: [],
  currentCategory: "all",
  editingItemId: null,
  selectedCategory: "vegetable",
  _renderHash: "",
  _summaryFilter: null,
  _pollTimer: null,
  _synced: false,
};

// ── Mode Detection ─────────────────────────────────────────────
var HAS_SERVER = false;
var API_BASE = "";

function detectServer() {
  return fetch("/api/health", { method: "HEAD" })
    .then(function(r) {
      HAS_SERVER = r.ok;
      if (HAS_SERVER) updateSyncStatus("syncing");
      else updateSyncStatus("offline");
      return HAS_SERVER;
    })
    .catch(function() {
      HAS_SERVER = false;
      updateSyncStatus("offline");
      return false;
    });
}

// ── API (server mode) ──────────────────────────────────────────
function apiCall(path, opts) {
  opts = opts || {};
  var fetchOpts = {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json" },
  };
  if (opts.body) fetchOpts.body = JSON.stringify(opts.body);
  return fetch("/api" + path, fetchOpts).then(function(r) {
    if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || "服务器错误"); });
    return r.json();
  });
}

// ── Hash encoding (static mode) ────────────────────────────────
function packData(data) {
  var json = JSON.stringify(data);
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function unpackData(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return JSON.parse(decodeURIComponent(escape(atob(str))));
}

function buildShareHash() {
  return packData({
    n: state.roomName,
    c: state.roomCode,
    m: state.members,
    i: Object.values(state.rawItems).map(function(item) {
      return { id: item.id, n: item.name, c: item.category, e: item.expiryDate, q: item.quantity, u: item.unit, t: item.note, b: item.addedBy };
    }),
  });
}

function loadFromHash() {
  var hash = window.location.hash.replace(/^#/, "");
  if (!hash || hash.length < 20) return null;
  try {
    var raw = unpackData(hash);
    return {
      roomName: raw.n || "", roomCode: raw.c || "",
      members: (raw.m || []).map(function(m) { return { id: m.i || genId(), name: m.n || "" }; }),
      items: (raw.i || []).map(function(item) { return { id: item.id || genId(), name: item.n || "", category: item.c || "other", expiryDate: item.e || "", quantity: item.q || 1, unit: item.u || "份", note: item.t || "", addedBy: item.b || "", updatedAt: Date.now() }; }),
    };
  } catch(e) { return null; }
}

// ── Utils ──────────────────────────────────────────────────────
function genId(len) {
  len = len || 10;
  var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  var id = "";
  for (var i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function genRoomCode() {
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var code = "";
  for (var i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function getDaysUntil(d) {
  if (!d) return 999;
  var t = new Date(); t.setHours(0,0,0,0);
  var x = new Date(d); x.setHours(0,0,0,0);
  return Math.ceil((x - t) / 86400000);
}

function getUrgency(d) {
  var days = getDaysUntil(d);
  if (days < 0) return { level: "expired", label: "已过期", days: days };
  if (days === 0) return { level: "critical", label: "今天到期", days: days };
  if (days === 1) return { level: "critical", label: "还剩1天", days: days };
  if (days <= 3) return { level: "warning", label: days + "天", days: days };
  return { level: "safe", label: days + "天", days: days };
}

function formatDate(d) {
  if (!d) return "—";
  var x = new Date(d);
  return (x.getMonth()+1) + "/" + x.getDate();
}

function escapeHtml(s) {
  var el = document.createElement("div");
  el.textContent = s;
  return el.innerHTML;
}

function buildRenderHash() {
  var h = Object.values(state.rawItems).map(function(i) { return i.id + "|" + i.expiryDate + "|" + (i.updatedAt || 0); }).sort().join(",");
  return h + "|cat:" + state.currentCategory + "|filter:" + (state._summaryFilter || "none");
}

// ── Toast / Modal ──────────────────────────────────────────────
function showToast(msg) {
  var el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._timeout);
  el._timeout = setTimeout(function() { el.classList.remove("show"); }, 2000);
}

function openModal(id) { document.getElementById(id).classList.add("active"); }
function closeModal(id) { document.getElementById(id).classList.remove("active"); }

// ── localStorage ───────────────────────────────────────────────
function persistLocal() {
  try { localStorage.setItem("fridge_v3", JSON.stringify({
    roomCode: state.roomCode, roomName: state.roomName, memberId: state.memberId,
    userName: state.userName, rawItems: state.rawItems, members: state.members,
  })); } catch(e) {}
}

function loadLocal() {
  try {
    var d = JSON.parse(localStorage.getItem("fridge_v3") || "null");
    if (!d || !d.roomCode) return false;
    state.roomCode = d.roomCode; state.roomName = d.roomName; state.memberId = d.memberId;
    state.userName = d.userName; state.rawItems = d.rawItems || {}; state.members = d.members || [];
    return true;
  } catch(e) { return false; }
}

// ── Room Ops (dual-mode) ───────────────────────────────────────
function showCreateForm() {
  document.getElementById("createForm").classList.remove("hidden");
  document.getElementById("createName").focus();
}

function createRoom() {
  var name = document.getElementById("createName").value.trim();
  var user = document.getElementById("createUser").value.trim();
  if (!name || !user) { showToast("请填写冰箱名称和昵称"); return; }

  if (HAS_SERVER) {
    // Server mode
    apiCall("/rooms", { method: "POST", body: { name: name, userName: user } })
      .then(function(d) {
        state.roomCode = d.roomCode; state.memberId = d.memberId; state.userName = user;
        state.roomName = name; state.rawItems = {}; state.members = d.room.members; state._synced = true;
        persistLocal(); enterMain(); startPolling(); showToast("冰箱创建成功！");
      }).catch(function(e) { showToast("创建失败：" + e.message); });
  } else {
    // Static mode
    state.roomCode = genRoomCode(); state.memberId = genId(8); state.userName = user;
    state.roomName = name; state.rawItems = {}; state.members = [{ id: state.memberId, name: user }];
    state._renderHash = "";
    persistLocal(); enterMain(); showToast("冰箱创建成功！");
  }
}

function joinRoom() {
  var code = document.getElementById("joinCode").value.trim().toUpperCase();
  if (!code) { showToast("请输入房间码"); return; }

  if (HAS_SERVER) {
    apiCall("/rooms/" + code)
      .then(function(d) {
        var wrap = document.getElementById("joinUserWrap");
        wrap.classList.remove("hidden"); wrap._joinCode = code; wrap._roomData = d.room;
        document.getElementById("joinUser").focus();
      })
      .catch(function() { showToast("房间不存在，请检查房间码"); });
  } else {
    // Static: try hash data, or just create fresh
    var shared = loadFromHash();
    var wrap = document.getElementById("joinUserWrap");
    wrap.classList.remove("hidden"); wrap._joinCode = code; wrap._shared = shared;
    document.getElementById("joinUser").focus();
  }
}

function confirmJoin() {
  var wrap = document.getElementById("joinUserWrap");
  var code = wrap._joinCode;
  var user = document.getElementById("joinUser").value.trim();
  if (!user) { showToast("请输入昵称"); return; }

  if (HAS_SERVER) {
    apiCall("/rooms/" + code + "/join", { method: "POST", body: { userName: user } })
      .then(function(d) {
        state.roomCode = code; state.memberId = d.memberId; state.userName = user;
        state.roomName = d.room.name; state.members = d.room.members; state.rawItems = {};
        (d.room.items || []).forEach(function(i) { state.rawItems[i.id] = i; });
        state._synced = true; persistLocal(); enterMain(); startPolling(); showToast("已加入");
      }).catch(function(e) { showToast("加入失败：" + e.message); });
  } else {
    var shared = wrap._shared;
    state.roomCode = code; state.memberId = genId(8); state.userName = user;
    if (shared && shared.roomCode === code) {
      state.roomName = shared.roomName;
      state.rawItems = {}; shared.items.forEach(function(i) { state.rawItems[i.id] = i; });
      state.members = shared.members;
      var exists = state.members.some(function(m) { return m.name === user; });
      if (!exists) state.members.push({ id: state.memberId, name: user });
      window.location.hash = "";
    } else {
      state.roomName = "冰箱 " + code;
      state.rawItems = {}; state.members = [{ id: state.memberId, name: user }];
    }
    state._renderHash = ""; persistLocal(); enterMain();
  }
}

function enterMain() {
  document.getElementById("landing").classList.remove("active");
  document.getElementById("main").classList.add("active");
  document.getElementById("roomName").textContent = state.roomName;
  document.getElementById("roomCodeDisplay").textContent = "房间码 " + state.roomCode;
  document.getElementById("createForm").classList.add("hidden");
  document.getElementById("joinUserWrap").classList.add("hidden");
  ["joinCode","createName","createUser","joinUser"].forEach(function(id) { document.getElementById(id).value = ""; });
  if (HAS_SERVER) updateSyncStatus("online");
  else updateSyncStatus("offline");
  renderAll();
}

function leaveRoom() {
  if (!confirm("确定退出当前冰箱吗？")) return;
  stopPolling(); closeModal("shareModal");
  state.roomCode = null; state.rawItems = {}; state.members = []; state._renderHash = ""; state._synced = false;
  localStorage.removeItem("fridge_v3"); window.location.hash = "";
  document.getElementById("main").classList.remove("active");
  document.getElementById("landing").classList.add("active");
}

// ── Polling (server mode only) ─────────────────────────────────
function startPolling() {
  if (!HAS_SERVER) return;
  stopPolling(); pollOnce();
  state._pollTimer = setInterval(pollOnce, 3000);
}

function stopPolling() {
  if (state._pollTimer) { clearInterval(state._pollTimer); state._pollTimer = null; }
}

function pollOnce() {
  if (!state.roomCode || !HAS_SERVER) return;
  apiCall("/rooms/" + state.roomCode)
    .then(function(d) {
      var hasChanges = false;
      (d.room.items || []).forEach(function(item) {
        var existing = state.rawItems[item.id];
        if (!existing || (item.updatedAt && item.updatedAt > (existing._localUpdated || 0))) {
          state.rawItems[item.id] = item; hasChanges = true;
        }
      });
      var remoteIds = {}; (d.room.items || []).forEach(function(i) { remoteIds[i.id] = true; });
      Object.keys(state.rawItems).forEach(function(id) {
        if (!remoteIds[id]) { delete state.rawItems[id]; hasChanges = true; }
      });
      if (JSON.stringify(d.room.members) !== JSON.stringify(state.members)) { state.members = d.room.members; hasChanges = true; }
      if (hasChanges) { state._renderHash = ""; renderAll(); persistLocal(); }
      if (!state._synced) { state._synced = true; updateSyncStatus("online"); }
    }).catch(function() { updateSyncStatus("offline"); });
}

// ── Sync Status ────────────────────────────────────────────────
function updateSyncStatus(s) {
  var lbl = document.getElementById("syncLabel");
  document.getElementById("syncStatus").className = "sync-status " + s;
  if (s === "online") lbl.textContent = "☁️ 云端同步";
  else if (s === "syncing") lbl.textContent = "🔄 同步中...";
  else lbl.textContent = "📱 本地模式";
}

// ── Render ─────────────────────────────────────────────────────
function getSortedItems() {
  var items = Object.values(state.rawItems);
  if (state._summaryFilter === "urgent") {
    items = items.filter(function(i) { return getUrgency(i.expiryDate).level === "critical"; });
  } else if (state._summaryFilter === "expired") {
    items = items.filter(function(i) { return getUrgency(i.expiryDate).level === "expired"; });
  } else if (state.currentCategory !== "all") {
    items = items.filter(function(i) { return i.category === state.currentCategory; });
  }
  items.sort(function(a, b) { return new Date(a.expiryDate || 0) - new Date(b.expiryDate || 0); });
  return items;
}

function renderAll() { renderItems(); renderSummary(); }

function renderItems() {
  var items = getSortedItems();
  var h = buildRenderHash();
  if (h === state._renderHash) return;
  state._renderHash = h;

  var list = document.getElementById("foodList");
  if (items.length === 0) {
    var msg = "冰箱空空如也";
    if (state._summaryFilter === "urgent") msg = "没有即将过期的食材 👍";
    else if (state._summaryFilter === "expired") msg = "没有已过期的食材 👍";
    else if (state.currentCategory !== "all") msg = "该分类暂无食材";
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">🧊</div><p>' + msg + '</p><p class="empty-hint">点击下方 + 添加食材</p></div>';
    return;
  }

  list.innerHTML = items.map(function(item) {
    var cat = CATEGORY_META[item.category] || CATEGORY_META.other;
    var u = getUrgency(item.expiryDate);
    var txt = u.level === "expired" ? "已过期" : (u.level === "critical" && u.days === 0 ? "今天到期" : "剩余 " + u.label);
    return '<div class="food-card-wrapper"><div class="food-card-delete-bg"><button class="swipe-delete-btn" data-id="' + item.id + '">删除</button></div>' +
      '<div class="food-card" onclick="editItem(\'' + item.id + '\')" data-id="' + item.id + '">' +
      '<div class="stripe ' + cat.stripe + '"></div><div class="food-icon">' + cat.icon + '</div>' +
      '<div class="food-info"><div class="food-name">' + escapeHtml(item.name) + '</div>' +
      '<div class="food-meta"><span class="food-qty">' + (item.quantity||1) + (item.unit||"份") + '</span>' +
      '<span>到期: ' + formatDate(item.expiryDate) + '</span>' + (item.addedBy ? '<span>· ' + escapeHtml(item.addedBy) + '</span>' : '') +
      '</div></div><div class="food-right"><div class="urgency-badge urgency-' + u.level + '">' + txt + '</div></div></div></div>';
  }).join("");

  bindSwipe();
}

function renderSummary() {
  var t=0,u=0,e=0;
  Object.values(state.rawItems).forEach(function(i) {
    t++; var g = getUrgency(i.expiryDate);
    if (g.level==="expired") e++; else if (g.level==="critical") u++;
  });
  document.getElementById("totalCount").textContent = t;
  document.getElementById("urgentCount").textContent = u;
  document.getElementById("expiredCount").textContent = e;
  document.getElementById("summaryUrgent").classList.toggle("summary-active", state._summaryFilter === "urgent");
  document.getElementById("summaryExpired").classList.toggle("summary-active", state._summaryFilter === "expired");
  document.getElementById("summaryTotal").classList.toggle("summary-active", state._summaryFilter === null);
}

function filterSummary(type) {
  // Force re-render regardless of hash
  state._renderHash = "";
  if (type === "all") {
    state._summaryFilter = null; state.currentCategory = "all";
    document.querySelectorAll(".cat-tab").forEach(function(t) { t.classList.toggle("active", t.dataset.cat === "all"); });
  } else if (state._summaryFilter === type) {
    // Toggle off: show all
    state._summaryFilter = null; state.currentCategory = "all";
    document.querySelectorAll(".cat-tab").forEach(function(t) { t.classList.toggle("active", t.dataset.cat === "all"); });
  } else {
    state._summaryFilter = type; state.currentCategory = "all";
    document.querySelectorAll(".cat-tab").forEach(function(t) { t.classList.toggle("active", t.dataset.cat === "all"); });
  }
  renderAll();
  // Also update summary visual states directly (belt-and-suspenders)
  updateSummaryActive();
}

function updateSummaryActive() {
  document.getElementById("summaryUrgent").classList.toggle("summary-active", state._summaryFilter === "urgent");
  document.getElementById("summaryExpired").classList.toggle("summary-active", state._summaryFilter === "expired");
  document.getElementById("summaryTotal").classList.toggle("summary-active", state._summaryFilter === null);
}

function switchCategory(cat) {
  state.currentCategory = cat; state._summaryFilter = null;
  document.querySelectorAll(".cat-tab").forEach(function(t) { t.classList.toggle("active", t.dataset.cat === cat); });
  document.getElementById("summaryUrgent").classList.remove("summary-active");
  document.getElementById("summaryExpired").classList.remove("summary-active");
  renderAll();
}

// ── Swipe ──────────────────────────────────────────────────────
function bindSwipe() {
  document.querySelectorAll(".food-card-wrapper").forEach(function(w) {
    var c = w.querySelector(".food-card");
    if (!c || c._swipeBound) return;
    c._swipeBound = true;
    var sx=0, cx=0, d=false;
    c.addEventListener("touchstart", function(e) { sx=e.touches[0].clientX; cx=0; d=true; c.style.transition="none"; }, {passive:true});
    c.addEventListener("touchmove", function(e) { if(!d)return; cx=e.touches[0].clientX-sx; if(cx<0)c.style.transform="translateX("+cx+"px)"; }, {passive:true});
    c.addEventListener("touchend", function() { if(!d)return; d=false; c.style.transition="transform 0.25s cubic-bezier(0.22,1,0.36,1)"; c.style.transform=cx<-80?"translateX(-100px)":"translateX(0)"; });
  });
  document.querySelectorAll(".swipe-delete-btn").forEach(function(b) {
    if (b._bound) return; b._bound = true;
    b.onclick = function(e) { e.stopPropagation(); var id = b.dataset.id; if (!confirm("确定删除吗？")) return; deleteItem(id); };
  });
}

// ── CRUD (dual-mode) ───────────────────────────────────────────
function selectCategory(cat) {
  state.selectedCategory = cat;
  document.querySelectorAll(".cat-pick").forEach(function(b) { b.classList.toggle("selected", b.dataset.cat === cat); });
  renderPresets();
}

function renderPresets() {
  document.getElementById("presetGrid").innerHTML = PRESETS
    .filter(function(p) { return p.category === state.selectedCategory; })
    .map(function(p) { return '<div class="preset-item" data-name="' + p.name + '" data-cat="' + p.category + '" onclick="selectPreset(this)"><span class="preset-emoji">' + p.emoji + '</span>' + p.name + '</div>'; }).join("");
}

function selectPreset(el) { document.getElementById("itemName").value = el.dataset.name; selectCategory(el.dataset.cat); document.getElementById("itemName").focus(); }

function openAddModal() {
  state.editingItemId = null; state.selectedCategory = "vegetable";
  document.getElementById("modalTitle").textContent = "添加食材";
  document.getElementById("itemName").value = ""; document.getElementById("itemQty").value = "1"; document.getElementById("itemUnit").value = "份";
  document.getElementById("itemNote").value = ""; document.getElementById("deleteBtn").classList.add("hidden");
  var tm = new Date(); tm.setDate(tm.getDate()+1);
  document.getElementById("itemExpiry").value = tm.toISOString().split("T")[0];
  selectCategory("vegetable"); renderPresets(); openModal("itemModal"); document.getElementById("itemName").focus();
}

function editItem(id) {
  var item = state.rawItems[id]; if (!item) return;
  state.editingItemId = id; state.selectedCategory = item.category;
  document.getElementById("modalTitle").textContent = "编辑食材";
  document.getElementById("itemName").value = item.name || "";
  document.getElementById("itemExpiry").value = (item.expiryDate||"").split("T")[0];
  document.getElementById("itemQty").value = item.quantity || 1; document.getElementById("itemUnit").value = item.unit || "份";
  document.getElementById("itemNote").value = item.note || ""; document.getElementById("deleteBtn").classList.remove("hidden");
  selectCategory(item.category); renderPresets(); openModal("itemModal");
}

function saveItem() {
  var name = document.getElementById("itemName").value.trim();
  if (!name) { showToast("请输入食材名称"); return; }

  var now = Date.now();
  if (state.editingItemId) {
    // Update
    var updateData = { name: name, category: state.selectedCategory, expiryDate: document.getElementById("itemExpiry").value, quantity: parseInt(document.getElementById("itemQty").value)||1, unit: document.getElementById("itemUnit").value.trim()||"份", note: document.getElementById("itemNote").value.trim() };
    if (HAS_SERVER) {
      apiCall("/rooms/" + state.roomCode + "/items/" + state.editingItemId, { method:"PUT", body: updateData })
        .then(function(d) { state.rawItems[state.editingItemId] = d.item; state._renderHash=""; persistLocal(); closeModal("itemModal"); renderAll(); showToast("已更新"); })
        .catch(function(e) { showToast("更新失败：" + e.message); });
    } else {
      var existing = state.rawItems[state.editingItemId];
      state.rawItems[state.editingItemId] = { id: state.editingItemId, name: name, category: state.selectedCategory, expiryDate: updateData.expiryDate, quantity: updateData.quantity, unit: updateData.unit, note: updateData.note, addedBy: existing?existing.addedBy:state.userName, updatedAt: now };
      state._renderHash=""; persistLocal(); closeModal("itemModal"); renderAll(); autoUpdateHash(); showToast("已更新");
    }
  } else {
    // Add
    var itemData = { name: name, category: state.selectedCategory, expiryDate: document.getElementById("itemExpiry").value, quantity: parseInt(document.getElementById("itemQty").value)||1, unit: document.getElementById("itemUnit").value.trim()||"份", note: document.getElementById("itemNote").value.trim(), addedBy: state.userName };
    if (HAS_SERVER) {
      apiCall("/rooms/" + state.roomCode + "/items", { method:"POST", body: itemData })
        .then(function(d) { state.rawItems[d.item.id] = d.item; state._renderHash=""; persistLocal(); closeModal("itemModal"); renderAll(); showToast("已添加"); })
        .catch(function(e) { showToast("添加失败：" + e.message); });
    } else {
      var id = genId(10);
      state.rawItems[id] = { id: id, name: name, category: state.selectedCategory, expiryDate: itemData.expiryDate, quantity: itemData.quantity, unit: itemData.unit, note: itemData.note, addedBy: state.userName, addedAt: now, updatedAt: now };
      state._renderHash=""; persistLocal(); closeModal("itemModal"); renderAll(); autoUpdateHash(); showToast("已添加");
    }
  }
}

function deleteCurrentItem() {
  if (!state.editingItemId) return;
  if (!confirm("确定删除吗？")) return;
  deleteItem(state.editingItemId); closeModal("itemModal");
}

function deleteItem(id) {
  if (HAS_SERVER) {
    apiCall("/rooms/" + state.roomCode + "/items/" + id, { method:"DELETE" })
      .then(function() { delete state.rawItems[id]; state._renderHash=""; persistLocal(); renderAll(); showToast("已删除"); })
      .catch(function(e) { showToast("删除失败：" + e.message); });
  } else {
    delete state.rawItems[id]; state._renderHash=""; persistLocal(); renderAll(); autoUpdateHash(); showToast("已删除");
  }
}

// ── Auto-update hash (static mode) ─────────────────────────────
function autoUpdateHash() {
  if (HAS_SERVER) return;
  var hash = buildShareHash();
  if (window.location.hash !== "#" + hash) {
    window.location.hash = hash;
  }
}

// ── Share ──────────────────────────────────────────────────────
function showShare() { document.getElementById("bigCode").textContent = state.roomCode; openModal("shareModal"); }

function copyCode() {
  var url = window.location.origin + window.location.pathname;
  if (url.endsWith("/")) url = url.slice(0, -1);
  // In static mode, append hash with data
  if (!HAS_SERVER) url = url + "#" + buildShareHash();
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(function() {
      showToast(HAS_SERVER ? "链接已复制！家人打开链接输入房间码 " + state.roomCode + " 即可加入" : "分享链接已复制！发到微信即可");
    }).catch(function() { fallbackCopy(url); });
  } else { fallbackCopy(url); }
}

function fallbackCopy(text) {
  var ta = document.createElement("textarea"); ta.value = text; ta.style.position="fixed"; ta.style.left="-9999px";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); showToast(HAS_SERVER ? "链接已复制！房间码 " + state.roomCode : "分享链接已复制！"); }
  catch(e) { showToast("复制失败，房间码：" + state.roomCode); }
  document.body.removeChild(ta);
}

function showMembers() {
  var seen = {}, unique = [];
  (state.members||[]).forEach(function(m) { var k=(m.name||"").trim(); if(!k||seen[k])return; seen[k]=true; unique.push(m); });
  document.getElementById("memberList").innerHTML = unique.map(function(m) {
    var init = (m.name||"?").charAt(0).toUpperCase(), isMe = m.id===state.memberId;
    return '<div class="member-row"><div class="member-avatar">'+escapeHtml(init)+'</div><div><div class="member-name">'+(m.name||"?").substring(0,20)+(isMe?" (我)":"")+'</div></div></div>';
  }).join("");
  openModal("memberModal");
}

// ── Quick Expiry ───────────────────────────────────────────────
document.addEventListener("click", function(e) {
  if (e.target.classList.contains("quick-btn")) {
    var days = parseInt(e.target.dataset.days), d = new Date();
    d.setDate(d.getDate()+days); document.getElementById("itemExpiry").value = d.toISOString().split("T")[0];
  }
  if (e.target.classList.contains("cat-pick") && !e.target.classList.contains("cat-tab")) selectCategory(e.target.dataset.cat);
  if (e.target.classList.contains("modal-overlay")) e.target.classList.remove("active");
});

// ── Init ───────────────────────────────────────────────────────
(function init() {
  // Detect server first
  detectServer().then(function(hasServer) {
    if (hasServer && loadLocal() && state.roomCode) {
      // Server mode: restore from local + sync
      enterMain(); updateSyncStatus("syncing");
      apiCall("/rooms/" + state.roomCode).then(function(d) {
        state.roomName = d.room.name; state.members = d.room.members; state.rawItems = {};
        (d.room.items||[]).forEach(function(i) { state.rawItems[i.id] = i; });
        state._synced = true; state._renderHash = ""; persistLocal(); renderAll(); updateSyncStatus("online"); startPolling();
      }).catch(function() { updateSyncStatus("offline"); startPolling(); });
    } else if (!hasServer) {
      // Static mode: try hash, then local
      var shared = loadFromHash();
      if (shared) {
        state.roomCode = shared.roomCode; state.roomName = shared.roomName;
        state.members = shared.members; state.rawItems = {};
        shared.items.forEach(function(i) { state.rawItems[i.id] = i; });
        state.memberId = genId(8);
        var wrap = document.getElementById("joinUserWrap"); wrap.classList.remove("hidden");
        wrap._joinCode = shared.roomCode; wrap._shared = shared;
        document.getElementById("joinCode").value = shared.roomCode;
        document.getElementById("joinUser").focus();
        showToast("发现共享冰箱！请输入昵称加入");
      } else if (loadLocal() && state.roomCode) {
        enterMain();
      }
    }
  });
})();
