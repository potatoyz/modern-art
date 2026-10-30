import { CATEGORIES, cardById } from './catalog.js';
import { temperament } from './bot-personality.js';

const histogram = ids => {
  const counts = [0, 0, 0, 0, 0];
  for (const id of ids) counts[cardById(id).category]++;
  return counts;
};
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);

// The same ranking and tie priority as settlement. History is worthless outside
// this round's top three; the fifth painting only changes counts, never ownership.
export function settlementValues(counts, history) {
  const values = [0, 0, 0, 0, 0];
  counts.map((n, i) => i).filter(i => counts[i] > 0)
    .sort((a, b) => counts[b] - counts[a] || a - b).slice(0, 3)
    .forEach((id, place) => { values[id] = 30 - place * 10 + history.reduce((sum, h) => sum + h[id], 0); });
  return values;
}

// Bounded, deterministic scenario sampling, not access to the real hidden deck.
// Future own plays draw from known remaining cards. Opponent cards are an
// uncertain prior; their public hand sizes cap the horizon. Sampling ends at
// five paintings or exhausted hands. Samples share a seed across alternatives.
export function forecastMarket(v, counts = v.counts, hand = v.me.hand, next = v.turn) {
  const total = v.players.reduce((n, p, i) => n + (i === v.me.seat ? hand.length : p.handCount), 0);
  if (counts.some(n => n >= 5) || !total) {
    return { values: settlementValues(counts, v.history), risk: [0, 0, 0, 0, 0] };
  }
  const known = histogram(hand), owned = histogram(v.players[v.me.seat].collection);
  const sums = [0, 0, 0, 0, 0], squares = [...sums];
  let seed = 73471;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let sample = 0; sample < 48; sample++) {
    const market = [...counts], own = [...known];
    const sizes = v.players.map((p, i) => i === v.me.seat ? hand.length : p.handCount);
    const unknown = CATEGORIES.map(c => Math.max(0, c.count - counts[c.id] - known[c.id]));
    let seat = next;
    for (let step = 0; step < total && !market.some(n => n >= 5); step++) {
      for (let skip = 0; skip < sizes.length && !sizes[seat]; skip++) seat = (seat + 1) % sizes.length;
      if (!sizes[seat]) break;
      const isMe = seat === v.me.seat;
      const weights = (isMe ? own : unknown).map((n, i) => n * (1 + market[i] * .12 + (isMe ? owned[i] * .35 : 0)));
      let choice = random() * weights.reduce((a, b) => a + b, 0);
      let category = weights.findIndex(w => (choice -= w) < 0);
      if (category < 0) break;
      market[category]++; sizes[seat]--;
      (isMe ? own : unknown)[category]--;
      seat = (seat + 1) % sizes.length;
    }
    const values = settlementValues(market, v.history);
    values.forEach((value, i) => { sums[i] += value; squares[i] += value * value; });
  }
  return { values: sums.map(n => n / 48), risk: squares.map((n, i) => Math.sqrt(Math.max(0, n / 48 - (sums[i] / 48) ** 2))) };
}

function context(v, personality) {
  const holdings = v.players.map(p => histogram(p.collection));
  // Later rounds give more weight to denying opponents profit. Hidden cash is
  // deliberately not guessed from names, bot status, or private server state.
  const competition = v.round === 4 ? .7 : .4;
  const portfolio = values => dot(holdings[v.me.seat], values) - competition *
    Math.max(0, ...holdings.filter((_, i) => i !== v.me.seat).map(h => dot(h, values)));
  return { competition, portfolio, personality };
}

function evaluatePlay(v, ctx, ids, method, pairing = false) {
  const counts = [...v.counts], category = cardById(ids[0]).category;
  // A double that is already the fifth never consumes its proposed second card.
  let consumed = [];
  let remaining = v.players.reduce((sum, p) => sum + p.handCount, 0);
  for (const id of ids) {
    consumed.push(id); counts[category]++; remaining--;
    if (counts[category] >= 5 || remaining === 0) break;
  }
  const hand = v.me.hand.filter(id => !consumed.includes(id));
  const terminal = counts[category] >= 5 || remaining === 0;
  const market = terminal ? { values: settlementValues(counts, v.history), risk: [0,0,0,0,0] }
    : forecastMarket(v, counts, hand, (v.me.seat + 1) % v.players.length);
  const value = market.values[category], lotSize = consumed.length + (pairing ? 1 : 0);
  // Sale revenue and fallback ownership, with lower returns for delegating a
  // double (the partner receives ALL proceeds). No revenue for ending a round.
  const saleFactor = { open: .57, once: .52, sealed: .54, fixed: .5, double: .13 }[method];
  const revenue = terminal ? 0 : Math.max(0, value - market.risk[category] * ctx.personality.saleRiskDiscount) * lotSize * saleFactor;
  // Preserve useful inventory for future rounds; in round four there is no
  // carry value. Sacrificing two cards to close is assessed as two cards spent.
  const carry = v.round < 4 ? consumed.length * (1.5 + v.history.reduce((n, h) => n + h[category], 0) * .035) : 0;
  const valued=market.values.map((value,i)=>Math.max(0,value-market.risk[i]*ctx.personality.portfolioRiskDiscount));
  return { score: ctx.portfolio(valued) + revenue - carry*ctx.personality.carryScale, terminal };
}

export function chooseBotAction(v, temperature = 1) {
  const personality=temperament(temperature);
  const me = v.me, a = v.auction, ctx = context(v,personality);
  if (v.phase === 'choose' && v.turn === me.seat) {
    const options = [];
    for (const id of me.hand) {
      const card = cardById(id);
      options.push({ action: { type: 'play', cardId: id }, ...evaluatePlay(v, ctx, [id], card.method) });
      if (card.method === 'double' && v.counts[card.category] < 4) {
        for (const second of me.hand.map(cardById).filter(c => c.category === card.category && c.method !== 'double')) {
          options.push({ action: { type: 'play', cardId: id, secondId: second.id }, ...evaluatePlay(v, ctx, [id, second.id], second.method) });
        }
      }
    }
    options.sort((a, b) => b.score - a.score);
    return options[0]?.action ?? null;
  }
  if (!a) return null;
  const category = cardById(a.cards[0]).category;
  if (v.phase === 'double' && a.activeSeat === me.seat) {
    const market = forecastMarket(v, v.counts, me.hand, (a.originalSeller + 1) % v.players.length);
    // Passing may give the original seller a free painting. Pairing takes over
    // both proceeds, but triggering settlement can be worse than passing.
    const valued=market.values.map((value,i)=>Math.max(0,value-market.risk[i]*personality.portfolioRiskDiscount));
    const baseline = ctx.portfolio(valued) - (a.originalSeller === me.seat ? 0 : ctx.competition * valued[category]);
    const options = me.hand.map(cardById).filter(c => c.category === category && c.method !== 'double')
      .map(c => ({ card: c, ...evaluatePlay(v, ctx, [c.id], c.method, true) })).sort((a, b) => b.score - a.score);
    return options[0]?.score > baseline ? { type: 'pair', cardId: options[0].card.id } : { type: 'pass' };
  }
  const market = forecastMarket(v, v.counts, me.hand, (a.seller + 1) % v.players.length);
  const fair = Math.max(0, market.values[category] - market.risk[category] * personality.riskDiscount) * a.cards.length * personality.valueScale;
  const seller = a.seller === me.seat;
  // Cash is working capital. Keep a modest reserve early, loosen it in round 4.
  const reserve = v.round === 4 || Math.max(...v.counts) >= 4 ? 0 : Math.min(Math.round(personality.reserveCap), Math.floor(me.cash * personality.reserveRate));
  // Paying an opponent improves their score too. A seller buying their own lot
  // pays the bank AND forgoes the competing offer; that opportunity cost matters.
  const ceiling = Math.max(0, Math.min(me.cash - reserve, Math.floor(fair / (1 + ctx.competition))));
  if (v.phase === 'price' && seller) return { type: 'price', amount: Math.max(0, Math.min(me.cash, Math.floor(fair * personality.priceFraction))) };
  if (v.phase !== 'auction') return null;
  if (a.method === 'sealed' && !a.submitted.includes(me.seat)) return { type: 'bid', amount: Math.floor(ceiling * (seller ? personality.selfSealedFraction : personality.sealedFraction)) };
  if (a.method === 'fixed' && a.activeSeat === me.seat) return { type: a.price <= ceiling ? 'buy' : 'pass' };
  const limit = seller ? Math.min(ceiling, Math.floor(fair - a.highBid)) : ceiling;
  if (a.method === 'once' && a.activeSeat === me.seat) {
    if (seller && a.highBidder === null) return { type: 'pass' };
    const bid = seller ? a.highBid + 1 : Math.max(a.highBid + 1, Math.floor(limit * personality.onceFraction));
    return bid <= limit ? { type: 'bid', amount: bid } : { type: 'pass' };
  }
  if (a.method === 'open' && a.highBidder !== me.seat && !a.passed.includes(me.seat)) {
    if (seller && a.highBidder === null) return { type: 'pass' };
    if (a.highBid + 1 > limit) return { type: 'pass' };
    // When the lot is substantially under budget, close part of the gap rather
    // than prolonging the auction with +1 bids. Keep room for later competition;
    // near the valuation limit (or with little cash), negotiate one coin at a time.
    const gap = limit - a.highBid;
    const increment = gap >= 6 && a.highBid <= limit * personality.jumpThreshold
      ? Math.min(personality.jumpCap, Math.ceil(gap * personality.jumpFraction)) : 1;
    return { type: 'bid', amount: Math.min(limit, a.highBid + increment) };
  }
  return null;
}
