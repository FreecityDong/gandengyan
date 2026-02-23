const SUITS = ["S", "H", "C", "D"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

const RANK_VALUE = {
  A: 1,
  "2": 2,
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
};

const SUIT_ORDER = {
  S: 0,
  H: 1,
  C: 2,
  D: 3,
};

const NEXT_LOWER = {
  "7": "6",
  "6": "5",
  "5": "4",
  "4": "3",
  "3": "2",
  "2": "A",
};

const NEXT_HIGHER = {
  "7": "8",
  "8": "9",
  "9": "10",
  "10": "J",
  J: "Q",
  Q: "K",
  K: "A",
};

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createDeck() {
  const deck = [];
  let counter = 0;

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: `C${counter++}`,
        rank,
        suit,
        jokerType: null,
      });
    }
  }

  return shuffle(deck);
}

function getCardValue(card) {
  return RANK_VALUE[card.rank] || 0;
}

function toCardLabel(card) {
  return `${card.suit}-${card.rank}`;
}

function sortCards(cards) {
  return [...cards].sort((a, b) => {
    const suitDiff = (SUIT_ORDER[a.suit] || 0) - (SUIT_ORDER[b.suit] || 0);
    if (suitDiff !== 0) return suitDiff;

    const valueDiff = getCardValue(a) - getCardValue(b);
    if (valueDiff !== 0) return valueDiff;

    return a.id.localeCompare(b.id);
  });
}

function createBoard() {
  const board = {};
  for (const suit of SUITS) {
    board[suit] = {
      opened: false,
      lowEndRank: null,
      highEndRank: null,
    };
  }
  return board;
}

function cloneBoardState(state) {
  return {
    opened: Boolean(state.opened),
    lowEndRank: state.lowEndRank,
    highEndRank: state.highEndRank,
  };
}

function getLegalPlayCardIds(room, playerId) {
  if (!room.game) return [];
  const hand = room.game.hands[playerId] || [];
  return hand
    .filter((card) => isLegalPlay(room.game.board, card))
    .map((card) => card.id);
}

function isLegalPlay(board, card) {
  if (!card || !card.suit || !card.rank) return false;

  const suitState = board[card.suit];
  if (!suitState) return false;

  if (!suitState.opened) {
    return card.rank === "7";
  }

  const nextLow = NEXT_LOWER[suitState.lowEndRank] || null;
  const nextHigh = NEXT_HIGHER[suitState.highEndRank] || null;

  return card.rank === nextLow || card.rank === nextHigh;
}

function applyPlayToBoard(board, card) {
  const suitState = board[card.suit];

  if (!suitState.opened) {
    if (card.rank !== "7") {
      return { ok: false, reason: "该花色尚未开启，只能先出 7" };
    }

    suitState.opened = true;
    suitState.lowEndRank = "7";
    suitState.highEndRank = "7";

    return { ok: true, side: "center" };
  }

  const nextLow = NEXT_LOWER[suitState.lowEndRank] || null;
  if (card.rank === nextLow) {
    suitState.lowEndRank = card.rank;
    return { ok: true, side: "low" };
  }

  const nextHigh = NEXT_HIGHER[suitState.highEndRank] || null;
  if (card.rank === nextHigh) {
    suitState.highEndRank = card.rank;
    return { ok: true, side: "high" };
  }

  return { ok: false, reason: "该牌不能接在当前端点" };
}

function ensureCardsOwned(hand, cardIds) {
  const handIds = new Set(hand.map((c) => c.id));
  return cardIds.every((id) => handIds.has(id));
}

function removeCardsFromHand(hand, cardIds) {
  const idSet = new Set(cardIds);
  return hand.filter((card) => !idSet.has(card.id));
}

function getActivePlayerIds(room) {
  if (!room.game) return [];
  return room.players
    .filter((player) => (room.game.hands[player.id] || []).length > 0)
    .map((player) => player.id);
}

function getNextPlayerId(room, currentId) {
  if (!room.game) return null;

  const active = getActivePlayerIds(room);
  if (active.length === 0) return null;
  if (active.length === 1) return active[0];

  const seatOrder = room.game.seatOrder;
  const idx = seatOrder.indexOf(currentId);

  for (let i = 1; i <= seatOrder.length; i += 1) {
    const nextId = seatOrder[(idx + i + seatOrder.length) % seatOrder.length];
    if (active.includes(nextId)) return nextId;
  }

  return null;
}

function scoreCards(cards) {
  return (cards || []).reduce((sum, card) => sum + getCardValue(card), 0);
}

function buildSettlement(room) {
  const details = room.players.map((player) => {
    const discardPile = room.game.discardPiles[player.id] || [];
    const discardTotal = scoreCards(discardPile);

    return {
      playerId: player.id,
      nickname: player.nickname,
      discardCount: discardPile.length,
      discardTotal,
      delta: discardTotal,
    };
  });

  const winningScore = details.reduce((min, item) => Math.min(min, item.discardTotal), Infinity);
  const winners = details
    .filter((item) => item.discardTotal === winningScore)
    .map((item) => item.playerId);

  const sortedTotals = [...details].sort((a, b) => a.discardTotal - b.discardTotal);
  let rank = 0;
  let previousScore = null;
  sortedTotals.forEach((item, idx) => {
    if (previousScore !== item.discardTotal) {
      rank = idx + 1;
      previousScore = item.discardTotal;
    }
    item.rank = rank;
  });

  for (const item of details) {
    const ranked = sortedTotals.find((it) => it.playerId === item.playerId);
    item.rank = ranked ? ranked.rank : null;
    item.isWinner = winners.includes(item.playerId);
    room.totals[item.playerId] = (room.totals[item.playerId] || 0) + item.delta;
  }

  return {
    winnerId: winners.length === 1 ? winners[0] : null,
    winners,
    winningScore,
    scores: details,
    totals: room.players.map((player) => ({
      playerId: player.id,
      nickname: player.nickname,
      total: room.totals[player.id] || 0,
    })),
  };
}

function finalizeIfGameEnded(room) {
  const active = getActivePlayerIds(room);
  if (active.length > 0) return null;

  room.status = "settlement";
  room.lastWinnerId = null;
  return buildSettlement(room);
}

function startGame(room) {
  if (room.players.length < 2 || room.players.length > 6) {
    throw new Error("人数必须为 2-6 人");
  }

  const deck = createDeck();
  const playerIds = room.players.map((player) => player.id);
  const previousSeatOrder = Array.isArray(room.lastSeatOrder) ? room.lastSeatOrder : null;
  const hasSamePlayers = previousSeatOrder
    && previousSeatOrder.length === playerIds.length
    && previousSeatOrder.every((id) => playerIds.includes(id));

  const seatOrder = hasSamePlayers ? [...previousSeatOrder] : shuffle([...playerIds]);

  room.players.forEach((player) => {
    player.seatIndex = seatOrder.indexOf(player.id);
  });

  const hands = {};
  const discardPiles = {};
  for (const playerId of seatOrder) {
    hands[playerId] = [];
    discardPiles[playerId] = [];
  }

  let cursor = 0;
  while (deck.length > 0) {
    const playerId = seatOrder[cursor % seatOrder.length];
    hands[playerId].push(deck.shift());
    cursor += 1;
  }

  for (const playerId of seatOrder) {
    hands[playerId] = sortCards(hands[playerId]);
  }

  let starter = null;
  for (const playerId of seatOrder) {
    if ((hands[playerId] || []).some((card) => card.suit === "S" && card.rank === "7")) {
      starter = playerId;
      break;
    }
  }

  if (!starter) {
    starter = seatOrder[Math.floor(Math.random() * seatOrder.length)];
  }

  room.game = {
    hands,
    discardPiles,
    board: createBoard(),
    seatOrder,
    turnPlayerId: starter,
    lastAction: null,
    actionLogs: [],
  };
  room.lastSeatOrder = [...seatOrder];
  room.status = "playing";

  return {
    turnPlayerId: starter,
    seatOrder,
    dealerId: null,
  };
}

function playCards(room, playerId, cardIds) {
  if (!room.game) {
    return { ok: false, reason: "当前不在对局中" };
  }

  if (room.game.turnPlayerId !== playerId) {
    return { ok: false, reason: "还没轮到你出牌" };
  }

  const ids = Array.isArray(cardIds) ? cardIds.map((id) => String(id)) : [];
  if (ids.length !== 1) {
    return { ok: false, reason: "接龙每次只能出 1 张牌" };
  }

  const hand = room.game.hands[playerId] || [];
  if (!ensureCardsOwned(hand, ids)) {
    return { ok: false, reason: "牌不在你的手牌中" };
  }

  const legalIds = getLegalPlayCardIds(room, playerId);
  if (legalIds.length <= 0) {
    return { ok: false, reason: "当前无合法可出牌，请弃 1 张牌" };
  }

  if (!legalIds.includes(ids[0])) {
    return { ok: false, reason: "该牌不满足接龙端点规则" };
  }

  const card = hand.find((it) => it.id === ids[0]);
  const nextBoard = {};
  for (const suit of SUITS) {
    nextBoard[suit] = cloneBoardState(room.game.board[suit]);
  }

  const applyResult = applyPlayToBoard(nextBoard, card);
  if (!applyResult.ok) {
    return { ok: false, reason: applyResult.reason || "出牌失败" };
  }

  room.game.board = nextBoard;
  room.game.hands[playerId] = sortCards(removeCardsFromHand(hand, ids));

  const settlement = finalizeIfGameEnded(room);
  if (settlement) {
    room.game.lastAction = {
      actionType: "play",
      playerId,
      card,
      nextTurnPlayerId: null,
      side: applyResult.side,
    };

    return {
      ok: true,
      actionType: "play",
      played: [card],
      nextTurnPlayerId: null,
      gameEnded: true,
      settlement,
      side: applyResult.side,
    };
  }

  const nextTurnPlayerId = getNextPlayerId(room, playerId);
  room.game.turnPlayerId = nextTurnPlayerId;
  room.game.lastAction = {
    actionType: "play",
    playerId,
    card,
    nextTurnPlayerId,
    side: applyResult.side,
  };

  return {
    ok: true,
    actionType: "play",
    played: [card],
    nextTurnPlayerId,
    gameEnded: false,
    side: applyResult.side,
  };
}

function discardCard(room, playerId, cardId) {
  if (!room.game) {
    return { ok: false, reason: "当前不在对局中" };
  }

  if (room.game.turnPlayerId !== playerId) {
    return { ok: false, reason: "还没轮到你操作" };
  }

  const pickedId = String(cardId || "").trim();
  if (!pickedId) {
    return { ok: false, reason: "请先选择 1 张弃牌" };
  }

  const hand = room.game.hands[playerId] || [];
  if (!ensureCardsOwned(hand, [pickedId])) {
    return { ok: false, reason: "牌不在你的手牌中" };
  }

  const legalIds = getLegalPlayCardIds(room, playerId);
  if (legalIds.length > 0) {
    return { ok: false, reason: "当前有合法可出牌，不允许弃牌" };
  }

  const discarded = hand.find((card) => card.id === pickedId);
  room.game.hands[playerId] = sortCards(removeCardsFromHand(hand, [pickedId]));
  room.game.discardPiles[playerId].push(discarded);

  const settlement = finalizeIfGameEnded(room);
  if (settlement) {
    room.game.lastAction = {
      actionType: "discard",
      playerId,
      card: discarded,
      nextTurnPlayerId: null,
    };

    return {
      ok: true,
      actionType: "discard",
      discarded,
      nextTurnPlayerId: null,
      gameEnded: true,
      settlement,
    };
  }

  const nextTurnPlayerId = getNextPlayerId(room, playerId);
  room.game.turnPlayerId = nextTurnPlayerId;
  room.game.lastAction = {
    actionType: "discard",
    playerId,
    card: discarded,
    nextTurnPlayerId,
  };

  return {
    ok: true,
    actionType: "discard",
    discarded,
    nextTurnPlayerId,
    gameEnded: false,
  };
}

function autoAct(room, playerId) {
  if (!room.game) {
    return { ok: false, reason: "当前不在对局中" };
  }

  if (room.game.turnPlayerId !== playerId) {
    return { ok: false, reason: "当前不是该玩家回合" };
  }

  const hand = room.game.hands[playerId] || [];
  if (hand.length <= 0) {
    return { ok: false, reason: "玩家已无手牌" };
  }

  const legalIds = getLegalPlayCardIds(room, playerId);
  if (legalIds.length > 0) {
    const chosen = legalIds[0];
    const result = playCards(room, playerId, [chosen]);
    if (!result.ok) return result;

    return {
      ...result,
      auto: true,
    };
  }

  const chosenDiscard = hand[0];
  const result = discardCard(room, playerId, chosenDiscard.id);
  if (!result.ok) return result;

  return {
    ...result,
    auto: true,
  };
}

function passTurn() {
  return {
    ok: false,
    reason: "接龙不支持过牌，请出牌或弃 1 张牌",
  };
}

function serializeCard(card) {
  return {
    id: card.id,
    rank: card.rank,
    suit: card.suit,
    label: toCardLabel(card),
    value: getCardValue(card),
  };
}

function serializeBoard(board) {
  const out = {};

  for (const suit of SUITS) {
    const state = board[suit];
    out[suit] = {
      opened: Boolean(state.opened),
      lowEndRank: state.lowEndRank,
      highEndRank: state.highEndRank,
      nextLowRank: state.opened ? NEXT_LOWER[state.lowEndRank] || null : null,
      nextHighRank: state.opened ? NEXT_HIGHER[state.highEndRank] || null : null,
    };
  }

  return out;
}

function toRoomState(room, viewerId) {
  const game = room.game;
  const players = room.players.map((player) => {
    const discardPile = game ? (game.discardPiles[player.id] || []) : [];

    return {
      id: player.id,
      nickname: player.nickname,
      seatIndex: player.seatIndex,
      connected: player.connected,
      isOwner: room.ownerPlayerId === player.id,
      handCount: game && game.hands[player.id] ? game.hands[player.id].length : null,
      discardCount: discardPile.length,
      discardScore: scoreCards(discardPile),
      totalScore: room.totals[player.id] || 0,
    };
  });

  const legalPlayCardIds = game ? getLegalPlayCardIds(room, viewerId) : [];
  const yourDiscardPile = game ? game.discardPiles[viewerId] || [] : [];

  return {
    selfPlayerId: viewerId,
    roomId: room.id,
    roomType: room.gameType || "sevens",
    gameType: room.gameType || "sevens",
    status: room.status,
    actionSeq: room.actionSeq,
    ownerPlayerId: room.ownerPlayerId,
    players,
    game: game
      ? {
          turnPlayerId: game.turnPlayerId,
          dealerId: null,
          seatOrder: [...game.seatOrder],
          board: serializeBoard(game.board),
          lastAction: game.lastAction
            ? {
                actionType: game.lastAction.actionType,
                playerId: game.lastAction.playerId,
                card: game.lastAction.card
                  && (
                    game.lastAction.actionType !== "discard"
                    || game.lastAction.playerId === viewerId
                  )
                  ? serializeCard(game.lastAction.card)
                  : null,
                cardHidden: game.lastAction.actionType === "discard"
                  && game.lastAction.playerId !== viewerId,
                side: game.lastAction.side || null,
                nextTurnPlayerId: game.lastAction.nextTurnPlayerId,
              }
            : null,
          yourHand: (game.hands[viewerId] || []).map(serializeCard),
          yourDiscardPile: yourDiscardPile.map(serializeCard),
          yourDiscardScore: scoreCards(yourDiscardPile),
          legalPlayCardIds,
          mustDiscard: game.turnPlayerId === viewerId
            && (game.hands[viewerId] || []).length > 0
            && legalPlayCardIds.length <= 0,
        }
      : null,
  };
}

module.exports = {
  startGame,
  playCards,
  discardCard,
  autoAct,
  passTurn,
  toRoomState,
  serializeCard,
};
