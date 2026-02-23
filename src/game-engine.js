const RANKS = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
const SUITS = ["S", "H", "C", "D"];

const RANK_VALUE = {
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

  deck.push({ id: `C${counter++}`, rank: "SJ", suit: null, jokerType: "small" });
  deck.push({ id: `C${counter++}`, rank: "BJ", suit: null, jokerType: "big" });

  return shuffle(deck);
}

function toCardLabel(card) {
  if (card.rank === "SJ") return "小王";
  if (card.rank === "BJ") return "大王";
  return `${card.suit}-${card.rank}`;
}

function isJoker(card) {
  return card.rank === "SJ" || card.rank === "BJ";
}

function getCardValue(card) {
  return RANK_VALUE[card.rank];
}

function sortCards(cards) {
  return [...cards].sort((a, b) => {
    const valueDiff = getCardValue(a) - getCardValue(b);
    if (valueDiff !== 0) return valueDiff;
    return a.id.localeCompare(b.id);
  });
}

function buildCounts(cards) {
  const counts = new Map();
  for (const card of cards) {
    const v = getCardValue(card);
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return counts;
}

function evaluateNOfKind(cards, n) {
  const jokers = cards.filter(isJoker).length;
  const nonJokers = cards.filter((c) => !isJoker(c));

  if (nonJokers.length === 0 && jokers === n) {
    return {
      ok: true,
      strength: 15,
      represent: "2",
    };
  }

  const counts = buildCounts(nonJokers);
  const targetValues = [...counts.keys()].sort((a, b) => b - a);

  for (const target of targetValues) {
    const targetCount = counts.get(target);
    const others = nonJokers.length - targetCount;
    if (others !== 0) continue;
    if (targetCount + jokers === n) {
      return {
        ok: true,
        strength: target,
        represent: target,
      };
    }
  }

  if (nonJokers.length <= n && jokers > 0) {
    const onlyRankValues = [...counts.keys()];
    if (onlyRankValues.length <= 1) {
      const target = onlyRankValues[0] || 15;
      if ((counts.get(target) || 0) + jokers === n) {
        return {
          ok: true,
          strength: target,
          represent: target,
        };
      }
    }
  }

  return { ok: false };
}

function canBuildSequence(nonJokerCounts, jokers, length, unitSize) {
  const maxTail = 14;
  const minHead = 3;
  const maxStart = maxTail - length + 1;
  let bestTail = -1;

  for (let start = minHead; start <= maxStart; start += 1) {
    const required = [];
    for (let i = 0; i < length; i += 1) required.push(start + i);

    let needJokers = 0;
    let extraInvalid = false;

    for (const [value, count] of nonJokerCounts.entries()) {
      if (!required.includes(value)) {
        extraInvalid = true;
        break;
      }
      if (count > unitSize) {
        extraInvalid = true;
        break;
      }
    }

    if (extraInvalid) continue;

    for (const value of required) {
      const existing = nonJokerCounts.get(value) || 0;
      needJokers += unitSize - existing;
    }

    if (needJokers === jokers) {
      const tail = start + length - 1;
      if (tail > bestTail) bestTail = tail;
    }
  }

  if (bestTail >= 0) {
    return {
      ok: true,
      tail: bestTail,
    };
  }

  return { ok: false };
}

function evaluatePlay(cards) {
  if (!cards || cards.length === 0) {
    return { ok: false, reason: "请选择至少一张牌" };
  }

  const sorted = sortCards(cards);
  const length = sorted.length;

  if (length === 1) {
    return {
      ok: true,
      type: "single",
      length,
      strength: getCardValue(sorted[0]),
      cards: sorted,
    };
  }

  const pair = length === 2 ? evaluateNOfKind(sorted, 2) : { ok: false };
  if (pair.ok) {
    return {
      ok: true,
      type: "pair",
      length,
      strength: pair.strength,
      cards: sorted,
    };
  }

  const bomb = length === 3 ? evaluateNOfKind(sorted, 3) : { ok: false };
  if (bomb.ok) {
    return {
      ok: true,
      type: "bomb",
      length,
      strength: bomb.strength,
      cards: sorted,
    };
  }

  const jokers = sorted.filter(isJoker).length;
  const nonJoker = sorted.filter((c) => !isJoker(c));

  if (length >= 3) {
    const counts = buildCounts(nonJoker);
    const straight = canBuildSequence(counts, jokers, length, 1);
    if (straight.ok) {
      return {
        ok: true,
        type: "straight",
        length,
        strength: straight.tail,
        cards: sorted,
      };
    }
  }

  if (length >= 4 && length % 2 === 0) {
    const counts = buildCounts(nonJoker);
    const pairs = canBuildSequence(counts, jokers, length / 2, 2);
    if (pairs.ok) {
      return {
        ok: true,
        type: "pair_run",
        length,
        strength: pairs.tail,
        cards: sorted,
      };
    }
  }

  return {
    ok: false,
    reason: "不合法牌型（仅支持：单张、对子、三张炸弹、顺子、连对）",
  };
}

function canBeat(play, lastPlay) {
  if (!lastPlay) return true;

  if (play.type === "bomb" && lastPlay.type !== "bomb") return true;
  if (play.type !== lastPlay.type) return false;

  if ((play.type === "straight" || play.type === "pair_run") && play.length !== lastPlay.length) {
    return false;
  }

  return play.strength > lastPlay.strength;
}

function findPlayerById(room, playerId) {
  return room.players.find((p) => p.id === playerId) || null;
}

function alivePlayerIds(room) {
  if (!room.game) return [];
  return room.players
    .filter((p) => room.game.hands[p.id] && room.game.hands[p.id].length > 0)
    .map((p) => p.id);
}

function getNextPlayerId(room, currentId) {
  const active = alivePlayerIds(room);
  if (active.length === 0) return null;
  if (active.length === 1) return active[0];

  const seatOrder = room.game.seatOrder;
  let idx = seatOrder.indexOf(currentId);

  for (let i = 1; i <= seatOrder.length; i += 1) {
    const nextId = seatOrder[(idx + i) % seatOrder.length];
    if (active.includes(nextId)) return nextId;
  }

  return null;
}

function detectLeftBomb(cards) {
  const jokers = cards.filter(isJoker).length;
  const counts = buildCounts(cards.filter((c) => !isJoker(c)));

  for (const [, count] of counts.entries()) {
    if (count >= 3) return true;
    if (count + jokers >= 3) return true;
  }

  return false;
}

function buildSettlement(room, winnerId) {
  const bombCountN = room.game.bombCountN;
  const baseFactor = 2 ** bombCountN;
  const details = [];
  let winnerGain = 0;

  for (const player of room.players) {
    const hand = room.game.hands[player.id] || [];
    const remaining = hand.length;
    const hasJoker = hand.some(isJoker);
    const hasBomb = detectLeftBomb(hand);
    const hasNoPlay = (room.game.playedCount[player.id] || 0) === 0;

    let multiplier = 1;
    const doubled = remaining > 0 && (hasJoker || hasBomb);
    const noPlayDoubled = remaining > 0 && hasNoPlay;
    if (doubled) multiplier *= 2;
    if (noPlayDoubled) multiplier *= 2;
    const score = remaining * baseFactor * multiplier;

    details.push({
      playerId: player.id,
      nickname: player.nickname,
      remaining,
      hasJoker,
      hasBomb,
      hasNoPlay,
      doubled,
      noPlayDoubled,
      multiplier,
      delta: 0,
      rawLose: score,
    });
  }

  for (const item of details) {
    if (item.playerId === winnerId) continue;
    item.delta = -item.rawLose;
    winnerGain += item.rawLose;
  }

  const winnerDetail = details.find((d) => d.playerId === winnerId);
  winnerDetail.delta = winnerGain;

  for (const item of details) {
    room.totals[item.playerId] = (room.totals[item.playerId] || 0) + item.delta;
  }

  return {
    winnerId,
    bombCountN,
    scores: details,
    totals: room.players.map((p) => ({
      playerId: p.id,
      nickname: p.nickname,
      total: room.totals[p.id] || 0,
    })),
  };
}

function startGame(room) {
  if (room.players.length < 3 || room.players.length > 5) {
    throw new Error("人数必须为 3-5 人");
  }

  const deck = createDeck();
  const playerIds = room.players.map((p) => p.id);
  const previousSeatOrder = Array.isArray(room.lastSeatOrder) ? room.lastSeatOrder : null;
  const hasSamePlayers = previousSeatOrder
    && previousSeatOrder.length === playerIds.length
    && previousSeatOrder.every((id) => playerIds.includes(id));

  const seatOrder = hasSamePlayers ? [...previousSeatOrder] : shuffle([...playerIds]);

  const dealerId = room.lastWinnerId && seatOrder.includes(room.lastWinnerId)
    ? room.lastWinnerId
    : seatOrder[Math.floor(Math.random() * seatOrder.length)];

  room.players.forEach((player) => {
    player.seatIndex = seatOrder.indexOf(player.id);
  });

  const hands = {};
  const playedCount = {};
  for (const playerId of seatOrder) {
    const count = playerId === dealerId ? 6 : 5;
    hands[playerId] = deck.splice(0, count);
    hands[playerId] = sortCards(hands[playerId]);
    playedCount[playerId] = 0;
  }

  room.game = {
    deck,
    hands,
    playedCount,
    seatOrder,
    dealerId,
    turnPlayerId: dealerId,
    lastPlay: null,
    passChain: [],
    roundWinnerId: null,
    bombCountN: 0,
    actionLogs: [],
  };
  room.lastSeatOrder = [...seatOrder];

  room.status = "playing";

  return {
    turnPlayerId: dealerId,
    seatOrder,
    dealerId,
  };
}

function ensureCardsOwned(hand, cardIds) {
  const handIds = new Set(hand.map((c) => c.id));
  return cardIds.every((id) => handIds.has(id));
}

function removeCardsFromHand(hand, cardIds) {
  const idSet = new Set(cardIds);
  return hand.filter((c) => !idSet.has(c.id));
}

function playCards(room, playerId, cardIds) {
  if (!room.game) {
    return { ok: false, reason: "当前不在对局中" };
  }

  if (room.game.turnPlayerId !== playerId) {
    return { ok: false, reason: "还没轮到你出牌" };
  }

  const hand = room.game.hands[playerId] || [];
  if (!ensureCardsOwned(hand, cardIds)) {
    return { ok: false, reason: "牌不在你的手牌中" };
  }

  const selected = hand.filter((c) => cardIds.includes(c.id));
  const play = evaluatePlay(selected);
  if (!play.ok) {
    return { ok: false, reason: play.reason };
  }

  if (!canBeat(play, room.game.lastPlay)) {
    return { ok: false, reason: "牌型无法压过上家" };
  }

  room.game.hands[playerId] = sortCards(removeCardsFromHand(hand, cardIds));
  room.game.playedCount[playerId] = (room.game.playedCount[playerId] || 0) + 1;
  const playedCards = sortCards(selected);

  if (play.type === "bomb") {
    room.game.bombCountN += 1;
  }

  room.game.lastPlay = {
    playerId,
    type: play.type,
    length: play.length,
    strength: play.strength,
    cards: playedCards,
  };
  room.game.passChain = [];

  const remaining = room.game.hands[playerId].length;
  if (remaining === 0) {
    room.status = "settlement";
    room.lastWinnerId = playerId;
    const settlement = buildSettlement(room, playerId);

    return {
      ok: true,
      played: playedCards,
      nextTurnPlayerId: null,
      settlement,
      gameEnded: true,
    };
  }

  const nextTurnPlayerId = getNextPlayerId(room, playerId);
  room.game.turnPlayerId = nextTurnPlayerId;

  return {
    ok: true,
    played: playedCards,
    nextTurnPlayerId,
    gameEnded: false,
  };
}

function passTurn(room, playerId, options = {}) {
  const force = Boolean(options.force);

  if (!room.game) {
    return { ok: false, reason: "当前不在对局中" };
  }

  if (room.game.turnPlayerId !== playerId) {
    return { ok: false, reason: "还没轮到你操作" };
  }

  if (!room.game.lastPlay) {
    if (!force) {
      return { ok: false, reason: "本轮首手不能过牌" };
    }

    const nextTurnPlayerId = getNextPlayerId(room, playerId);
    room.game.turnPlayerId = nextTurnPlayerId;

    return {
      ok: true,
      roundEnd: false,
      nextTurnPlayerId,
      forcedLeadPass: true,
    };
  }

  if (room.game.lastPlay.playerId === playerId) {
    if (!force) {
      return { ok: false, reason: "你是本轮最大者，不能过牌" };
    }

    room.game.turnPlayerId = playerId;

    return {
      ok: true,
      roundEnd: false,
      nextTurnPlayerId: playerId,
      forcedKeepTurn: true,
    };
  }

  if (!room.game.passChain.includes(playerId)) {
    room.game.passChain.push(playerId);
  }

  const active = alivePlayerIds(room);
  const shouldRoundEnd = room.game.passChain.length >= Math.max(0, active.length - 1);

  if (shouldRoundEnd) {
    const winnerId = room.game.lastPlay.playerId;
    const drawCard = room.game.deck.length > 0 ? room.game.deck.shift() : null;

    if (drawCard) {
      room.game.hands[winnerId].push(drawCard);
      room.game.hands[winnerId] = sortCards(room.game.hands[winnerId]);
    }

    room.game.roundWinnerId = winnerId;
    room.game.turnPlayerId = winnerId;
    room.game.lastPlay = null;
    room.game.passChain = [];

    return {
      ok: true,
      roundEnd: true,
      roundWinnerId: winnerId,
      drawCard,
      nextTurnPlayerId: winnerId,
    };
  }

  const nextTurnPlayerId = getNextPlayerId(room, playerId);
  room.game.turnPlayerId = nextTurnPlayerId;

  return {
    ok: true,
    roundEnd: false,
    nextTurnPlayerId,
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

function publicLastPlay(lastPlay) {
  if (!lastPlay) return null;
  return {
    playerId: lastPlay.playerId,
    type: lastPlay.type,
    length: lastPlay.length,
    strength: lastPlay.strength,
    cards: lastPlay.cards.map(serializeCard),
  };
}

function toRoomState(room, viewerId) {
  const game = room.game;
  const players = room.players.map((p) => ({
    id: p.id,
    nickname: p.nickname,
    seatIndex: p.seatIndex,
    connected: p.connected,
    isOwner: room.ownerPlayerId === p.id,
    handCount: game && game.hands[p.id] ? game.hands[p.id].length : null,
    totalScore: room.totals[p.id] || 0,
  }));

  const view = {
    selfPlayerId: viewerId,
    roomId: room.id,
    roomType: room.gameType || "gandengyan",
    gameType: room.gameType || "gandengyan",
    status: room.status,
    actionSeq: room.actionSeq,
    ownerPlayerId: room.ownerPlayerId,
    players,
    game: game
      ? {
          turnPlayerId: game.turnPlayerId,
          dealerId: game.dealerId,
          seatOrder: [...game.seatOrder],
          bombCountN: game.bombCountN,
          deckCount: game.deck.length,
          passChain: [...game.passChain],
          lastPlay: publicLastPlay(game.lastPlay),
          yourHand: (game.hands[viewerId] || []).map(serializeCard),
        }
      : null,
  };

  return view;
}

module.exports = {
  startGame,
  playCards,
  passTurn,
  toRoomState,
  serializeCard,
};
