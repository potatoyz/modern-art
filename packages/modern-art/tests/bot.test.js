import { describe, it, expect } from 'vitest';
import { CARDS } from '../src/catalog.js';
import { chooseBotAction, forecastMarket, settlementValues } from '../src/bot.js';
import { assignBotTemperatures, normalizeTemperature } from '../src/bot-personality.js';

const card = (category, method = 'open', n = 0) => CARDS.filter(c => c.category === category && c.method === method)[n].id;
function view({ counts = [4,2,2,0,0], own = [], opponent = [], hand = [card(0), card(3)] } = {}) {
  return { phase: 'choose', round: 4, turn: 0, counts, history: [],
    me: { seat: 0, id: 'p0', cash: 100, hand },
    players: [{ id: 'p0', handCount: hand.length, collection: own },
      { id: 'p1', handCount: 3, collection: opponent }, { id: 'p2', handCount: 3, collection: [] }], auction: null };
}
function auction(method = 'open', seller = 1) {
  const v = view(); v.phase = 'auction';
  v.auction = { cards: [card(0)], seller, originalSeller: seller, method,
    highBid: 0, highBidder: null, activeSeat: 0, passed: [], submitted: [], price: 0 };
  return v;
}

describe('strategic bot decisions', () => {
  it('uses higher bids and wider jumps for warmer personalities',()=>{
    for(const method of ['open','once','sealed']) {
      const v=auction(method);
      const bids=[.55,1,1.45].map(t=>chooseBotAction(v,t).amount);
      expect(bids[0]).toBeLessThan(bids[1]);expect(bids[1]).toBeLessThan(bids[2]);
    }
    const v=auction('fixed');v.auction.price=17;
    expect(chooseBotAction(v,.55)).toEqual({type:'pass'});
    expect(chooseBotAction(v,1.45)).toEqual({type:'buy'});
  });
  it('keeps every personality within available cash and legal turn constraints',()=>{
    for(const t of [.5,.55,1,1.45,1.5]) for(const cash of [0,1,5,12,100]) for(const method of ['open','once','sealed']) {
      const v=auction(method);v.me.cash=cash;
      const action=chooseBotAction(v,t);
      if(action?.type==='bid') {
        expect(Number.isInteger(action.amount)).toBe(true);
        expect(action.amount).toBeGreaterThanOrEqual(method==='sealed'?0:1);
        expect(action.amount).toBeLessThanOrEqual(cash);
      }
      if(method==='open'){v.auction.passed=[0];expect(chooseBotAction(v,t)).toBeNull();}
    }
  });
  it('retains reproducibility and privacy for each personality',()=>{
    for(const t of [.55,1.45]) {
      const v=auction(),copy=structuredClone(v),decision=chooseBotAction(v,t);
      expect(v).toEqual(copy);expect(chooseBotAction(v,t)).toEqual(decision);
      v.players[1].cash=100000;v.players[1].hand=[card(4)];v.deck=[card(4)];
      expect(chooseBotAction(v,t)).toEqual(decision);
    }
  });
  it('assigns different persistent profiles and migrates only missing ones',()=>{
    const players=Array.from({length:4},(_,i)=>({id:String(i),bot:true}));
    assignBotTemperatures(players);
    expect(new Set(players.map(p=>p.botTemperature)).size).toBe(4);
    const saved=structuredClone(players);assignBotTemperatures(players);
    expect(players).toEqual(saved);
    players.push({id:'human',bot:false});assignBotTemperatures(players);
    expect(players.at(-1)).not.toHaveProperty('botTemperature');
    expect(normalizeTemperature(Infinity)).toBe(1);expect(normalizeTemperature(-9)).toBe(.5);expect(normalizeTemperature(99)).toBe(1.5);
  });
  it('does not follow the popular artist into an opponent-favouring settlement', () => {
    const v = view({ opponent: [card(0,'fixed'),card(0,'fixed',1)] });
    expect(chooseBotAction(v).cardId).toBe(card(3));
  });
  it('closes the round to cash in its own collection before opponents develop theirs', () => {
    const v = view({ own: [card(0,'fixed'),card(0,'fixed',1)], opponent: [card(3,'fixed')] });
    expect(chooseBotAction(v).cardId).toBe(card(0));
  });
  it('promotes its own less popular artist when it holds enough cards to support them', () => {
    const v = view({ counts: [2,2,1,1,0],
      own: [card(3,'fixed'),card(3,'fixed',1),card(3,'fixed',2)],
      opponent: [card(0,'fixed'),card(0,'fixed',1)],
      hand: [card(0),card(3),card(3,'once'),card(3,'sealed')] });
    expect(chooseBotAction(v).cardId).toBe(card(3));
  });
  it('does not blindly pair a double that would terminate a profitable auction', () => {
    const v = view({ counts: [3,2,2,0,0], opponent: [card(0,'fixed'),card(0,'fixed',1)],
      hand: [card(0,'double'),card(0),card(3)] });
    expect(chooseBotAction(v)).toEqual({type:'play',cardId:card(0)});
  });
  it('values only the current top three, including history and category tie priority', () => {
    expect(settlementValues([5,3,3,3,0], [[0,10,20,30,0]])).toEqual([30,30,30,0,0]);
  });
  it('uses exact settlement when no cards remain, with no speculative recovery', () => {
    const v = view(); v.players.forEach(p => p.handCount = 0); v.me.hand = [];
    const market = forecastMarket(v, [3,2,2,1,0]);
    expect(market.values).toEqual([30,20,10,0,0]);
    expect(market.risk).toEqual([0,0,0,0,0]);
  });
  it('passes rather than self-bidding when it can receive an unbid lot for free', () => {
    for (const method of ['open','once']) expect(chooseBotAction(auction(method,0))).toEqual({type:'pass'});
  });
  it('accounts for foregone sale proceeds when the seller considers buying', () => {
    const buyer = auction(); buyer.auction.highBid = 16; buyer.auction.highBidder = 2;
    const seller = structuredClone(buyer); seller.auction.seller = 0;
    expect(chooseBotAction(buyer)).toEqual({type:'bid',amount:17});
    expect(chooseBotAction(seller)).toEqual({type:'pass'});
  });
  it('never bids above available cash and submits zero when broke', () => {
    const v = auction('sealed'); v.me.cash = 0;
    expect(chooseBotAction(v)).toEqual({type:'bid',amount:0});
    v.auction.method = 'open'; expect(chooseBotAction(v)).toEqual({type:'pass'});
    v.phase = 'price'; v.auction.seller = 0;
    expect(chooseBotAction(v)).toEqual({type:'price',amount:0});
  });
  it('does not bid again after passing, submitting or taking the lead', () => {
    const v = auction(); v.auction.passed = [0]; expect(chooseBotAction(v)).toBeNull();
    v.auction.passed = []; v.auction.highBidder = 0; expect(chooseBotAction(v)).toBeNull();
    v.auction.method = 'sealed'; v.auction.submitted = [0]; expect(chooseBotAction(v)).toBeNull();
  });
  it('rejects an overpriced fixed offer and uses different open and sealed bidding', () => {
    const v = auction('fixed'); v.auction.price = 100; expect(chooseBotAction(v).type).toBe('pass');
    v.auction.method = 'open'; const open = chooseBotAction(v);
    v.auction.method = 'sealed'; const sealed = chooseBotAction(v);
    expect(open.amount).toBeGreaterThan(1); expect(sealed.amount).toBeGreaterThan(open.amount);
  });
  it('jumps in an undervalued open auction, then slows down near its limit', () => {
    const v = auction();
    const opening = chooseBotAction(v);
    expect(opening.type).toBe('bid');
    expect(opening.amount).toBeGreaterThan(1);
    expect(opening.amount).toBeLessThanOrEqual(12);
    v.auction.highBid = 16; v.auction.highBidder = 2;
    expect(chooseBotAction(v)).toEqual({type:'bid',amount:17});
    v.auction.highBid = 17;
    expect(chooseBotAction(v)).toEqual({type:'pass'});
  });
  it('keeps jump bids within cash reserves and uses small raises on tight budgets', () => {
    const v = auction(); v.round = 1; v.counts = [2,1,1,0,0];
    for (const cash of [0,1,4,8,20,100]) {
      v.me.cash = cash;
      const action = chooseBotAction(v);
      if (action.type === 'bid') {
        expect(Number.isInteger(action.amount)).toBe(true);
        expect(action.amount).toBeGreaterThan(0);
        expect(action.amount).toBeLessThanOrEqual(cash-Math.min(12,Math.floor(cash*.15)));
        if(cash<6)expect(action.amount).toBe(1);
      }
    }
  });
  it('caps a jump on a valuable double lot without bidding to its entire limit', () => {
    const v=auction();v.auction.cards.push(card(0,'fixed'));v.history=[[30,0,0,0,0]];
    expect(chooseBotAction(v)).toEqual({type:'bid',amount:12});
    v.auction.highBid=12;v.auction.highBidder=2;
    const action=chooseBotAction(v);
    expect(action.amount).toBeGreaterThan(13);
    expect(action.amount).toBeLessThanOrEqual(24);
  });
  it('is reproducible, does not mutate snapshots, and ignores opponent private fields', () => {
    const v = view(), before = structuredClone(v), action = chooseBotAction(v);
    expect(v).toEqual(before); expect(chooseBotAction(v)).toEqual(action);
    v.players[1].cash = 10000; v.players[1].hand = [card(4)]; v.deck = [card(4)];
    expect(chooseBotAction(v)).toEqual(action);
  });
});
