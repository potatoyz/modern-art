import { CARDS, CATEGORIES, DEALS, cardById } from './catalog.js';

import { roomSettings } from './settings.js';
export { OPEN_SECONDS } from './settings.js';
const openDeadline = (s, now) => {
  const settings = roomSettings(s.settings);
  return settings.timeoutEnabled ? now + settings.timeoutSeconds * 1000 : null;
};
const requireRule = (ok, message) => { if (!ok) throw new Error(message); };
const nextSeat = (s, seat) => (seat + 1) % s.players.length;
const orderFrom = (s, seat) => Array.from({ length: s.players.length }, (_, i) => (seat + i + 1) % s.players.length);
const say = (s, text) => { s.log.push({ id: ++s.eventId, text, timestamp: Date.now() }); s.log = s.log.slice(-35); };
const hasCards = s => s.players.some(p => p.hand.length);
const owns = (s, seat, id) => s.players[seat]?.hand.includes(id);
const amount = (s, seat, value, zero = false) => {
  requireRule(Number.isSafeInteger(value) && value >= (zero ? 0 : 1), zero ? '金额必须为非负整数。' : '最低出价为 1。');
  requireRule(value <= s.players[seat].cash, '你的现金不足。');
};
const take = (s, seat, id) => {
  requireRule(owns(s, seat, id), '这张画不在你的手牌中。');
  s.players[seat].hand.splice(s.players[seat].hand.indexOf(id), 1);
  s.counts[cardById(id).category]++;
};

export function createGame(players, deck = CARDS.map(c => c.id), settings) {
  requireRule(players.length >= 1 && players.length <= 5, '需要 1–5 个席位。');
  requireRule(deck.length === 70 && new Set(deck).size === 70 && deck.every(cardById), '牌库必须包含全部 70 张不同的画。');
  return {
    settings: roomSettings(settings),
    phase: 'lobby', round: 0, turn: 0, nextStarter: 0, revision: 0, eventId: 0,
    players: players.map(p => ({ id: p.id, name: p.name, bot: !!p.bot, ...(p.bot&&Number.isFinite(p.botTemperature)?{botTemperature:p.botTemperature}:{}), cash: 100, hand: [], collection: [] })),
    deck: [...deck], counts: [0,0,0,0,0], history: [], auction: null, settlement: null, log: [], lastLot: null,
  };
}
function deal(s) {
  const count = DEALS[s.players.length][s.round - 1];
  for (let i = 0; i < count; i++) for (const p of s.players) {
    if (s.deck.length) p.hand.push(s.deck.pop());
  }
}
function seekTurn(s, seat) {
  for (let i = 0; i < s.players.length; i++) {
    const candidate = (seat + i) % s.players.length;
    if (s.players[candidate].hand.length) { s.turn = candidate; s.phase = 'choose'; return; }
  }
  settleRound(s, seat);
}
function settleRound(s, triggerSeat) {
  const ranking = CATEGORIES.map(c => c.id).filter(i => s.counts[i] > 0).sort((a,b) => s.counts[b] - s.counts[a] || a - b).slice(0,3);
  const awards = [0,0,0,0,0];
  ranking.forEach((id, place) => { awards[id] = 30 - place * 10; });
  const values = awards.map((award, i) => award ? award + s.history.reduce((sum, h) => sum + h[i], 0) : 0);
  const sales = s.players.map(p => {
    const paintings = [...p.collection];
    const earned = paintings.reduce((sum, id) => sum + values[cardById(id).category], 0);
    p.cash += earned; p.collection = [];
    return { playerId: p.id, paintings, earned };
  });
  s.history.push(awards);
  s.settlement = { round: s.round, counts: [...s.counts], ranking, awards, values, sales, unsold: [...(s.auction?.cards || [])] };
  s.auction = null;
  s.nextStarter = nextSeat(s, triggerSeat);
  s.phase = s.round === 4 ? 'finished' : 'roundEnd';
  if (s.phase === 'finished') {
    const max = Math.max(...s.players.map(p => p.cash));
    s.winners = s.players.filter(p => p.cash === max).map(p => p.id);
    say(s, `四轮拍卖结束，${s.players.filter(p => p.cash === max).map(p => p.name).join('、')}赢得本场！`);
  } else say(s, `第 ${s.round} 回合结束，画作已按市场价值变现。`);
}
function endsRound(s, actor) {
  if (s.counts.some(n => n >= 5) || !hasCards(s)) { settleRound(s, actor); return true; }
  return false;
}
function beginAuction(s, method, now) {
  const a = s.auction;
  a.method = method; a.order = orderFrom(s, a.seller); a.cursor = 0;
  a.highBid = 0; a.highBidder = null; a.bids = {}; a.passed = [];
  s.phase = method === 'fixed' ? 'price' : 'auction';
  if (method === 'open') a.deadline = openDeadline(s, now);
}
function award(s, winner, price) {
  const a = s.auction;
  const buyer = s.players[winner], seller = s.players[a.seller];
  requireRule(buyer.cash >= price, '现金不足，无法成交。');
  buyer.cash -= price;
  if (winner !== a.seller) seller.cash += price;
  buyer.collection.push(...a.cards);
  s.lastLot = { cards: [...a.cards], buyer: buyer.id, price, seller: seller.id,
    revealedBids: a.method === 'sealed' ? Object.fromEntries(Object.entries(a.bids).map(([seat, value]) => [s.players[seat].id, value])) : null };
  say(s, `${buyer.name}以 ${price} 买下${a.cards.length === 2 ? '两幅' : '一幅'}${CATEGORIES[cardById(a.cards[0]).category].name}画作。`);
  const next = nextSeat(s, a.seller);
  s.auction = null;
  seekTurn(s, next);
}
function finishOpen(s) {
  const a = s.auction;
  award(s, a.highBidder ?? a.seller, a.highBid);
}

// Atomic reducer: invalid commands cannot partially remove cards or alter money.
export function command(state, playerId, action, now = Date.now()) {
  requireRule(action && typeof action === 'object', '无效操作。');
  const seat = state.players.findIndex(p => p.id === playerId);
  requireRule(seat >= 0, '你不在本房间。');
  const s = structuredClone(state);
  const a = s.auction;
  switch (action.type) {
    case 'start': {
      requireRule(s.phase === 'lobby', '游戏已经开始。');
      requireRule(s.players.length >= 3 && s.players.length <= 5, '需要 3–5 人才能开始，可以添加机器人。');
      s.round = 1; deal(s); s.phase = 'choose'; s.turn = 0;
      say(s, '拍卖馆开门了。每位收藏家获得 100 初始资金。');
      break;
    }
    case 'play': {
      requireRule(s.phase === 'choose' && s.turn === seat, '还没轮到你主持拍卖。');
      requireRule(owns(s, seat, action.cardId), '请选择你的手牌。');
      const card = cardById(action.cardId);
      if (action.secondId) requireRule(card.method === 'double' && owns(s, seat, action.secondId) && action.secondId !== card.id && cardById(action.secondId).category === card.category && cardById(action.secondId).method !== 'double', '配牌必须是同类别的非组合拍卖牌。');
      take(s, seat, card.id);
      s.auction = { cards: [card.id], seller: seat, originalSeller: seat, method: card.method };
      say(s, `${s.players[seat].name}展出「${card.title}」。`);
      if (endsRound(s, seat)) break;
      if (card.method === 'double') {
        if (action.secondId) {
          take(s, seat, action.secondId); s.auction.cards.push(action.secondId);
          if (!endsRound(s, seat)) beginAuction(s, cardById(action.secondId).method, now);
        } else {
          s.phase = 'double'; s.auction.order = orderFrom(s, seat).filter(i => i !== seat); s.auction.cursor = 0;
        }
      } else beginAuction(s, card.method, now);
      break;
    }
    case 'pair': {
      requireRule(s.phase === 'double' && a.order[a.cursor] === seat, '还没轮到你配牌。');
      requireRule(owns(s, seat, action.cardId), '这张画不在你的手牌中。');
      const card = cardById(action.cardId);
      requireRule(card.category === cardById(a.cards[0]).category && card.method !== 'double', '需要同类别的非组合拍卖牌。');
      take(s, seat, card.id); a.cards.push(card.id); a.seller = seat;
      say(s, `${s.players[seat].name}加入配牌并接任主持人。`);
      if (!endsRound(s, seat)) beginAuction(s, card.method, now);
      break;
    }
    case 'price': {
      requireRule(s.phase === 'price' && a.seller === seat, '只有主持人可以定价。');
      amount(s, seat, action.amount, true);
      a.price = action.amount; a.order = orderFrom(s, seat).filter(i => i !== seat); a.cursor = 0; s.phase = 'auction';
      say(s, `${s.players[seat].name}开出一口价 ${a.price}。`);
      break;
    }
    case 'bid': {
      requireRule(s.phase === 'auction' && ['open','once','sealed'].includes(a.method), '当前不能竞价。');
      if (a.method === 'sealed') {
        requireRule(a.bids[seat] === undefined, '秘密出价已经锁定。');
        amount(s, seat, action.amount, true); a.bids[seat] = action.amount;
        if (Object.keys(a.bids).length === s.players.length) {
          const best = Math.max(...Object.values(a.bids));
          const priority = [a.seller, ...orderFrom(s, a.seller).filter(i => i !== a.seller)];
          award(s, priority.find(i => a.bids[i] === best), best);
        }
      } else {
        if (a.method === 'once') requireRule(a.order[a.cursor] === seat, '请按顺序出价。');
        if (a.method === 'open') {
          requireRule(a.deadline == null || now < a.deadline, '本次拍卖已到落槌时间。');
          requireRule(a.highBidder !== seat, '你已经是最高出价者。');
          requireRule(!a.passed.includes(seat), '你已退出本次竞价。');
        }
        amount(s, seat, action.amount);
        requireRule(action.amount > a.highBid, '出价必须高于当前价格。');
        a.highBid = action.amount; a.highBidder = seat;
        say(s, `${s.players[seat].name}出价 ${action.amount}。`);
        if (a.method === 'open') a.deadline = openDeadline(s, now);
        else if (++a.cursor === a.order.length) finishOpen(s);
      }
      break;
    }
    case 'buy': {
      requireRule(s.phase === 'auction' && a.method === 'fixed' && a.order[a.cursor] === seat, '还没轮到你购买。');
      amount(s, seat, a.price, true); award(s, seat, a.price); break;
    }
    case 'pass': {
      if (s.phase === 'double') {
        requireRule(a.order[a.cursor] === seat, '还没轮到你配牌。');
        if (++a.cursor === a.order.length) award(s, a.originalSeller, 0);
      } else {
        requireRule(s.phase === 'auction', '当前不能放弃。');
        if (a.method === 'open') {
          requireRule((a.deadline == null || now < a.deadline) && a.highBidder !== seat && !a.passed.includes(seat), '当前不能退出竞价。');
          a.passed.push(seat);
          if (s.players.every((_, i) => i === a.highBidder || a.passed.includes(i))) finishOpen(s);
        } else {
          requireRule(['once','fixed'].includes(a.method) && a.order[a.cursor] === seat, '请按顺序操作。');
          if (++a.cursor === a.order.length) {
            if (a.method === 'fixed') award(s, a.seller, a.price);
            else finishOpen(s);
          }
        }
      }
      break;
    }
    case 'nextRound': {
      requireRule(s.phase === 'roundEnd', '当前不是回合结算阶段。');
      s.round++; s.counts = [0,0,0,0,0]; s.settlement = null; s.lastLot = null;
      deal(s); seekTurn(s, s.nextStarter); say(s, `第 ${s.round} 回合开始。`); break;
    }
    default: throw new Error('未知操作。');
  }
  s.revision++;
  return s;
}

export function expireAuction(state, now = Date.now()) {
  if (state.phase !== 'auction' || state.auction.method !== 'open' || state.auction.deadline == null || now < state.auction.deadline) return state;
  const s = structuredClone(state); finishOpen(s); s.revision++; return s;
}

export function publicView(s, playerId) {
  const seat = s.players.findIndex(p => p.id === playerId);
  requireRule(seat !== -1, '无权查看房间。');
  const a = s.auction;
  return {
    settings: roomSettings(s.settings),
    phase: s.phase, round: s.round, turn: s.turn, revision: s.revision, counts: [...s.counts], history: structuredClone(s.history),
    players: s.players.map((p, i) => ({ id: p.id, name: p.name, bot: p.bot, handCount: p.hand.length,
      collection: [...p.collection], ...(i === seat || s.phase === 'finished' ? { cash: p.cash } : {}) })),
    me: { id: playerId, seat, cash: s.players[seat].cash, hand: [...s.players[seat].hand] },
    auction: a ? { cards: [...a.cards], seller: a.seller, originalSeller: a.originalSeller, method: a.method,
      activeSeat: a.order?.[a.cursor] ?? null, highBid: a.highBid ?? 0, highBidder: a.highBidder ?? null,
      price: a.price ?? null, deadline: a.deadline ?? null, passed: a.passed || [],
      submitted: Object.keys(a.bids || {}).map(Number), myBid: a.bids?.[seat] ?? null } : null,
    settlement: structuredClone(s.settlement), log: structuredClone(s.log), lastLot: structuredClone(s.lastLot), winners: s.winners || [],
    deckCount: s.deck.length,
  };
}

// Bots only consume the same snapshot available to a human at their seat.
export { chooseBotAction } from './bot.js';
