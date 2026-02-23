const socket = io();

const STORAGE_KEY_NICKNAME = "qiexigua:nickname";

function parseRoomIdFromLocation() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && parts[0] === "room") {
    return decodeURIComponent(parts[1]).toUpperCase();
  }
  const qsRoomId = new URLSearchParams(window.location.search).get("roomId");
  return String(qsRoomId || "").trim().toUpperCase();
}

const qs = new URLSearchParams(window.location.search);
const initialRoomId = parseRoomIdFromLocation();
const initialNickname = String(qs.get("nickname") || localStorage.getItem(STORAGE_KEY_NICKNAME) || "")
  .trim()
  .slice(0, 16);

if (!initialRoomId || !initialNickname) {
  window.location.replace("/");
}

localStorage.setItem(STORAGE_KEY_NICKNAME, initialNickname);

const state = {
  roomId: initialRoomId,
  nickname: initialNickname,
  room: null,
  myPlayerId: null,
  selected: new Set(),
  latestSettlement: null,
};

const els = {
  connPill: document.getElementById("connPill"),
  nicknameText: document.getElementById("nicknameText"),
  roomCodeText: document.getElementById("roomCodeText"),
  roomStatusText: document.getElementById("roomStatusText"),
  bombCountText: document.getElementById("bombCountText"),
  deckCountText: document.getElementById("deckCountText"),
  turnText: document.getElementById("turnText"),
  playerList: document.getElementById("playerList"),
  startGameBtn: document.getElementById("startGameBtn"),
  nextRoundBtn: document.getElementById("nextRoundBtn"),
  lastPlayBox: document.getElementById("lastPlayBox"),
  playCardsBtn: document.getElementById("playCardsBtn"),
  passBtn: document.getElementById("passBtn"),
  clearSelectionBtn: document.getElementById("clearSelectionBtn"),
  handCards: document.getElementById("handCards"),
  logLevelFilter: document.getElementById("logLevelFilter"),
  logCategoryFilter: document.getElementById("logCategoryFilter"),
  messageBox: document.getElementById("messageBox"),
  settlementModal: document.getElementById("settlementModal"),
  settlementWinnerText: document.getElementById("settlementWinnerText"),
  settlementList: document.getElementById("settlementList"),
  closeSettlementBtn: document.getElementById("closeSettlementBtn"),
};

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

const SUIT_SYMBOL = {
  S: "♠",
  H: "♥",
  C: "♣",
  D: "♦",
};

function cardLabel(card) {
  if (card.rank === "SJ") return "小王";
  if (card.rank === "BJ") return "大王";
  const suit = SUIT_SYMBOL[card.suit] || card.suit || "";
  return `${suit}${card.rank}`;
}

function cardFaceInfo(card) {
  if (card.rank === "SJ") {
    return {
      colorClass: "joker",
      top: "JOKER",
      center: "小王",
      bottom: "JOKER",
    };
  }
  if (card.rank === "BJ") {
    return {
      colorClass: "joker",
      top: "JOKER",
      center: "大王",
      bottom: "JOKER",
    };
  }

  const suit = SUIT_SYMBOL[card.suit] || "?";
  const isRed = card.suit === "H" || card.suit === "D";
  return {
    colorClass: isRed ? "red" : "black",
    top: `${card.rank}${suit}`,
    center: suit,
    bottom: `${suit}${card.rank}`,
  };
}

function createCardElement(card, options = {}) {
  const selected = Boolean(options.selected);
  const compact = Boolean(options.compact);
  const interactive = Boolean(options.interactive);
  const face = cardFaceInfo(card);

  const el = interactive ? document.createElement("button") : document.createElement("div");
  if (interactive) {
    el.type = "button";
  }

  el.className = [
    "poker-card",
    face.colorClass,
    compact ? "compact" : "",
    selected ? "selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  el.setAttribute("aria-label", cardLabel(card));
  el.innerHTML = `
    <span class="corner top">${face.top}</span>
    <span class="center">${face.center}</span>
    <span class="corner bottom">${face.bottom}</span>
  `;
  return el;
}

function rankValueFromCard(card) {
  const map = {
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    "10": 10,
    J: 11,
    Q: 12,
    K: 13,
    A: 14,
    "2": 15,
    SJ: 16,
    BJ: 17,
  };
  return map[card.rank] || card.value || 0;
}

function isJoker(card) {
  return card.rank === "SJ" || card.rank === "BJ";
}

function buildCounts(cards) {
  const map = new Map();
  cards.forEach((card) => {
    const v = rankValueFromCard(card);
    map.set(v, (map.get(v) || 0) + 1);
  });
  return map;
}

function evaluateNOfKind(cards, n) {
  const jokers = cards.filter(isJoker).length;
  const nonJokers = cards.filter((c) => !isJoker(c));
  const counts = buildCounts(nonJokers);
  const keys = [...counts.keys()].sort((a, b) => b - a);

  if (nonJokers.length === 0 && jokers === n) {
    return { ok: true, strength: 15 };
  }

  for (const key of keys) {
    const thisCount = counts.get(key);
    const others = nonJokers.length - thisCount;
    if (others !== 0) continue;
    if (thisCount + jokers === n) return { ok: true, strength: key };
  }

  if (keys.length <= 1) {
    const key = keys[0] || 15;
    if ((counts.get(key) || 0) + jokers === n) {
      return { ok: true, strength: key };
    }
  }

  return { ok: false };
}

function canBuildSequence(nonJokerCounts, jokers, length, unitSize) {
  let bestTail = -1;

  for (let start = 3; start <= 14 - length + 1; start += 1) {
    const req = [];
    for (let i = 0; i < length; i += 1) req.push(start + i);

    let needJokers = 0;
    let invalid = false;

    for (const [value, count] of nonJokerCounts.entries()) {
      if (!req.includes(value) || count > unitSize) {
        invalid = true;
        break;
      }
    }
    if (invalid) continue;

    req.forEach((v) => {
      const has = nonJokerCounts.get(v) || 0;
      needJokers += unitSize - has;
    });

    if (needJokers === jokers) {
      const tail = start + length - 1;
      if (tail > bestTail) bestTail = tail;
    }
  }

  if (bestTail >= 0) {
    return { ok: true, tail: bestTail };
  }

  return { ok: false };
}

function analyzeSelection(cards) {
  if (!cards.length) return { ok: false, reason: "至少选择一张牌" };

  const sorted = [...cards].sort((a, b) => rankValueFromCard(a) - rankValueFromCard(b));
  const len = sorted.length;

  if (len === 1) {
    return { ok: true, type: "single", strength: rankValueFromCard(sorted[0]), length: 1 };
  }

  if (len === 2) {
    const pair = evaluateNOfKind(sorted, 2);
    if (pair.ok) return { ok: true, type: "pair", strength: pair.strength, length: 2 };
  }

  if (len === 3) {
    const bomb = evaluateNOfKind(sorted, 3);
    if (bomb.ok) return { ok: true, type: "bomb", strength: bomb.strength, length: 3 };
  }

  const jokers = sorted.filter(isJoker).length;
  const nonJoker = sorted.filter((c) => !isJoker(c));
  const counts = buildCounts(nonJoker);

  if (len >= 3) {
    const straight = canBuildSequence(counts, jokers, len, 1);
    if (straight.ok) return { ok: true, type: "straight", strength: straight.tail, length: len };
  }

  if (len >= 4 && len % 2 === 0) {
    const pairRun = canBuildSequence(counts, jokers, len / 2, 2);
    if (pairRun.ok) return { ok: true, type: "pair_run", strength: pairRun.tail, length: len };
  }

  return { ok: false, reason: "不合法牌型" };
}

function canBeatLocal(play, lastPlay) {
  if (!lastPlay) return true;
  if (play.type === "bomb" && lastPlay.type !== "bomb") return true;
  if (play.type !== lastPlay.type) return false;

  if ((play.type === "straight" || play.type === "pair_run") && play.length !== lastPlay.length) {
    return false;
  }

  return play.strength > (lastPlay.strength || 0);
}

function getMyPlayer() {
  if (!state.room || !state.myPlayerId) return null;
  return state.room.players.find((p) => p.id === state.myPlayerId) || null;
}

function getPlayerNameById(id) {
  if (!state.room) return "-";
  const p = state.room.players.find((it) => it.id === id);
  return p ? p.nickname : "-";
}

function renderPlayers() {
  els.playerList.innerHTML = "";
  if (!state.room) return;

  const turnPlayerId = state.room.game ? state.room.game.turnPlayerId : null;

  const sorted = [...state.room.players].sort((a, b) => {
    const sa = a.seatIndex == null ? 999 : a.seatIndex;
    const sb = b.seatIndex == null ? 999 : b.seatIndex;
    return sa - sb;
  });

  sorted.forEach((player) => {
    const li = document.createElement("li");
    li.className = "player-item";
    if (!player.connected) li.classList.add("offline");
    if (player.id === turnPlayerId) li.classList.add("current-turn");

    const tags = [];
    if (player.id === state.myPlayerId) tags.push("我");
    if (player.isOwner) tags.push("房主");
    if (!player.connected) tags.push("离线");

    li.innerHTML = `
      <span>${player.nickname} ${tags.length ? `(${tags.join("/")})` : ""}</span>
      <span>手牌:${player.handCount == null ? "-" : player.handCount} 累计:${player.totalScore}</span>
    `;

    els.playerList.appendChild(li);
  });
}

function renderHand() {
  els.handCards.innerHTML = "";
  if (!state.room || !state.room.game) return;

  const hand = state.room.game.yourHand || [];

  const validIds = new Set(hand.map((c) => c.id));
  [...state.selected].forEach((id) => {
    if (!validIds.has(id)) state.selected.delete(id);
  });

  hand.forEach((card) => {
    const btn = createCardElement(card, {
      selected: state.selected.has(card.id),
      interactive: true,
    });

    btn.addEventListener("click", () => {
      if (state.selected.has(card.id)) {
        state.selected.delete(card.id);
      } else {
        state.selected.add(card.id);
      }
      renderHand();
    });

    els.handCards.appendChild(btn);
  });
}

function renderLastPlay() {
  if (!state.room || !state.room.game || !state.room.game.lastPlay) {
    els.lastPlayBox.classList.add("empty");
    els.lastPlayBox.innerHTML = `
      <div class="last-play-meta">暂无出牌</div>
      <div class="table-cards"></div>
    `;
    return;
  }

  els.lastPlayBox.classList.remove("empty");
  const last = state.room.game.lastPlay;
  const name = getPlayerNameById(last.playerId);
  const typeText = {
    single: "单张",
    pair: "对子",
    bomb: "炸弹",
    straight: "顺子",
    pair_run: "连对",
  }[last.type] || last.type;

  els.lastPlayBox.innerHTML = "";

  const meta = document.createElement("div");
  meta.className = "last-play-meta";
  meta.textContent = `${name} 出了【${typeText}】`;

  const cardsWrap = document.createElement("div");
  cardsWrap.className = "table-cards";
  (last.cards || []).forEach((card) => {
    cardsWrap.appendChild(
      createCardElement(card, {
        compact: true,
      }),
    );
  });

  els.lastPlayBox.appendChild(meta);
  els.lastPlayBox.appendChild(cardsWrap);
}

function renderRoomMeta() {
  els.nicknameText.textContent = state.nickname || "-";

  if (!state.room) {
    els.roomCodeText.textContent = state.roomId || "-";
    els.roomStatusText.textContent = "连接中";
    els.bombCountText.textContent = "0";
    els.deckCountText.textContent = "0";
    els.turnText.textContent = "-";
    return;
  }

  els.roomCodeText.textContent = state.room.roomId;
  els.roomStatusText.textContent = state.room.status;

  if (state.room.game) {
    els.bombCountText.textContent = String(state.room.game.bombCountN);
    els.deckCountText.textContent = String(state.room.game.deckCount);
    els.turnText.textContent = getPlayerNameById(state.room.game.turnPlayerId);
  } else {
    els.bombCountText.textContent = "0";
    els.deckCountText.textContent = "0";
    els.turnText.textContent = "-";
  }
}

function renderButtons() {
  const my = getMyPlayer();
  const room = state.room;

  const isOwner = Boolean(my && my.isOwner);
  const playing = Boolean(room && room.status === "playing" && room.game);
  const settlement = Boolean(room && room.status === "settlement");
  const isMyTurn = Boolean(playing && room.game.turnPlayerId === state.myPlayerId);

  els.startGameBtn.disabled = !(room && isOwner && (room.status === "waiting" || room.status === "ready" || room.status === "settlement") && room.players.length >= 3);
  els.nextRoundBtn.disabled = !(room && isOwner && settlement);

  els.playCardsBtn.disabled = !(playing && isMyTurn);
  els.passBtn.disabled = !(playing && isMyTurn && room.game.lastPlay);
  els.clearSelectionBtn.disabled = !(playing && state.selected.size > 0);
}

function renderAll() {
  renderRoomMeta();
  renderPlayers();
  renderLastPlay();
  renderHand();
  renderButtons();
}

function showSettlement(payload) {
  state.latestSettlement = payload;

  const winnerName = getPlayerNameById(payload.winnerId);
  els.settlementWinnerText.textContent = `赢家: ${winnerName} | 炸弹次数 N = ${payload.bombCountN}`;

  els.settlementList.innerHTML = "";
  payload.scores.forEach((item) => {
    const li = document.createElement("li");
    li.className = "settlement-item";

    const plus = item.delta >= 0 ? "+" : "";
    li.textContent = `${item.nickname} | 余牌:${item.remaining} | 留王:${item.hasJoker ? "是" : "否"} | 留炸弹:${item.hasBomb ? "是" : "否"} | 未出牌:${item.hasNoPlay ? "是" : "否"} | 倍数:x${item.multiplier || 1} | 分数变化:${plus}${item.delta}`;
    els.settlementList.appendChild(li);
  });

  els.settlementModal.classList.remove("hidden");
}

function closeSettlement() {
  els.settlementModal.classList.add("hidden");
}

function joinRoom() {
  if (!state.roomId || !state.nickname) return;
  socket.emit("lobby:join_room", {
    roomId: state.roomId,
    nickname: state.nickname,
  });
}

els.startGameBtn.addEventListener("click", () => {
  if (!state.room) return;
  socket.emit("room:start_game", { roomId: state.room.roomId });
});

els.nextRoundBtn.addEventListener("click", () => {
  if (!state.room) return;
  socket.emit("room:next_round", { roomId: state.room.roomId });
});

els.playCardsBtn.addEventListener("click", () => {
  if (!state.room || !state.room.game) return;

  const hand = state.room.game.yourHand || [];
  const selectedCards = hand.filter((card) => state.selected.has(card.id));
  const play = analyzeSelection(selectedCards);

  if (!play.ok) {
    log(`本地校验失败: ${play.reason}`, { level: "error", category: "action" });
    return;
  }

  if (!canBeatLocal(play, state.room.game.lastPlay)) {
    log("本地校验失败: 无法压过上家", { level: "error", category: "action" });
    return;
  }

  socket.emit("game:play_cards", {
    roomId: state.room.roomId,
    cards: [...state.selected],
  });
});

els.passBtn.addEventListener("click", () => {
  if (!state.room) return;
  socket.emit("game:pass", { roomId: state.room.roomId });
});

els.clearSelectionBtn.addEventListener("click", () => {
  state.selected.clear();
  renderHand();
  renderButtons();
});

els.closeSettlementBtn.addEventListener("click", closeSettlement);
els.settlementModal.addEventListener("click", (event) => {
  if (event.target === els.settlementModal) closeSettlement();
});

socket.on("connect", () => {
  els.connPill.textContent = "已连接";
  log("已连接到服务器，正在进入房间...", { level: "ok", category: "system" });
  joinRoom();
});

socket.on("disconnect", () => {
  els.connPill.textContent = "连接断开";
  log("与服务器断开连接", { level: "error", category: "system" });
});

socket.on("room:state", (payload) => {
  if (payload.roomId !== state.roomId) return;

  state.room = payload;
  state.myPlayerId = payload.selfPlayerId || state.myPlayerId;

  const myPlayer = payload.players.find((p) => p.id === state.myPlayerId);
  if (myPlayer && myPlayer.nickname) {
    state.nickname = myPlayer.nickname;
    localStorage.setItem(STORAGE_KEY_NICKNAME, state.nickname);
  }

  renderAll();
});

socket.on("game:dealt", (payload) => {
  const dealer = getPlayerNameById(payload.dealerId);
  const starter = getPlayerNameById(payload.turnPlayerId);
  log(`发牌完成，庄家: ${dealer || payload.dealerId}，先手: ${starter || payload.turnPlayerId}`, {
    level: "ok",
    category: "game",
  });
});

socket.on("game:played", (payload) => {
  const who = getPlayerNameById(payload.playerId);
  const cards = (payload.cards || []).map(cardLabel).join(" ");
  log(`${who} 出牌: ${cards}`, { level: "info", category: "game" });

  if (payload.playerId === state.myPlayerId) {
    state.selected.clear();
  }
});

socket.on("game:round_end", (payload) => {
  const who = getPlayerNameById(payload.roundWinnerId);
  const drawBy = getPlayerNameById(payload.drawByPlayerId || payload.roundWinnerId);
  const isSelfDraw = payload.drawByPlayerId && payload.drawByPlayerId === state.myPlayerId;

  if (payload.drawTaken) {
    if (isSelfDraw && payload.drawResult) {
      log(`本轮结束: ${who} 取得轮权并摸牌 ${cardLabel(payload.drawResult)}`, {
        level: "ok",
        category: "game",
      });
    } else {
      log(`本轮结束: ${who} 取得轮权，${drawBy} 摸了 1 张牌`, {
        level: "ok",
        category: "game",
      });
    }
    return;
  }

  log(`本轮结束: ${who} 取得轮权（牌堆已空）`, { level: "ok", category: "game" });
});

socket.on("game:auto_pass", (payload) => {
  const who = getPlayerNameById(payload.playerId);
  if (payload.forcedLeadPass) {
    log(`${who} 离线超时，系统托管跳过其首手`, { level: "error", category: "game" });
  } else {
    log(`${who} 离线超时，系统自动过牌`, { level: "error", category: "game" });
  }
});

socket.on("game:settlement", (payload) => {
  showSettlement(payload);
  log("对局结束，进入结算", { level: "ok", category: "settlement" });
  renderAll();
});

socket.on("error", (payload) => {
  if (!payload) return;
  log(payload.message || "发生错误", { level: "error", category: "system" });

  if (payload.message === "房间不存在") {
    setTimeout(() => {
      window.location.href = "/";
    }, 1200);
  }
});

els.logLevelFilter.addEventListener("change", applyLogFilter);
els.logCategoryFilter.addEventListener("change", applyLogFilter);
renderAll();
