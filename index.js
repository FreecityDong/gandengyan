const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const gandengyanEngine = require("./src/game-engine");
const sevensEngine = require("./src/sevens-engine");

const PORT = Number(process.env.PORT || 3000);
const RECONNECT_TTL_MS = 3 * 60 * 1000;
const ROOM_IDLE_TTL_MS = 30 * 60 * 1000;
const AUTO_PASS_TIMEOUT_MS = 15 * 1000;
const SCORE_DATA_DIR = path.join(__dirname, "data");
const SCORE_DATA_FILE = path.join(SCORE_DATA_DIR, "room-totals.json");
const MAX_PERSISTED_ROOMS = 100;
const GAME_TYPES = {
  GANDENGYAN: "gandengyan",
  SEVENS: "sevens",
};
const ROOM_RULES = {
  [GAME_TYPES.GANDENGYAN]: {
    minPlayers: 3,
    maxPlayers: 5,
    label: "干瞪眼",
  },
  [GAME_TYPES.SEVENS]: {
    minPlayers: 2,
    maxPlayers: 6,
    label: "接龙",
  },
};

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public"), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  },
}));

app.get("/room/:roomId", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "room.html"));
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, ts: Date.now() });
});

app.get("/scores/recent", (_req, res) => {
  res.json({
    ok: true,
    count: persistedRoomTotals.length,
    items: persistedRoomTotals,
  });
});

const rooms = new Map();
const socketIndex = new Map();
let persistedRoomTotals = [];
persistedRoomTotals = loadPersistedRoomTotals();

function loadPersistedRoomTotals() {
  try {
    if (!fs.existsSync(SCORE_DATA_FILE)) return [];
    const raw = fs.readFileSync(SCORE_DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[scores] 读取累计分文件失败:", err.message);
    return [];
  }
}

function savePersistedRoomTotals() {
  try {
    fs.mkdirSync(SCORE_DATA_DIR, { recursive: true });
    fs.writeFileSync(
      SCORE_DATA_FILE,
      `${JSON.stringify(persistedRoomTotals, null, 2)}\n`,
      "utf8",
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[scores] 写入累计分文件失败:", err.message);
  }
}

function snapshotRoomTotals(room) {
  const isSevens = room.gameType === GAME_TYPES.SEVENS;
  const players = room.players
    .map((p) => ({
      playerId: p.id,
      nickname: p.nickname,
      total: room.totals[p.id] || 0,
      connected: p.connected,
    }))
    .sort((a, b) => (isSevens ? a.total - b.total : b.total - a.total));

  return {
    roomId: room.id,
    gameType: room.gameType || GAME_TYPES.GANDENGYAN,
    updatedAt: Date.now(),
    roundsPlayed: room.roundsPlayed || 0,
    players,
  };
}

function persistRoomTotalsSnapshot(room) {
  const next = snapshotRoomTotals(room);
  const idx = persistedRoomTotals.findIndex((item) => item.roomId === room.id);
  if (idx >= 0) {
    persistedRoomTotals[idx] = next;
  } else {
    persistedRoomTotals.push(next);
  }

  persistedRoomTotals.sort((a, b) => b.updatedAt - a.updatedAt);
  persistedRoomTotals = persistedRoomTotals.slice(0, MAX_PERSISTED_ROOMS);
  savePersistedRoomTotals();
}

function normalizeGameType(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (value === GAME_TYPES.SEVENS) return GAME_TYPES.SEVENS;
  return GAME_TYPES.GANDENGYAN;
}

function getRoomRules(roomOrType) {
  const gameType = typeof roomOrType === "string"
    ? normalizeGameType(roomOrType)
    : normalizeGameType(roomOrType && roomOrType.gameType);
  return ROOM_RULES[gameType] || ROOM_RULES[GAME_TYPES.GANDENGYAN];
}

function getPlayersRangeText(roomOrType) {
  const rules = getRoomRules(roomOrType);
  return `${rules.minPlayers}-${rules.maxPlayers}`;
}

function getEngineByRoom(room) {
  if (normalizeGameType(room && room.gameType) === GAME_TYPES.SEVENS) {
    return sevensEngine;
  }
  return gandengyanEngine;
}

function normalizeNickname(raw) {
  const nickname = String(raw || "").trim();
  if (!nickname) return "";
  return nickname.slice(0, 16);
}

function generateId(prefix, length) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  for (let i = 0; i < length; i += 1) {
    value += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}${value}`;
}

function generateRoomId() {
  let roomId = "";
  do {
    roomId = generateId("", 6);
  } while (rooms.has(roomId));
  return roomId;
}

function createPlayer(nickname, socketId) {
  return {
    id: generateId("P", 8),
    nickname,
    socketId,
    connected: true,
    seatIndex: null,
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
  };
}

function findPlayer(room, playerId) {
  return room.players.find((p) => p.id === playerId) || null;
}

function getRoomBySocket(socketId) {
  const ref = socketIndex.get(socketId);
  if (!ref) return null;
  const room = rooms.get(ref.roomId);
  if (!room) return null;
  return { room, playerId: ref.playerId };
}

function refreshRoomStatus(room) {
  if (room.status === "playing") return;
  if (room.status === "settlement") return;
  const rules = getRoomRules(room);
  room.status = room.players.length >= rules.minPlayers ? "ready" : "waiting";
}

function transferOwnerIfNeeded(room) {
  const owner = findPlayer(room, room.ownerPlayerId);
  if (owner && owner.connected) return;
  const nextOwner = room.players.find((p) => p.connected);
  if (nextOwner) room.ownerPlayerId = nextOwner.id;
}

function clearAutoPassTimer(room) {
  if (!room.autoPassTimer) return;
  clearTimeout(room.autoPassTimer.timerId);
  room.autoPassTimer = null;
}

function handleAutoPassTimeout(roomId, expectedPlayerId) {
  const room = rooms.get(roomId);
  if (!room || room.status !== "playing" || !room.game) return;
  if (room.game.turnPlayerId !== expectedPlayerId) return;

  const turnPlayer = findPlayer(room, expectedPlayerId);
  if (!turnPlayer || turnPlayer.connected) return;

  const engine = getEngineByRoom(room);

  if (normalizeGameType(room.gameType) === GAME_TYPES.SEVENS) {
    const result = engine.autoAct(room, expectedPlayerId);
    if (!result.ok) return;

    incrementActionSeq(room);
    for (const player of room.players) {
      if (!player.connected || !player.socketId) continue;
      const target = io.sockets.sockets.get(player.socketId);
      if (!target) continue;

      const canSeeDiscardCard = result.actionType === "discard" && player.id === expectedPlayerId;
      target.emit("game:auto_action", {
        playerId: expectedPlayerId,
        timeoutMs: AUTO_PASS_TIMEOUT_MS,
        actionType: result.actionType,
        cards: (result.played || []).map(engine.serializeCard),
        card: canSeeDiscardCard && result.discarded ? engine.serializeCard(result.discarded) : null,
        revealed: canSeeDiscardCard,
        nextTurnPlayerId: result.nextTurnPlayerId,
        gameEnded: Boolean(result.gameEnded),
      });
    }

    if (result.gameEnded) {
      room.roundsPlayed = (room.roundsPlayed || 0) + 1;
      persistRoomTotalsSnapshot(room);
      emitSettlement(room, result.settlement);
    }

    emitRoomState(room);
    scheduleAutoPassIfNeeded(room);
    return;
  }

  const result = engine.passTurn(room, expectedPlayerId, { force: true });
  if (!result.ok) return;

  incrementActionSeq(room);
  io.to(room.id).emit("game:auto_pass", {
    playerId: expectedPlayerId,
    timeoutMs: AUTO_PASS_TIMEOUT_MS,
    nextTurnPlayerId: result.nextTurnPlayerId,
    roundEnd: result.roundEnd,
    forcedLeadPass: Boolean(result.forcedLeadPass),
  });

  if (result.roundEnd) {
    emitRoundEnd(room, result);
  }

  emitRoomState(room);
  scheduleAutoPassIfNeeded(room);
}

function scheduleAutoPassIfNeeded(room) {
  clearAutoPassTimer(room);

  if (!room || room.status !== "playing" || !room.game) return;
  const connectedCount = room.players.filter((p) => p.connected).length;
  if (connectedCount <= 0) return;

  const turnPlayerId = room.game.turnPlayerId;
  if (!turnPlayerId) return;

  const turnPlayer = findPlayer(room, turnPlayerId);
  if (!turnPlayer || turnPlayer.connected) return;

  const timerId = setTimeout(() => {
    handleAutoPassTimeout(room.id, turnPlayerId);
  }, AUTO_PASS_TIMEOUT_MS);
  room.autoPassTimer = {
    timerId,
    playerId: turnPlayerId,
    startedAt: Date.now(),
  };
}

function emitError(socket, message, code = "BAD_REQUEST") {
  socket.emit("error", { code, message });
}

function emitRoomState(room) {
  const engine = getEngineByRoom(room);
  for (const player of room.players) {
    if (!player.connected || !player.socketId) continue;
    const target = io.sockets.sockets.get(player.socketId);
    if (!target) continue;
    target.emit("room:state", engine.toRoomState(room, player.id));
  }
}

function emitSettlement(room, settlement) {
  io.to(room.id).emit("game:settlement", settlement);
}

function emitRoundEnd(room, roundEndResult) {
  for (const player of room.players) {
    if (!player.connected || !player.socketId) continue;
    const target = io.sockets.sockets.get(player.socketId);
    if (!target) continue;

    const canSeeDrawCard = roundEndResult.drawCard && player.id === roundEndResult.roundWinnerId;
    target.emit("game:round_end", {
      roundWinnerId: roundEndResult.roundWinnerId,
      drawByPlayerId: roundEndResult.roundWinnerId,
      drawTaken: Boolean(roundEndResult.drawCard),
      drawResult: canSeeDrawCard ? gandengyanEngine.serializeCard(roundEndResult.drawCard) : null,
      nextTurnPlayerId: roundEndResult.nextTurnPlayerId,
    });
  }
}

function buildRoomListSnapshot() {
  const result = [];

  for (const room of rooms.values()) {
    const gameType = normalizeGameType(room.gameType);
    const rules = getRoomRules(gameType);
    const owner = findPlayer(room, room.ownerPlayerId);
    const onlineCount = room.players.filter((p) => p.connected).length;
    const playerCount = room.players.length;
    const canJoin = room.status !== "playing" && playerCount < rules.maxPlayers;

    result.push({
      roomId: room.id,
      gameType,
      gameLabel: rules.label,
      status: room.status,
      playerCount,
      onlineCount,
      maxPlayers: rules.maxPlayers,
      minPlayers: rules.minPlayers,
      ownerNickname: owner ? owner.nickname : "-",
      canJoin,
      createdAt: room.createdAt,
    });
  }

  result.sort((a, b) => b.createdAt - a.createdAt);
  return result;
}

function emitRoomList(targetSocket = null) {
  const payload = {
    rooms: buildRoomListSnapshot(),
    ts: Date.now(),
  };

  if (targetSocket) {
    targetSocket.emit("lobby:room_list", payload);
    return;
  }

  io.emit("lobby:room_list", payload);
}

function incrementActionSeq(room) {
  room.actionSeq += 1;
  emitRoomList();
}

function tryCleanupRoom(room) {
  const connectedCount = room.players.filter((p) => p.connected).length;
  if (connectedCount > 0) return;

  const lastActiveAt = room.players.reduce(
    (max, p) => Math.max(max, p.lastSeenAt || p.joinedAt || 0),
    0,
  );

  if (Date.now() - lastActiveAt >= ROOM_IDLE_TTL_MS) {
    clearAutoPassTimer(room);
    rooms.delete(room.id);
    emitRoomList();
  }
}

function canReconnect(disconnectedPlayer) {
  if (!disconnectedPlayer || disconnectedPlayer.connected) return false;
  return Date.now() - disconnectedPlayer.lastSeenAt <= RECONNECT_TTL_MS;
}

function attachSocketToPlayer(socket, room, player) {
  player.socketId = socket.id;
  player.connected = true;
  player.lastSeenAt = Date.now();
  socket.join(room.id);
  socketIndex.set(socket.id, { roomId: room.id, playerId: player.id });
}

io.on("connection", (socket) => {
  emitRoomList(socket);

  socket.on("lobby:list_rooms", () => {
    emitRoomList(socket);
  });

  socket.on("lobby:create_room", (payload = {}) => {
    const nickname = normalizeNickname(payload.nickname);
    const gameType = normalizeGameType(payload.gameType);
    if (!nickname) {
      emitError(socket, "昵称不能为空");
      return;
    }

    if (socketIndex.has(socket.id)) {
      emitError(socket, "你已经在一个房间里了");
      return;
    }

    const roomId = generateRoomId();
    const player = createPlayer(nickname, socket.id);

    const room = {
      id: roomId,
      gameType,
      ownerPlayerId: player.id,
      players: [player],
      status: "waiting",
      game: null,
      totals: { [player.id]: 0 },
      lastWinnerId: null,
      lastSeatOrder: null,
      roundsPlayed: 0,
      autoPassTimer: null,
      actionSeq: 0,
      createdAt: Date.now(),
    };

    rooms.set(roomId, room);
    socket.join(roomId);
    socketIndex.set(socket.id, { roomId, playerId: player.id });

    incrementActionSeq(room);
    emitRoomState(room);
    scheduleAutoPassIfNeeded(room);
  });

  socket.on("lobby:join_room", (payload = {}) => {
    const roomId = String(payload.roomId || "").trim().toUpperCase();
    const nickname = normalizeNickname(payload.nickname);

    if (!roomId) {
      emitError(socket, "请输入房间码");
      return;
    }
    if (!nickname) {
      emitError(socket, "昵称不能为空");
      return;
    }

    if (socketIndex.has(socket.id)) {
      emitError(socket, "你已经在一个房间里了");
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      emitError(socket, "房间不存在");
      return;
    }

    const existingOnline = room.players.find(
      (p) => p.nickname === nickname && p.connected,
    );
    if (existingOnline) {
      emitError(socket, "昵称已被占用");
      return;
    }

    const reconnectPlayer = room.players.find(
      (p) => p.nickname === nickname && canReconnect(p),
    );

    if (reconnectPlayer) {
      attachSocketToPlayer(socket, room, reconnectPlayer);
      transferOwnerIfNeeded(room);
      incrementActionSeq(room);
      emitRoomState(room);
      scheduleAutoPassIfNeeded(room);
      return;
    }

    if (room.status === "playing") {
      emitError(socket, "对局中仅支持同昵称重连");
      return;
    }

    const rules = getRoomRules(room);
    if (room.players.length >= rules.maxPlayers) {
      emitError(socket, `房间已满（最多 ${rules.maxPlayers} 人）`);
      return;
    }

    const player = createPlayer(nickname, socket.id);
    room.players.push(player);
    room.totals[player.id] = room.totals[player.id] || 0;

    attachSocketToPlayer(socket, room, player);
    refreshRoomStatus(room);

    incrementActionSeq(room);
    emitRoomState(room);
    scheduleAutoPassIfNeeded(room);
  });

  socket.on("room:start_game", (payload = {}) => {
    const ref = getRoomBySocket(socket.id);
    if (!ref) {
      emitError(socket, "请先加入房间");
      return;
    }

    const room = ref.room;
    if (payload.roomId && String(payload.roomId).trim().toUpperCase() !== room.id) {
      emitError(socket, "房间信息不匹配");
      return;
    }

    if (room.ownerPlayerId !== ref.playerId) {
      emitError(socket, "只有房主可以开始游戏", "FORBIDDEN");
      return;
    }

    if (room.status === "playing") {
      emitError(socket, "对局已开始");
      return;
    }

    const rules = getRoomRules(room);
    if (room.players.length < rules.minPlayers || room.players.length > rules.maxPlayers) {
      emitError(socket, `人数必须为 ${getPlayersRangeText(room)} 人`);
      return;
    }
    if (room.players.some((p) => !p.connected)) {
      emitError(socket, "有玩家离线，暂不能开局");
      return;
    }

    try {
      const engine = getEngineByRoom(room);
      const result = engine.startGame(room);
      incrementActionSeq(room);

      for (const player of room.players) {
        if (!player.connected || !player.socketId) continue;
        const target = io.sockets.sockets.get(player.socketId);
        if (!target) continue;

        const playerView = engine.toRoomState(room, player.id);
        target.emit("game:dealt", {
          yourHand: playerView.game.yourHand,
          turnPlayerId: result.turnPlayerId,
          seatOrder: result.seatOrder,
          dealerId: result.dealerId || null,
          gameType: normalizeGameType(room.gameType),
        });
      }

      emitRoomState(room);
      scheduleAutoPassIfNeeded(room);
    } catch (err) {
      emitError(socket, err.message || "开局失败");
    }
  });

  socket.on("game:play_cards", (payload = {}) => {
    const ref = getRoomBySocket(socket.id);
    if (!ref) {
      emitError(socket, "请先加入房间");
      return;
    }

    const room = ref.room;
    if (room.status !== "playing") {
      emitError(socket, "当前不在对局中");
      return;
    }

    const cardIds = Array.isArray(payload.cards)
      ? payload.cards.map((id) => String(id))
      : [];

    const engine = getEngineByRoom(room);
    const result = engine.playCards(room, ref.playerId, cardIds);
    if (!result.ok) {
      emitError(socket, result.reason || "出牌失败");
      return;
    }

    incrementActionSeq(room);

    io.to(room.id).emit("game:played", {
      playerId: ref.playerId,
      actionType: result.actionType || "play",
      cards: (result.played || []).map(engine.serializeCard),
      card: result.discarded ? engine.serializeCard(result.discarded) : null,
      side: result.side || null,
      nextTurnPlayerId: result.nextTurnPlayerId,
    });

    if (result.gameEnded) {
      room.roundsPlayed = (room.roundsPlayed || 0) + 1;
      persistRoomTotalsSnapshot(room);
      emitSettlement(room, result.settlement);
    }

    emitRoomState(room);
    scheduleAutoPassIfNeeded(room);
  });

  socket.on("game:discard_card", (payload = {}) => {
    const ref = getRoomBySocket(socket.id);
    if (!ref) {
      emitError(socket, "请先加入房间");
      return;
    }

    const room = ref.room;
    if (room.status !== "playing") {
      emitError(socket, "当前不在对局中");
      return;
    }

    if (normalizeGameType(room.gameType) !== GAME_TYPES.SEVENS) {
      emitError(socket, "当前玩法不支持弃牌操作");
      return;
    }

    const cardId = String(payload.card || "").trim();
    const result = sevensEngine.discardCard(room, ref.playerId, cardId);
    if (!result.ok) {
      emitError(socket, result.reason || "弃牌失败");
      return;
    }

    incrementActionSeq(room);
    for (const player of room.players) {
      if (!player.connected || !player.socketId) continue;
      const target = io.sockets.sockets.get(player.socketId);
      if (!target) continue;

      const canSeeDiscardCard = player.id === ref.playerId;
      target.emit("game:discarded", {
        playerId: ref.playerId,
        card: canSeeDiscardCard && result.discarded ? sevensEngine.serializeCard(result.discarded) : null,
        revealed: canSeeDiscardCard,
        nextTurnPlayerId: result.nextTurnPlayerId,
      });
    }

    if (result.gameEnded) {
      room.roundsPlayed = (room.roundsPlayed || 0) + 1;
      persistRoomTotalsSnapshot(room);
      emitSettlement(room, result.settlement);
    }

    emitRoomState(room);
    scheduleAutoPassIfNeeded(room);
  });

  socket.on("game:pass", (payload = {}) => {
    const ref = getRoomBySocket(socket.id);
    if (!ref) {
      emitError(socket, "请先加入房间");
      return;
    }

    const room = ref.room;
    if (room.status !== "playing") {
      emitError(socket, "当前不在对局中");
      return;
    }

    const engine = getEngineByRoom(room);
    const result = engine.passTurn(room, ref.playerId);
    if (!result.ok) {
      emitError(socket, result.reason || "过牌失败");
      return;
    }

    incrementActionSeq(room);

    if (normalizeGameType(room.gameType) === GAME_TYPES.GANDENGYAN && result.roundEnd) {
      emitRoundEnd(room, result);
    }

    emitRoomState(room);
    scheduleAutoPassIfNeeded(room);
  });

  socket.on("room:next_round", (payload = {}) => {
    const ref = getRoomBySocket(socket.id);
    if (!ref) {
      emitError(socket, "请先加入房间");
      return;
    }

    const room = ref.room;
    if (payload.roomId && String(payload.roomId).trim().toUpperCase() !== room.id) {
      emitError(socket, "房间信息不匹配");
      return;
    }

    if (room.ownerPlayerId !== ref.playerId) {
      emitError(socket, "只有房主可以开始下一局", "FORBIDDEN");
      return;
    }

    if (room.status !== "settlement") {
      emitError(socket, "当前不在结算状态");
      return;
    }
    if (room.players.some((p) => !p.connected)) {
      emitError(socket, "有玩家离线，暂不能开始下一局");
      return;
    }
    const rules = getRoomRules(room);
    if (room.players.length < rules.minPlayers || room.players.length > rules.maxPlayers) {
      emitError(socket, `人数必须为 ${getPlayersRangeText(room)} 人`);
      return;
    }

    try {
      const engine = getEngineByRoom(room);
      const result = engine.startGame(room);
      incrementActionSeq(room);

      for (const player of room.players) {
        if (!player.connected || !player.socketId) continue;
        const target = io.sockets.sockets.get(player.socketId);
        if (!target) continue;

        const playerView = engine.toRoomState(room, player.id);
        target.emit("game:dealt", {
          yourHand: playerView.game.yourHand,
          turnPlayerId: result.turnPlayerId,
          seatOrder: result.seatOrder,
          dealerId: result.dealerId || null,
          gameType: normalizeGameType(room.gameType),
        });
      }

      emitRoomState(room);
      scheduleAutoPassIfNeeded(room);
    } catch (err) {
      emitError(socket, err.message || "开启下一局失败");
    }
  });

  socket.on("disconnect", () => {
    const ref = socketIndex.get(socket.id);
    if (!ref) return;

    socketIndex.delete(socket.id);

    const room = rooms.get(ref.roomId);
    if (!room) return;

    const player = findPlayer(room, ref.playerId);
    if (!player) return;

    player.connected = false;
    player.socketId = null;
    player.lastSeenAt = Date.now();

    transferOwnerIfNeeded(room);
    refreshRoomStatus(room);
    incrementActionSeq(room);
    emitRoomState(room);
    scheduleAutoPassIfNeeded(room);
    tryCleanupRoom(room);
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    tryCleanupRoom(room);
  }
}, 60 * 1000);

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`牌类大厅服务已启动: http://0.0.0.0:${PORT}`);
});
