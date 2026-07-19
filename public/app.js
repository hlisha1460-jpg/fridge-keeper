// ================================================================
// 冰箱管家 v5 — 分表存储 · 并发安全 · 自动登录
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
  _localChangeTime: 0,   // v5: track local changes to debounce polling
  _pendingVersions: {},   // v5: track local edit versions for conflict detection
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

// ── API ────────────────────────────────────────────────────────
function apiCall(path, opts) {
  opts = opts || {};
  var fetchOpts = {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json" },
  };
  if (opts.body) fetchOpts.body = JSON.stringify(opts.body);
  return fetch("/api" + path, fetchOpts).then(function(r) {
    if (!r.ok) return r.json().then(function(e) { throw e; });
    return r.json();
  });
}

// ── Hash encoding (UTF-8 safe, no deprecated escape/unescape) ──
function packData(data) {
  var json = JSON.stringify(data);
  var utf8 = encodeURIComponent(json);
  var bin = "";
  for (var i = 0; i < utf8.length; i++) {
    var c = utf8[i];
    if (c === "%") {
      bin += String.fromCharCode(parseInt(utf8.substr(i + 1, 2), 16));
      i += 2;
    } else {
      bin += c;
    }
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function unpackData(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  var bin = atob(str);
  var utf8 = "";
  for (var i = 0; i < bin.length; i++) {
    var code = bin.charCodeAt(i);
    if (code > 127) {
      utf8 += "%" + code.toString(16).toUpperCase();
    } else {
      utf8 += bin[i];
    }
  }
  return JSON.parse(decodeURIComponent(utf8));
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
  el._timeout = setTimeout(function() { el.classList.remove("show"); }, 2500);
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

// ── Saved Rooms (我的冰箱) ─────────────────────────────────────
function getSavedRooms() {
  try { return JSON.parse(localStorage.getItem("saved_rooms") || "[]"); }
  catch(e) { return []; }
}

function saveRoomInfo(code, name, userName) {
  var rooms = getSavedRooms();
  // 去重 + 更新时间
  rooms = rooms.filter(function(r) { return r.code !== code; });
  rooms.unshift({ code: code, name: name, userName: userName, joinedAt: Date.now() });
  // 最多保留 20 个
  if (rooms.length > 20) rooms = rooms.slice(0, 20);
  try { localStorage.setItem("saved_rooms", JSON.stringify(rooms)); } catch(e) {}
  renderSavedRooms();
}

function renderSavedRooms() {
  var list = document.getElementById("myRoomsList");
  var rooms = getSavedRooms();
  if (rooms.length === 0) {
    list.innerHTML = '<div class="my-rooms-empty">还没有加入过冰箱<br>创建或加入后这里会显示</div>';
    return;
  }
  var html = "";
  rooms.forEach(function(r) {
    html += '<div class="room-card" onclick="enterSavedRoom(\'' + r.code + '\',\'' + escapeHtml(r.name) + '\')">' +
      '<div class="room-card-icon">🧊</div>' +
      '<div class="room-card-info"><div class="room-card-name">' + escapeHtml(r.name) + '</div>' +
      '<div class="room-card-code">房间码 ' + r.code + '</div></div>' +
      '<div class="room-card-arrow">›</div></div>';
  });
  list.innerHTML = html;
}

function enterSavedRoom(code, name) {
  if (!HAS_SERVER) {
    showToast("正在连接服务器...");
    return;
  }
  document.getElementById("loadingOverlay").classList.remove("hidden");
  document.getElementById("loadingOverlay").style.display = "";
  document.getElementById("loadingMsg").textContent = "正在进入 " + name + "...";

  // 先用 GET 获取房间信息，然后自动加入（需要昵称）
  apiCall("/rooms/" + code).then(function(d) {
    // 用本地存的 userName 或从 saved_rooms 里找
    var rooms = getSavedRooms();
    var saved = rooms.find(function(r) { return r.code === code; });
    var user = (saved && saved.userName) || "";

    if (user) {
      // 直接用保存的昵称加入
      apiCall("/rooms/" + code + "/join", { method: "POST", body: { userName: user } })
        .then(function(d2) {
          state.roomCode = code; state.memberId = d2.memberId; state.userName = user;
          state.roomName = d.room.name; state.members = d2.room.members; state.rawItems = {};
          (d2.room.items || []).forEach(function(i) { i.expiryDate = i.expiryDate || i.expiry_date || ""; state.rawItems[i.id] = i; });
          state._synced = true; persistLocal(); saveRoomInfo(code, d.room.name, user);
          enterMain(); startPolling(); hideLoadingOverlay();
        }).catch(function(e) {
          hideLoadingOverlay();
          showToast("加入失败：" + (e.error || e.message));
        });
    } else {
      // 没有保存昵称，弹出输入框
      hideLoadingOverlay();
      var wrap = document.getElementById("joinUserWrap");
      wrap.classList.remove("hidden");
      wrap._joinCode = code; wrap._roomData = d.room;
      document.getElementById("joinUser").focus();
    }
  }).catch(function() {
    hideLoadingOverlay();
    showToast("冰箱不存在，可能已被删除");
  });
}

function hideLoadingOverlay() {
  var el = document.getElementById("loadingOverlay");
  el.classList.add("hidden");
  setTimeout(function() { el.style.display = "none"; }, 400);
}

function showFindRooms() {
  var wrap = document.getElementById("findRoomsWrap");
  wrap.classList.toggle("hidden");
  if (!wrap.classList.contains("hidden")) {
    document.getElementById("findNickname").focus();
  }
}

function findMyRooms() {
  var nickname = document.getElementById("findNickname").value.trim();
  if (!nickname) { showToast("请输入你的昵称"); return; }
  if (!HAS_SERVER) { showToast("服务器连接中，请稍后再试"); return; }

  var list = document.getElementById("myRoomsList");
  list.innerHTML = '<div class="my-rooms-empty">正在查找...</div>';

  apiCall("/user/" + encodeURIComponent(nickname) + "/rooms").then(function(d) {
    if (!d.rooms || d.rooms.length === 0) {
      list.innerHTML = '<div class="my-rooms-empty">没有找到"<b>' + escapeHtml(nickname) + '</b>"的冰箱<br>请确认昵称是否正确</div>';
      return;
    }
    var html = "";
    d.rooms.forEach(function(r) {
      html += '<div class="room-card" onclick="findRoomAndJoin(\'' + r.code + '\',\'' + escapeHtml(r.name) + '\',\'' + escapeHtml(nickname) + '\')">' +
        '<div class="room-card-icon">🧊</div>' +
        '<div class="room-card-info"><div class="room-card-name">' + escapeHtml(r.name) + '</div>' +
        '<div class="room-card-code">房间码 ' + r.code + '</div></div>' +
        '<div class="room-card-arrow">›</div></div>';
    });
    list.innerHTML = html;
    showToast("找到 " + d.rooms.length + " 个冰箱，点击加入");
  }).catch(function(e) {
    list.innerHTML = '<div class="my-rooms-empty">查找失败，请检查网络后重试</div>';
    showToast("查找失败：" + (e.error || e.message));
  });
}

function findRoomAndJoin(code, name, nickname) {
  document.getElementById("loadingOverlay").classList.remove("hidden");
  document.getElementById("loadingOverlay").style.display = "";
  document.getElementById("loadingMsg").textContent = "正在进入 " + name + "...";

  apiCall("/rooms/" + code + "/join", { method: "POST", body: { userName: nickname } })
    .then(function(d) {
      state.roomCode = code; state.memberId = d.memberId; state.userName = nickname;
      state.roomName = d.room.name; state.members = d.room.members; state.rawItems = {};
      (d.room.items || []).forEach(function(i) { i.expiryDate = i.expiryDate || i.expiry_date || ""; state.rawItems[i.id] = i; });
      state._synced = true; persistLocal(); saveRoomInfo(code, d.room.name, nickname);
      enterMain(); startPolling(); hideLoadingOverlay();
    }).catch(function(e) {
      hideLoadingOverlay();
      showToast("加入失败：" + (e.error || e.message));
    });
}

// ── Room Ops ───────────────────────────────────────────────────
function showCreateForm() {
  document.getElementById("createForm").classList.remove("hidden");
  document.getElementById("createName").focus();
}

function createRoom() {
  var name = document.getElementById("createName").value.trim();
  var user = document.getElementById("createUser").value.trim();
  if (!name || !user) { showToast("请填写冰箱名称和昵称"); return; }

  if (HAS_SERVER) {
    apiCall("/rooms", { method: "POST", body: { name: name, userName: user } })
      .then(function(d) {
        state.roomCode = d.roomCode; state.memberId = d.memberId; state.userName = user;
        state.roomName = name; state.rawItems = {}; state.members = d.room.members; state._synced = true;
        persistLocal(); saveRoomInfo(d.roomCode, name, user); enterMain(); startPolling(); showToast("冰箱创建成功！");
      }).catch(function(e) { showToast("创建失败：" + (e.error || e.message)); });
  } else {
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
        (d.room.items || []).forEach(function(i) { i.expiryDate = i.expiryDate || i.expiry_date || ""; state.rawItems[i.id] = i; });
        state._synced = true; persistLocal(); saveRoomInfo(code, d.room.name, user); enterMain(); startPolling(); showToast("已加入");
      }).catch(function(e) { showToast("加入失败：" + (e.error || e.message)); });
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
  state._pendingVersions = {};
  localStorage.removeItem("fridge_v3"); window.location.hash = "";
  document.getElementById("main").classList.remove("active");
  document.getElementById("landing").classList.add("active");
}

// ── Polling (v5: 15s interval, debounce local changes) ────────
function startPolling() {
  if (!HAS_SERVER) return;
  stopPolling(); pollOnce();
  state._pollTimer = setInterval(pollOnce, 15000);
}

function stopPolling() {
  if (state._pollTimer) { clearInterval(state._pollTimer); state._pollTimer = null; }
}

function markLocalChange() {
  state._localChangeTime = Date.now();
}

function pollOnce() {
  if (!state.roomCode || !HAS_SERVER) return;
  // 如果 3 秒内有本地修改，跳过以等待服务端处理
  if (Date.now() - state._localChangeTime < 3000) return;

  apiCall("/rooms/" + state.roomCode)
    .then(function(d) {
      var hasChanges = false;
      var remoteItems = {};
      (d.room.items || []).forEach(function(item) {
        // Normalize field names between v4 and v5
        item.expiryDate = item.expiryDate || item.expiry_date || "";
        remoteItems[item.id] = item;
      });

      // v5: skip items that have a pending local version (being edited)
      Object.keys(state._pendingVersions).forEach(function(id) {
        if (remoteItems[id]) {
          var rv = remoteItems[id].updatedAt;
          var pv = state._pendingVersions[id];
          // If server has a newer version, our edit was overwritten — accept server
          if (rv > pv) {
            delete state._pendingVersions[id];
          } else {
            // Keep our local version, mark as changed
            delete remoteItems[id];
          }
        }
      });

      // Add/update from remote
      Object.keys(remoteItems).forEach(function(id) {
        var existing = state.rawItems[id];
        var remote = remoteItems[id];
        if (!existing || !existing.updatedAt || (remote.updatedAt && remote.updatedAt > existing.updatedAt)) {
          state.rawItems[id] = remote; hasChanges = true;
        }
      });

      // Remove items no longer on server
      Object.keys(state.rawItems).forEach(function(id) {
        if (!remoteItems[id]) { delete state.rawItems[id]; hasChanges = true; }
      });

      if (d.room.members && JSON.stringify(d.room.members) !== JSON.stringify(state.members)) {
        state.members = d.room.members; hasChanges = true;
      }

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
  state._renderHash = "";
  if (type === "all") {
    state._summaryFilter = null; state.currentCategory = "all";
    document.querySelectorAll(".cat-tab").forEach(function(t) { t.classList.toggle("active", t.dataset.cat === "all"); });
  } else if (state._summaryFilter === type) {
    state._summaryFilter = null; state.currentCategory = "all";
    document.querySelectorAll(".cat-tab").forEach(function(t) { t.classList.toggle("active", t.dataset.cat === "all"); });
  } else {
    state._summaryFilter = type; state.currentCategory = "all";
    document.querySelectorAll(".cat-tab").forEach(function(t) { t.classList.toggle("active", t.dataset.cat === "all"); });
  }
  renderAll();
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

// ── CRUD (v5: 版本检查) ────────────────────────────────────────
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
  var itemData = {
    name: name, category: state.selectedCategory,
    expiryDate: document.getElementById("itemExpiry").value,
    quantity: parseInt(document.getElementById("itemQty").value)||1,
    unit: document.getElementById("itemUnit").value.trim()||"份",
    note: document.getElementById("itemNote").value.trim(),
    addedBy: state.userName,
  };

  if (state.editingItemId) {
    // Update — 带版本检查
    if (HAS_SERVER) {
      var existing = state.rawItems[state.editingItemId];
      var clientVersion = existing ? (existing.updatedAt || 0) : 0;
      itemData._clientVersion = clientVersion;

      // 标记本地修改
      state._pendingVersions[state.editingItemId] = now;
      markLocalChange();

      apiCall("/rooms/" + state.roomCode + "/items/" + state.editingItemId, { method:"PUT", body: itemData })
        .then(function(d) {
          state.rawItems[state.editingItemId] = d.item;
          delete state._pendingVersions[state.editingItemId];
          state._renderHash=""; persistLocal(); closeModal("itemModal"); renderAll(); showToast("已更新");
        })
        .catch(function(e) {
          delete state._pendingVersions[state.editingItemId];
          if (e.conflict) {
            showToast("食材已被他人修改，正在刷新...");
            // 重新从服务器拉取最新数据
            pollOnceNow();
          } else {
            showToast("更新失败：" + (e.error || e.message));
          }
          closeModal("itemModal");
        });
    } else {
      var existing = state.rawItems[state.editingItemId];
      state.rawItems[state.editingItemId] = { id: state.editingItemId, name: name, category: state.selectedCategory, expiryDate: itemData.expiryDate, quantity: itemData.quantity, unit: itemData.unit, note: itemData.note, addedBy: existing?existing.addedBy:state.userName, updatedAt: now };
      state._renderHash=""; persistLocal(); closeModal("itemModal"); renderAll(); autoUpdateHash(); showToast("已更新");
    }
  } else {
    // Add
    if (HAS_SERVER) {
      markLocalChange();
      apiCall("/rooms/" + state.roomCode + "/items", { method:"POST", body: itemData })
        .then(function(d) {
          state.rawItems[d.item.id] = d.item;
          state._renderHash=""; persistLocal(); closeModal("itemModal"); renderAll(); showToast("已添加");
        })
        .catch(function(e) { showToast("添加失败：" + (e.error || e.message)); });
    } else {
      var id = genId(10);
      state.rawItems[id] = { id: id, name: name, category: state.selectedCategory, expiryDate: itemData.expiryDate, quantity: itemData.quantity, unit: itemData.unit, note: itemData.note, addedBy: state.userName, addedAt: now, updatedAt: now };
      state._renderHash=""; persistLocal(); closeModal("itemModal"); renderAll(); autoUpdateHash(); showToast("已添加");
    }
  }
}

// v5: 立即拉取最新数据（用于冲突恢复）
function pollOnceNow() {
  if (!state.roomCode || !HAS_SERVER) return;
  state._renderHash = "";
  apiCall("/rooms/" + state.roomCode)
    .then(function(d) {
      state.roomName = d.room.name; state.members = d.room.members; state.rawItems = {};
      (d.room.items || []).forEach(function(i) { i.expiryDate = i.expiryDate || i.expiry_date || ""; state.rawItems[i.id] = i; });
      state._synced = true; persistLocal(); renderAll(); updateSyncStatus("online");
    })
    .catch(function() { updateSyncStatus("offline"); });
}

function deleteCurrentItem() {
  if (!state.editingItemId) return;
  if (!confirm("确定删除吗？")) return;
  deleteItem(state.editingItemId); closeModal("itemModal");
}

function deleteItem(id) {
  if (HAS_SERVER) {
    markLocalChange();
    apiCall("/rooms/" + state.roomCode + "/items/" + id, { method:"DELETE" })
      .then(function() { delete state.rawItems[id]; state._renderHash=""; persistLocal(); renderAll(); showToast("已删除"); })
      .catch(function(e) { showToast("删除失败：" + (e.error || e.message)); });
  } else {
    delete state.rawItems[id]; state._renderHash=""; persistLocal(); renderAll(); autoUpdateHash(); showToast("已删除");
  }
}

// ── Auto-update hash ───────────────────────────────────────────
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
  (state.members||[]).forEach(function(m) { var k=m.id||m.name||""; if(!k||seen[k])return; seen[k]=true; unique.push(m); });
  document.getElementById("memberList").innerHTML = unique.map(function(m) {
    var init = (m.name||"?").charAt(0).toUpperCase(), isMe = m.id===state.memberId;
    return '<div class="member-row"><div class="member-avatar">'+escapeHtml(init)+'</div><div><div class="member-name">'+escapeHtml((m.name||"?").substring(0,20))+(isMe?" (我)":"")+'</div></div></div>';
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

// ── Voice Input (语音放入/取出) ───────────────────────────────
var _voiceRec = null;
var _voiceActive = false;

function startVoiceInput() {
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showToast("当前浏览器不支持语音识别");
    // 降级：打开添加弹窗
    openAddModal();
    return;
  }

  if (_voiceActive) {
    stopVoiceInput();
    return;
  }

  _voiceRec = new SR();
  _voiceRec.lang = "zh-CN";
  _voiceRec.continuous = false;
  _voiceRec.interimResults = true;
  _voiceActive = true;

  var overlay = document.getElementById("voiceOverlay");
  var hint = document.getElementById("voiceHint");
  var result = document.getElementById("voiceResult");
  var fab = document.querySelector(".voice-fab");

  overlay.classList.add("active");
  fab.classList.add("listening");
  hint.innerHTML = "正在聆听...<br>说\"放入西红柿\"或\"取出鸡蛋\"";
  result.textContent = "";

  var finalTranscript = "";

  _voiceRec.onresult = function(event) {
    var interim = "";
    for (var i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interim += event.results[i][0].transcript;
      }
    }
    if (interim) result.textContent = interim;
    if (finalTranscript) {
      result.textContent = finalTranscript;
      parseVoiceCommand(finalTranscript.trim());
    }
  };

  _voiceRec.onerror = function(event) {
    hint.textContent = "语音识别出错：" + (event.error || "未知错误");
    if (event.error === "not-allowed") {
      hint.innerHTML = "请允许浏览器使用麦克风<br>在微信中可能需要用系统浏览器打开";
    }
    setTimeout(stopVoiceInput, 2000);
  };

  _voiceRec.onend = function() {
    if (_voiceActive && !finalTranscript) {
      hint.textContent = "没有听到声音，请再试一次";
      setTimeout(stopVoiceInput, 1500);
    } else if (_voiceActive) {
      setTimeout(stopVoiceInput, 800);
    }
  };

  try {
    _voiceRec.start();
  } catch(e) {
    showToast("启动语音失败");
    stopVoiceInput();
  }
}

function stopVoiceInput() {
  _voiceActive = false;
  if (_voiceRec) {
    try { _voiceRec.stop(); } catch(e) {}
    _voiceRec = null;
  }
  var overlay = document.getElementById("voiceOverlay");
  var fab = document.querySelector(".voice-fab");
  overlay.classList.remove("active");
  fab.classList.remove("listening");
}

// 关键词匹配 — 放入/取出
var VOICE_PUT_KEYWORDS = ["放入", "放进", "放冰箱", "放入冰箱", "加", "添加", "买了", "买"];
var VOICE_TAKE_KEYWORDS = ["取出", "拿出", "拿走", "取", "吃了", "吃掉", "吃", "用掉", "用完", "扔了", "扔掉", "丢", "删除", "删"];

function parseVoiceCommand(text) {
  var putKeyword = null;
  var takeKeyword = null;

  // 找放入关键词
  for (var i = 0; i < VOICE_PUT_KEYWORDS.length; i++) {
    var idx = text.indexOf(VOICE_PUT_KEYWORDS[i]);
    if (idx >= 0) {
      if (!putKeyword || idx < text.indexOf(putKeyword)) {
        putKeyword = VOICE_PUT_KEYWORDS[i];
      }
    }
  }

  // 找取出关键词
  for (var j = 0; j < VOICE_TAKE_KEYWORDS.length; j++) {
    var idx2 = text.indexOf(VOICE_TAKE_KEYWORDS[j]);
    if (idx2 >= 0) {
      if (!takeKeyword || idx2 < text.indexOf(takeKeyword)) {
        takeKeyword = VOICE_TAKE_KEYWORDS[j];
      }
    }
  }

  if (putKeyword && (!takeKeyword || text.indexOf(putKeyword) < text.indexOf(takeKeyword))) {
    // 放入模式
    var foodName = extractFoodName(text, putKeyword);
    if (foodName) {
      voiceAddItem(foodName);
    } else {
      showToast("没听清食材名称，请再说一次");
    }
  } else if (takeKeyword) {
    // 取出模式
    var foodName2 = extractFoodName(text, takeKeyword);
    if (foodName2) {
      voiceRemoveItem(foodName2);
    } else {
      showToast("没听清食材名称，请再说一次");
    }
  } else {
    // 没有关键词，尝试直接匹配食材
    var matched = matchPresetByName(text);
    if (matched) {
      voiceAddItem(matched.name, matched.category);
    } else {
      showToast("请说\"放入\"或\"取出\"加食材名称");
    }
  }
}

function extractFoodName(text, keyword) {
  var idx = text.indexOf(keyword);
  if (idx < 0) return null;
  var after = text.substring(idx + keyword.length).trim();
  // 去掉常见语气词
  after = after.replace(/^(了|一些|一点|个|几个|两|三|四|五|六|七|八|九|十)+/g, "").trim();
  // 去掉末尾标点
  after = after.replace(/[，。！？、\s]+$/g, "").trim();
  if (!after) return null;
  return after;
}

function matchPresetByName(name) {
  for (var i = 0; i < PRESETS.length; i++) {
    if (name.indexOf(PRESETS[i].name) >= 0 || PRESETS[i].name.indexOf(name) >= 0) {
      return PRESETS[i];
    }
  }
  return null;
}

function autoCategorize(name) {
  var matched = matchPresetByName(name);
  if (matched) return matched.category;
  // 简单关键词匹配
  var lower = name.toLowerCase();
  if (/西红柿|黄瓜|胡萝卜|西兰花|生菜|菠菜|青椒|土豆|玉米|蘑菇|茄子|白菜|菜|葱|姜|蒜|豆|瓜/.test(name)) return "vegetable";
  if (/肉|排|骨|鸡|鸭|鱼|虾|牛|猪|羊/.test(name)) return "raw_meat";
  if (/面包|蛋糕|吐司|馒头|包|糕|饼干/.test(name)) return "bakery";
  if (/奶|蛋|芝士|奶酪|酸奶|酱/.test(name)) return "other";
  if (/饭|面|粥|汤|剩/.test(name)) return "leftovers";
  if (/泥|粉|糊|辅食|宝宝/.test(name)) return "baby_food";
  return "other";
}

function voiceAddItem(name, category) {
  var cat = category || autoCategorize(name);
  var now = Date.now();
  var tm = new Date(); tm.setDate(tm.getDate() + 3);

  var itemData = {
    name: name, category: cat,
    expiryDate: tm.toISOString().split("T")[0],
    quantity: 1, unit: "份",
    note: "语音添加", addedBy: state.userName,
  };

  if (HAS_SERVER) {
    markLocalChange();
    apiCall("/rooms/" + state.roomCode + "/items", { method: "POST", body: itemData })
      .then(function(d) {
        state.rawItems[d.item.id] = d.item;
        state._renderHash = ""; persistLocal(); renderAll();
        var catLabel = (CATEGORY_META[cat] || {}).label || "其他";
        showToast("语音添加: " + name + " (" + catLabel + ")");
      })
      .catch(function(e) { showToast("添加失败：" + (e.error || e.message)); });
  } else {
    var id = genId(10);
    state.rawItems[id] = { id: id, name: name, category: cat,
      expiryDate: itemData.expiryDate, quantity: 1, unit: "份",
      note: "语音添加", addedBy: state.userName, addedAt: now, updatedAt: now };
    state._renderHash = ""; persistLocal(); renderAll(); autoUpdateHash();
    showToast("语音添加: " + name);
  }
}

function voiceRemoveItem(name) {
  // 查找匹配的食材
  var matched = [];
  Object.keys(state.rawItems).forEach(function(id) {
    var item = state.rawItems[id];
    if (item.name && (item.name.indexOf(name) >= 0 || name.indexOf(item.name) >= 0)) {
      matched.push(item);
    }
  });

  if (matched.length === 0) {
    showToast("冰箱里没有找到\"" + name + "\"");
    return;
  }

  if (matched.length === 1) {
    // 只有一个匹配，直接删除
    voiceDoDelete(matched[0].id, matched[0].name);
  } else {
    // 多个匹配，全部删除
    matched.forEach(function(item) {
      voiceDoDelete(item.id, item.name);
    });
  }
}

function voiceDoDelete(id, name) {
  if (HAS_SERVER) {
    markLocalChange();
    apiCall("/rooms/" + state.roomCode + "/items/" + id, { method: "DELETE" })
      .then(function() {
        delete state.rawItems[id];
        state._renderHash = ""; persistLocal(); renderAll();
        showToast("语音取出: " + name);
      })
      .catch(function(e) { showToast("删除失败：" + (e.error || e.message)); });
  } else {
    delete state.rawItems[id];
    state._renderHash = ""; persistLocal(); renderAll(); autoUpdateHash();
    showToast("语音取出: " + name);
  }
}


(function init() {
  var loadingEl = document.getElementById("loadingOverlay");
  var loadingMsg = document.getElementById("loadingMsg");
  var loadingRetry = document.getElementById("loadingRetry");
  var initDone = false;

  function hideLoading() {
    if (!initDone) {
      initDone = true;
      loadingEl.classList.add("hidden");
      setTimeout(function() {
        if (loadingEl.classList.contains("hidden")) loadingEl.style.display = "none";
      }, 400);
      // 渲染本地已保存的冰箱列表
      renderSavedRooms();
    }
  }

  function showRetry(msg) {
    loadingMsg.textContent = msg || "连接超时，请重试";
    loadingRetry.classList.add("show");
  }

  function detectServerWithTimeout(ms) {
    ms = ms || 8000;
    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, ms);
    return fetch("/api/health", { method: "GET", signal: controller.signal })
      .then(function(r) {
        clearTimeout(timeoutId);
        HAS_SERVER = r.ok;
        if (HAS_SERVER) updateSyncStatus("syncing");
        else updateSyncStatus("offline");
        return HAS_SERVER;
      })
      .catch(function() {
        clearTimeout(timeoutId);
        HAS_SERVER = false;
        updateSyncStatus("offline");
        return false;
      });
  }

  function doAutoLogin() {
    loadingMsg.textContent = "正在连接...";

    detectServerWithTimeout(8000).then(function(hasServer) {
      if (hasServer && loadLocal() && state.roomCode) {
        loadingMsg.textContent = "已找到你的冰箱，正在进入...";
        enterMain(); updateSyncStatus("syncing");
        hideLoading();

        apiCall("/rooms/" + state.roomCode).then(function(d) {
          state.roomName = d.room.name; state.members = d.room.members; state.rawItems = {};
          (d.room.items || []).forEach(function(i) { i.expiryDate = i.expiryDate || i.expiry_date || ""; state.rawItems[i.id] = i; });
          state._synced = true; state._renderHash = ""; persistLocal(); renderAll(); updateSyncStatus("online"); startPolling();
        }).catch(function() {
          updateSyncStatus("offline"); startPolling();
        });
      } else if (hasServer && !(loadLocal() && state.roomCode)) {
        hideLoading();
      } else if (!hasServer) {
        var shared = loadFromHash();
        if (shared) {
          state.roomCode = shared.roomCode; state.roomName = shared.roomName;
          state.members = shared.members; state.rawItems = {};
          shared.items.forEach(function(i) { state.rawItems[i.id] = i; });
          state.memberId = genId(8);
          hideLoading();
          var wrap = document.getElementById("joinUserWrap");
          wrap.classList.remove("hidden");
          wrap._joinCode = shared.roomCode; wrap._shared = shared;
          document.getElementById("joinCode").value = shared.roomCode;
          document.getElementById("joinUser").focus();
          showToast("发现共享冰箱！请输入昵称加入");
        } else if (loadLocal() && state.roomCode) {
          loadingMsg.textContent = "已找到本地数据...";
          enterMain(); hideLoading();
        } else {
          hideLoading();
        }

        // 后台重连
        setTimeout(function() {
          detectServerWithTimeout(5000).then(function(ok) {
            if (ok && state.roomCode) {
              updateSyncStatus("syncing");
              apiCall("/rooms/" + state.roomCode).then(function(d) {
                state.roomName = d.room.name; state.members = d.room.members; state.rawItems = {};
                (d.room.items || []).forEach(function(i) { i.expiryDate = i.expiryDate || i.expiry_date || ""; state.rawItems[i.id] = i; });
                state._synced = true; state._renderHash = ""; persistLocal(); renderAll(); updateSyncStatus("online"); startPolling();
              }).catch(function() { updateSyncStatus("offline"); if (!state._pollTimer) startPolling(); });
            }
          });
        }, 2000);
      }
    }).catch(function() {
      if (loadLocal() && state.roomCode) {
        loadingMsg.textContent = "服务器连接失败，使用本地数据...";
        enterMain(); hideLoading();
      } else {
        showRetry("连接失败，请检查网络后重试");
      }
    });
  }

  window.retryAutoLogin = function() {
    loadingRetry.classList.remove("show");
    loadingMsg.textContent = "重新连接中...";
    doAutoLogin();
  };

  doAutoLogin();
})();
