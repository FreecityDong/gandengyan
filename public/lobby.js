const socket = io();

const els = {
  connPill: document.getElementById("connPill"),
  nicknameInput: document.getElementById("nicknameInput"),
  randomNicknameBtn: document.getElementById("randomNicknameBtn"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  joinRoomInput: document.getElementById("joinRoomInput"),
  joinRoomBtn: document.getElementById("joinRoomBtn"),
  roomCountText: document.getElementById("roomCountText"),
  roomList: document.getElementById("roomList"),
  logLevelFilter: document.getElementById("logLevelFilter"),
  logCategoryFilter: document.getElementById("logCategoryFilter"),
  messageBox: document.getElementById("messageBox"),
};

const STORAGE_KEY_NICKNAME = "qiexigua:nickname";

const state = {
  mode: null,
  pendingJoinRoomId: "",
  hasRedirected: false,
  rooms: [],
};

const randomPartA = ["海风", "山岚", "青竹", "野火", "海盐", "晨光", "黑桃", "赤兔", "青瓷", "江潮"];
const randomPartB = ["猎手", "老炮", "船长", "玩家", "大师", "小将", "阿强", "阿星", "铁头", "顺子王"];

function randomNickname() {
  const a = randomPartA[Math.floor(Math.random() * randomPartA.length)];
  const b = randomPartB[Math.floor(Math.random() * randomPartB.length)];
  const num = String(Math.floor(Math.random() * 90) + 10);
  return `${a}-${b}${num}`;
}

function applyLogFilter() {
  const level = els.logLevelFilter.value;
  const category = els.logCategoryFilter.value;

  els.messageBox.querySelectorAll(".log").forEach((node) => {
    const levelMatch = level === "all" || node.dataset.level === level;
    const categoryMatch = category === "all" || node.dataset.category === category;
    node.style.display = levelMatch && categoryMatch ? "" : "none";
  });
}

function log(message, options = {}) {
  const level = options.level || "info";
  const category = options.category || "system";
  const line = document.createElement("div");
  line.className = `log ${level === "info" ? "" : level}`.trim();
  line.dataset.level = level;
  line.dataset.category = category;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  els.messageBox.prepend(line);
  applyLogFilter();
}

function normalizeNickname() {
  return els.nicknameInput.value.trim().slice(0, 16);
}

function persistNickname(nickname) {
  localStorage.setItem(STORAGE_KEY_NICKNAME, nickname);
}

function redirectToRoom(roomId, nickname) {
  if (state.hasRedirected) return;
  state.hasRedirected = true;
  const qs = new URLSearchParams({ nickname }).toString();
  window.location.href = `/room/${encodeURIComponent(roomId)}?${qs}`;
}

function statusText(status) {
  const map = {
    waiting: "等待中",
    ready: "可开局",
    playing: "对局中",
    settlement: "结算中",
    closed: "已关闭",
  };
  return map[status] || status;
}

function renderRoomList() {
  const rooms = state.rooms || [];
  els.roomCountText.textContent = `${rooms.length} 个房间`;
  els.roomList.innerHTML = "";

  if (rooms.length === 0) {
    const empty = document.createElement("div");
    empty.className = "room-list-empty";
    empty.textContent = "暂无房间，先创建一个吧";
    els.roomList.appendChild(empty);
    return;
  }

  rooms.forEach((room) => {
    const item = document.createElement("div");
    item.className = "room-list-item";

    const canJoin = Boolean(room.canJoin);
    const joinBtnText = canJoin ? "加入" : "不可加入";

    item.innerHTML = `
      <div class="room-main">
        <div class="room-id">${room.roomId}</div>
        <div class="room-meta">房主: ${room.ownerNickname} | 状态: ${statusText(room.status)}</div>
        <div class="room-meta">人数: ${room.onlineCount}/${room.playerCount}（总上限 ${room.maxPlayers}）</div>
      </div>
      <button class="room-join-btn" ${canJoin ? "" : "disabled"}>${joinBtnText}</button>
    `;

    const button = item.querySelector(".room-join-btn");
    if (button && canJoin) {
      button.addEventListener("click", () => {
        els.joinRoomInput.value = room.roomId;
        els.joinRoomBtn.click();
      });
    }

    els.roomList.appendChild(item);
  });
}

els.randomNicknameBtn.addEventListener("click", () => {
  els.nicknameInput.value = randomNickname();
});

els.createRoomBtn.addEventListener("click", () => {
  const nickname = normalizeNickname();
  if (!nickname) {
    log("请输入昵称", { level: "error", category: "action" });
    return;
  }
  state.mode = "create";
  state.pendingJoinRoomId = "";
  persistNickname(nickname);
  socket.emit("lobby:create_room", { nickname });
  log("正在创建房间...", { level: "ok", category: "action" });
});

els.joinRoomBtn.addEventListener("click", () => {
  const nickname = normalizeNickname();
  const roomId = els.joinRoomInput.value.trim().toUpperCase();

  if (!nickname) {
    log("请输入昵称", { level: "error", category: "action" });
    return;
  }
  if (!roomId) {
    log("请输入房间码", { level: "error", category: "action" });
    return;
  }

  state.mode = "join";
  state.pendingJoinRoomId = roomId;
  persistNickname(nickname);
  socket.emit("lobby:join_room", { roomId, nickname });
  log(`正在加入房间 ${roomId}...`, { level: "ok", category: "action" });
});

socket.on("connect", () => {
  els.connPill.textContent = "已连接";
  log("已连接到服务器", { level: "ok", category: "system" });
  socket.emit("lobby:list_rooms");
});

socket.on("disconnect", () => {
  els.connPill.textContent = "连接断开";
  log("与服务器断开连接", { level: "error", category: "system" });
});

socket.on("room:state", (payload) => {
  const nickname = normalizeNickname();
  const roomId = payload.roomId;
  if (!nickname || !roomId) return;

  if (state.mode === "join" && state.pendingJoinRoomId && roomId !== state.pendingJoinRoomId) {
    return;
  }

  log(`进入房间成功: ${roomId}`, { level: "ok", category: "lobby" });
  redirectToRoom(roomId, nickname);
});

socket.on("error", (payload) => {
  if (!payload) return;
  log(payload.message || "发生错误", { level: "error", category: "system" });
});

socket.on("lobby:room_list", (payload = {}) => {
  state.rooms = Array.isArray(payload.rooms) ? payload.rooms : [];
  renderRoomList();
});

const storedNickname = localStorage.getItem(STORAGE_KEY_NICKNAME);
els.nicknameInput.value = storedNickname || randomNickname();
els.logLevelFilter.addEventListener("change", applyLogFilter);
els.logCategoryFilter.addEventListener("change", applyLogFilter);
renderRoomList();
