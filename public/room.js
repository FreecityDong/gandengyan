const socket = io();

const STORAGE_KEY_NICKNAME = "qiexigua:nickname";
const GAME_TYPES = {
  GANDENGYAN: "gandengyan",
  SEVENS: "sevens",
};

const GAME_META = {
  [GAME_TYPES.GANDENGYAN]: {
    label: "干瞪眼",
    title: "象山干瞪眼",
    tableTitle: "干瞪眼牌桌",
    minPlayers: 3,
  },
  [GAME_TYPES.SEVENS]: {
    label: "接龙",
    title: "象山接龙",
    tableTitle: "接龙牌桌",
    minPlayers: 2,
  },
};

const SUIT_SYMBOL = {
  S: "♠",
  H: "♥",
  C: "♣",
  D: "♦",
};

const SEVENS_NEXT_LOWER = {
  "7": "6",
  "6": "5",
  "5": "4",
  "4": "3",
  "3": "2",
  "2": "A",
};

const SEVENS_NEXT_HIGHER = {
  "7": "8",
  "8": "9",
  "9": "10",
  "10": "J",
  J: "Q",
  Q: "K",
  K: "A",
};

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
  gameTitleText: document.getElementById("gameTitleText"),
  tableTitleText: document.getElementById("tableTitleText"),
  nicknameText: document.getElementById("nicknameText"),
  roomCodeText: document.getElementById("roomCodeText"),
  gameTypeText: document.getElementById("gameTypeText"),
  roomStatusText: document.getElementById("roomStatusText"),
  bombCountLabel: document.getElementById("bombCountLabel"),
  bombCountText: document.getElementById("bombCountText"),
  deckCountLabel: document.getElementById("deckCountLabel"),
  deckCountText: document.getElementById("deckCountText"),
  myDiscardScoreText: document.getElementById("myDiscardScoreText"),
  turnText: document.getElementById("turnText"),
  playerList: document.getElementById("playerList"),
  startGameBtn: document.getElementById("startGameBtn"),
  nextRoundBtn: document.getElementById("nextRoundBtn"),
  lastPlayBox: document.getElementById("lastPlayBox"),
  sevensBoard: document.getElementById("sevensBoard"),
  playCardsBtn: document.getElementById("playCardsBtn"),
  discardBtn: document.getElementById("discardBtn"),
  passBtn: document.getElementById("passBtn"),
  clearSelectionBtn: document.getElementById("clearSelectionBtn"),
  handCards: document.getElementById("handCards"),
  myDiscardPanel: document.getElementById("myDiscardPanel"),
  myDiscardCards: document.getElementById("myDiscardCards"),
  logLevelFilter: document.getElementById("logLevelFilter"),
  logCategoryFilter: document.getElementById("logCategoryFilter"),
  messageBox: document.getElementById("messageBox"),
  settlementModal: document.getElementById("settlementModal"),
  settlementWinnerText: document.getElementById("settlementWinnerText"),
  settlementList: document.getElementById("settlementList"),
  closeSettlementBtn: document.getElementById("closeSettlementBtn"),
};

function currentGameType() {
  const type = String(state.room && (state.room.gameType || state.room.roomType) || "").trim().toLowerCase();
  if (type === GAME_TYPES.SEVENS) return GAME_TYPES.SEVENS;
  if (type === GAME_TYPES.GANDENGYAN) return GAME_TYPES.GANDENGYAN;
  return null;
}

function isSevens() {
  return currentGameType() === GAME_TYPES.SEVENS;
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

function cardLabel(card) {
  if (!card) return "?";
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

function analyzeGdySelection(cards) {
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

function canPlaySevensCard(card) {
  if (!state.room || !state.room.game || !state.room.game.board) return false;
  const suitState = state.room.game.board[card.suit];
  if (!suitState) return false;

  if (!suitState.opened) {
    return card.rank === "7";
  }

  const nextLow = SEVENS_NEXT_LOWER[suitState.lowEndRank] || null;
  const nextHigh = SEVENS_NEXT_HIGHER[suitState.highEndRank] || null;
  return card.rank === nextLow || card.rank === nextHigh;
}

function analyzeSevensSelection(cards) {
  if (cards.length !== 1) {
    return { ok: false, reason: "接龙每次只能选择 1 张牌" };
  }

  const card = cards[0];
  if (!canPlaySevensCard(card)) {
    return { ok: false, reason: "该牌不能接在当前端点" };
  }

  return { ok: true };
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

    const scoreLine = isSevens()
      ? `手牌:${player.handCount == null ? "-" : player.handCount} 本局弃牌分:${player.discardScore || 0} 累计弃牌分:${player.totalScore || 0}`
      : `手牌:${player.handCount == null ? "-" : player.handCount} 累计:${player.totalScore}`;

    li.innerHTML = `
      <span>${player.nickname} ${tags.length ? `(${tags.join("/")})` : ""}</span>
      <span>${scoreLine}</span>
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

  if (isSevens() && state.selected.size > 1) {
    const first = [...state.selected][0];
    state.selected = new Set(first ? [first] : []);
  }

  hand.forEach((card) => {
    const btn = createCardElement(card, {
      selected: state.selected.has(card.id),
      interactive: true,
    });

    btn.addEventListener("click", () => {
      if (isSevens()) {
        if (state.selected.has(card.id)) {
          state.selected.clear();
        } else {
          state.selected.clear();
          state.selected.add(card.id);
        }
      } else if (state.selected.has(card.id)) {
        state.selected.delete(card.id);
      } else {
        state.selected.add(card.id);
      }
      renderHand();
      renderButtons();
    });

    els.handCards.appendChild(btn);
  });
}

function renderGdyLastPlay() {
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
    cardsWrap.appendChild(createCardElement(card, { compact: true }));
  });

  els.lastPlayBox.appendChild(meta);
  els.lastPlayBox.appendChild(cardsWrap);
}

function getSevensShownRanks(suitState) {
  if (!suitState || !suitState.opened) return [];
  const lowPath = [];
  let lowCursor = "7";
  lowPath.push(lowCursor);
  while (lowCursor !== suitState.lowEndRank) {
    lowCursor = SEVENS_NEXT_LOWER[lowCursor];
    if (!lowCursor) break;
    lowPath.push(lowCursor);
  }

  const highPath = [];
  let highCursor = "7";
  highPath.push(highCursor);
  while (highCursor !== suitState.highEndRank) {
    highCursor = SEVENS_NEXT_HIGHER[highCursor];
    if (!highCursor) break;
    highPath.push(highCursor);
  }

  return [...lowPath.reverse(), ...highPath.slice(1)];
}

function renderSevensLastAction() {
  if (!state.room || !state.room.game) {
    els.lastPlayBox.classList.add("empty");
    els.lastPlayBox.innerHTML = `
      <div class="last-play-meta">等待开局</div>
      <div class="table-cards"></div>
    `;
    return;
  }

  const lastAction = state.room.game.lastAction;
  if (!lastAction) {
    els.lastPlayBox.classList.add("empty");
    els.lastPlayBox.innerHTML = `
      <div class="last-play-meta">暂无动作（优先出 7 开列）</div>
      <div class="table-cards"></div>
    `;
    return;
  }

  els.lastPlayBox.classList.remove("empty");
  els.lastPlayBox.innerHTML = "";

  const who = getPlayerNameById(lastAction.playerId);
  const actionText = lastAction.actionType === "discard" ? "弃牌" : "出牌";
  const meta = document.createElement("div");
  meta.className = "last-play-meta";
  if (lastAction.actionType === "discard" && lastAction.cardHidden) {
    meta.textContent = `${who} ${actionText}（具体牌仅本人可见）`;
  } else {
    meta.textContent = `${who} ${actionText}`;
  }

  const cardsWrap = document.createElement("div");
  cardsWrap.className = "table-cards";
  if (lastAction.card) {
    cardsWrap.appendChild(createCardElement(lastAction.card, { compact: true }));
  } else {
    const hidden = document.createElement("div");
    hidden.className = "last-play-meta";
    hidden.textContent = "弃牌已发生";
    cardsWrap.appendChild(hidden);
  }

  els.lastPlayBox.appendChild(meta);
  els.lastPlayBox.appendChild(cardsWrap);
}

function renderSevensBoard() {
  if (!isSevens() || !state.room || !state.room.game) {
    els.sevensBoard.classList.add("hidden");
    els.sevensBoard.innerHTML = "";
    return;
  }

  const board = state.room.game.board || {};
  const suits = ["S", "H", "C", "D"];

  els.sevensBoard.classList.remove("hidden");
  els.sevensBoard.innerHTML = "";

  suits.forEach((suit) => {
    const suitState = board[suit] || { opened: false, lowEndRank: null, highEndRank: null };
    const col = document.createElement("div");
    col.className = "sevens-suit-col";

    const title = document.createElement("div");
    title.className = "sevens-suit-title";
    title.textContent = `${SUIT_SYMBOL[suit] || suit} ${suitState.opened ? "已开启" : "未开启"}`;

    const cardsWrap = document.createElement("div");
    cardsWrap.className = "table-cards card-stack compact-stack";

    if (!suitState.opened) {
      const hint = document.createElement("div");
      hint.className = "last-play-meta";
      hint.textContent = "需先出 7";
      cardsWrap.appendChild(hint);
    } else {
      const ranks = getSevensShownRanks(suitState);
      ranks.forEach((rank) => {
        cardsWrap.appendChild(
          createCardElement(
            {
              id: `${suit}-${rank}`,
              suit,
              rank,
            },
            { compact: true },
          ),
        );
      });
    }

    const meta = document.createElement("div");
    meta.className = "sevens-suit-meta";
    if (!suitState.opened) {
      meta.textContent = "端点: - / -";
    } else {
      const low = suitState.lowEndRank || "-";
      const high = suitState.highEndRank || "-";
      const nextLow = suitState.nextLowRank || "封口";
      const nextHigh = suitState.nextHighRank || "封口";
      meta.textContent = `端点: ${low} / ${high} | 下一张: ${nextLow} / ${nextHigh}`;
    }

    col.appendChild(title);
    col.appendChild(cardsWrap);
    col.appendChild(meta);
    els.sevensBoard.appendChild(col);
  });
}

function renderLastPlay() {
  if (isSevens()) {
    renderSevensLastAction();
    return;
  }
  renderGdyLastPlay();
}

function renderMyDiscardArea() {
  if (!isSevens() || !state.room || !state.room.game) {
    els.myDiscardPanel.classList.add("hidden");
    els.myDiscardCards.innerHTML = "";
    return;
  }

  const pile = state.room.game.yourDiscardPile || [];
  els.myDiscardPanel.classList.remove("hidden");
  els.myDiscardCards.innerHTML = "";
  els.myDiscardCards.className = "discard-cards card-stack compact-stack";

  if (pile.length === 0) {
    const empty = document.createElement("div");
    empty.className = "last-play-meta";
    empty.textContent = "暂无弃牌";
    els.myDiscardCards.appendChild(empty);
    return;
  }

  pile.forEach((card) => {
    els.myDiscardCards.appendChild(createCardElement(card, { compact: true }));
  });
}

function renderRoomMeta() {
  const gameType = currentGameType();
  const meta = gameType
    ? (GAME_META[gameType] || GAME_META[GAME_TYPES.GANDENGYAN])
    : {
      label: "-",
      title: "象山牌桌",
      tableTitle: "牌桌",
      minPlayers: 2,
    };

  els.nicknameText.textContent = state.nickname || "-";
  els.gameTitleText.textContent = meta.title;
  els.tableTitleText.textContent = meta.tableTitle;
  els.gameTypeText.textContent = meta.label;

  if (!state.room) {
    els.roomCodeText.textContent = state.roomId || "-";
    els.roomStatusText.textContent = "连接中";
    els.bombCountLabel.textContent = gameType === GAME_TYPES.SEVENS ? "已开列数" : "炸弹次数 N";
    els.bombCountText.textContent = "0";
    els.deckCountLabel.textContent = gameType === GAME_TYPES.SEVENS ? "可出牌" : "牌堆";
    els.deckCountText.textContent = "0";
    els.myDiscardScoreText.textContent = "0";
    els.turnText.textContent = "-";
    return;
  }

  els.roomCodeText.textContent = state.room.roomId;
  els.roomStatusText.textContent = state.room.status;

  if (state.room.game) {
    if (gameType === GAME_TYPES.SEVENS) {
      const board = state.room.game.board || {};
      const opened = Object.values(board).filter((it) => it && it.opened).length;
      const legalCount = Array.isArray(state.room.game.legalPlayCardIds)
        ? state.room.game.legalPlayCardIds.length
        : 0;
      els.bombCountLabel.textContent = "已开列数";
      els.bombCountText.textContent = String(opened);
      els.deckCountLabel.textContent = "可出牌";
      els.deckCountText.textContent = String(legalCount);
      els.myDiscardScoreText.textContent = String(state.room.game.yourDiscardScore || 0);
    } else {
      els.bombCountLabel.textContent = "炸弹次数 N";
      els.bombCountText.textContent = String(state.room.game.bombCountN);
      els.deckCountLabel.textContent = "牌堆";
      els.deckCountText.textContent = String(state.room.game.deckCount);
      els.myDiscardScoreText.textContent = "0";
    }

    els.turnText.textContent = getPlayerNameById(state.room.game.turnPlayerId);
  } else {
    els.bombCountLabel.textContent = gameType === GAME_TYPES.SEVENS ? "已开列数" : "炸弹次数 N";
    els.bombCountText.textContent = "0";
    els.deckCountLabel.textContent = gameType === GAME_TYPES.SEVENS ? "可出牌" : "牌堆";
    els.deckCountText.textContent = "0";
    els.myDiscardScoreText.textContent = "0";
    els.turnText.textContent = "-";
  }
}

function renderButtons() {
  const my = getMyPlayer();
  const room = state.room;
  const gameType = currentGameType() || GAME_TYPES.GANDENGYAN;
  const meta = GAME_META[gameType] || GAME_META[GAME_TYPES.GANDENGYAN];

  const isOwner = Boolean(my && my.isOwner);
  const playing = Boolean(room && room.status === "playing" && room.game);
  const settlement = Boolean(room && room.status === "settlement");
  const isMyTurn = Boolean(playing && room.game.turnPlayerId === state.myPlayerId);

  els.startGameBtn.disabled = !(
    room
    && isOwner
    && (room.status === "waiting" || room.status === "ready" || room.status === "settlement")
    && room.players.length >= meta.minPlayers
  );
  els.nextRoundBtn.disabled = !(room && isOwner && settlement);

  if (gameType === GAME_TYPES.SEVENS) {
    const mustDiscard = Boolean(playing && room.game.mustDiscard);
    els.playCardsBtn.textContent = "出牌";
    els.discardBtn.classList.remove("hidden");
    els.passBtn.classList.add("hidden");

    els.playCardsBtn.disabled = !(playing && isMyTurn && state.selected.size === 1 && !mustDiscard);
    els.discardBtn.disabled = !(playing && isMyTurn && state.selected.size === 1 && mustDiscard);
    els.passBtn.disabled = true;
    els.clearSelectionBtn.disabled = !(playing && state.selected.size > 0);
  } else {
    els.playCardsBtn.textContent = "出牌";
    els.discardBtn.classList.add("hidden");
    els.passBtn.classList.remove("hidden");

    els.playCardsBtn.disabled = !(playing && isMyTurn && state.selected.size > 0);
    els.discardBtn.disabled = true;
    els.passBtn.disabled = !(playing && isMyTurn && room.game.lastPlay);
    els.clearSelectionBtn.disabled = !(playing && state.selected.size > 0);
  }
}

function renderAll() {
  renderRoomMeta();
  renderPlayers();
  renderLastPlay();
  renderSevensBoard();
  renderHand();
  renderMyDiscardArea();
  renderButtons();
}

function showSettlement(payload) {
  state.latestSettlement = payload;
  const gameType = currentGameType();

  els.settlementList.innerHTML = "";

  if (gameType === GAME_TYPES.SEVENS) {
    const winners = Array.isArray(payload.winners) ? payload.winners : [];
    const winnerNames = winners.length > 0
      ? winners.map((id) => getPlayerNameById(id)).join(" / ")
      : "-";
    const winningScore = Number.isFinite(payload.winningScore) ? payload.winningScore : "-";

    els.settlementWinnerText.textContent = `最低弃牌分: ${winningScore} | 赢家: ${winnerNames}`;

    (payload.scores || []).forEach((item) => {
      const li = document.createElement("li");
      li.className = "settlement-item";

      li.textContent = `${item.nickname} | 弃牌:${item.discardCount} 张 | 弃牌分:${item.discardTotal} | 名次:${item.rank} | 累计弃牌分 +${item.delta}`;
      els.settlementList.appendChild(li);
    });
  } else {
    const winnerName = getPlayerNameById(payload.winnerId);
    els.settlementWinnerText.textContent = `赢家: ${winnerName} | 炸弹次数 N = ${payload.bombCountN}`;

    (payload.scores || []).forEach((item) => {
      const li = document.createElement("li");
      li.className = "settlement-item";

      const plus = item.delta >= 0 ? "+" : "";
      li.textContent = `${item.nickname} | 余牌:${item.remaining} | 留王:${item.hasJoker ? "是" : "否"} | 留炸弹:${item.hasBomb ? "是" : "否"} | 未出牌:${item.hasNoPlay ? "是" : "否"} | 倍数:x${item.multiplier || 1} | 分数变化:${plus}${item.delta}`;
      els.settlementList.appendChild(li);
    });
  }

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

  if (isSevens()) {
    if (state.room.game.mustDiscard) {
      log("当前无合法可出牌，请使用“弃牌”", { level: "error", category: "action" });
      return;
    }

    const play = analyzeSevensSelection(selectedCards);
    if (!play.ok) {
      log(`本地校验失败: ${play.reason}`, { level: "error", category: "action" });
      return;
    }

    socket.emit("game:play_cards", {
      roomId: state.room.roomId,
      cards: [...state.selected],
    });
    return;
  }

  const play = analyzeGdySelection(selectedCards);
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

els.discardBtn.addEventListener("click", () => {
  if (!state.room || !state.room.game || !isSevens()) return;

  const picked = [...state.selected];
  if (picked.length !== 1) {
    log("弃牌需选择 1 张手牌", { level: "error", category: "action" });
    return;
  }

  socket.emit("game:discard_card", {
    roomId: state.room.roomId,
    card: picked[0],
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
  const gameType = currentGameType();
  const starter = getPlayerNameById(payload.turnPlayerId);

  if (gameType === GAME_TYPES.SEVENS) {
    log(`发牌完成，先手: ${starter || payload.turnPlayerId}`, {
      level: "ok",
      category: "game",
    });
    return;
  }

  const dealer = getPlayerNameById(payload.dealerId);
  log(`发牌完成，庄家: ${dealer || payload.dealerId}，先手: ${starter || payload.turnPlayerId}`, {
    level: "ok",
    category: "game",
  });
});

socket.on("game:played", (payload) => {
  const who = getPlayerNameById(payload.playerId);
  const cards = (payload.cards || []).map(cardLabel).join(" ");

  if (isSevens()) {
    log(`${who} 出牌: ${cards}`, { level: "info", category: "game" });
  } else {
    log(`${who} 出牌: ${cards}`, { level: "info", category: "game" });
  }

  if (payload.playerId === state.myPlayerId) {
    state.selected.clear();
  }
  renderButtons();
});

socket.on("game:discarded", (payload) => {
  const who = getPlayerNameById(payload.playerId);
  if (payload.revealed && payload.card) {
    log(`${who} 弃牌: ${cardLabel(payload.card)}`, { level: "info", category: "game" });
  } else {
    log(`${who} 弃牌（具体牌仅本人可见）`, { level: "info", category: "game" });
  }

  if (payload.playerId === state.myPlayerId) {
    state.selected.clear();
  }
  renderButtons();
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

socket.on("game:auto_action", (payload) => {
  const who = getPlayerNameById(payload.playerId);
  if (payload.actionType === "discard") {
    if (payload.revealed && payload.card) {
      log(`${who} 离线超时，系统托管弃牌 ${cardLabel(payload.card)}`, { level: "error", category: "game" });
    } else {
      log(`${who} 离线超时，系统托管弃牌（具体牌仅本人可见）`, { level: "error", category: "game" });
    }
    return;
  }

  const cards = (payload.cards || []).map(cardLabel).join(" ");
  log(`${who} 离线超时，系统托管出牌 ${cards}`, { level: "error", category: "game" });
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
