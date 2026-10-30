import { describe, it, expect } from 'vitest';
import { CARDS, DEALS, CATEGORIES, cardById } from '../src/catalog.js';
import { createGame, command, publicView, chooseBotAction, expireAuction } from '../src/rules.js';
import { lotDisplay } from '../../../src/lot-display.js';
const players=n=>Array.from({length:n},(_,i)=>({id:`p${i}`,name:`玩家${i}`,bot:true}));
const card=(method,cat=0)=>CARDS.find(c=>c.method===method&&c.category===cat).id;
function fixture(method='open') {
  let s=command(createGame(players(3)),'p0',{type:'start'},0);
  s.players.forEach((p,i)=>{p.hand=[card('open',i+1)];p.collection=[];});
  s.players[0].hand=[card(method),card('fixed',4)];s.turn=0;
  return s;
}
const play=(s,method)=>command(s,'p0',{type:'play',cardId:card(method)},0);
const pass=(s,i)=>command(s,`p${i}`,{type:'pass'},1);
describe('canonical setup and privacy',()=>{
  it('has 70 unique paintings, category totals and five auction methods',()=>{
    expect(CARDS).toHaveLength(70);expect(new Set(CARDS.map(c=>c.id)).size).toBe(70);
    expect(CATEGORIES.map(c=>CARDS.filter(x=>x.category===c.id).length)).toEqual([12,13,14,15,16]);
  });
  for(const n of [3,4,5])it(`deals correct initial hands for ${n}`,()=>{
    const s=command(createGame(players(n)),'p0',{type:'start'});
    expect(s.players.every(p=>p.cash===100&&p.hand.length===DEALS[n][0])).toBe(true);
    expect(s.deck.length).toBe(70-n*DEALS[n][0]);
  });
  it('never exposes opponents cash, hands, hidden bids or deck',()=>{
    let s=play(fixture('sealed'),'sealed');s=command(s,'p1',{type:'bid',amount:22});
    const v=publicView(s,'p0');expect(v.deck).toBeUndefined();expect(v.players[1].cash).toBeUndefined();expect(v.players[1].hand).toBeUndefined();
    expect(v.auction.bids).toBeUndefined();expect(v.auction.myBid).toBeNull();expect(v.auction.submitted).toEqual([1]);
    expect(publicView(s,'p1').auction.myBid).toBe(22);
  });
  it('rejects invalid commands atomically',()=>{
    const s=fixture('double'), before=JSON.stringify(s);
    expect(()=>command(s,'p0',{type:'play',cardId:card('double'),secondId:card('fixed',4)})).toThrow();
    expect(JSON.stringify(s)).toBe(before);
    expect(()=>command(s,'p1',{type:'play',cardId:s.players[1].hand[0]})).toThrow();
    expect(()=>publicView(s,'intruder')).toThrow();
  });
});
describe('auctions',()=>{
  it('open highest bidder pays seller and deadline resets',()=>{
    let s=play(fixture(),'open');s=command(s,'p1',{type:'bid',amount:12},1000);
    expect(s.auction.deadline).toBe(16000);expect(expireAuction(s,15999)).toBe(s);
    s=expireAuction(s,16000);expect(s.players.map(p=>p.cash)).toEqual([112,88,100]);expect(s.players[1].collection).toContain(card('open'));expect(s.turn).toBe(1);
  });
  it('self purchase pays the bank; no bidder yields a free painting',()=>{
    let s=play(fixture(),'open');s=command(s,'p0',{type:'bid',amount:8},1);s=expireAuction(s,16000);expect(s.players[0].cash).toBe(92);
    s=expireAuction(play(fixture(),'open'),16000);expect(s.players[0].cash).toBe(100);expect(s.players[0].collection).toHaveLength(1);
  });
  it('open pass is final, all remaining passes close the auction',()=>{
    let s=play(fixture(),'open');s=command(s,'p1',{type:'bid',amount:5},1);s=pass(s,2);
    expect(()=>command(s,'p2',{type:'bid',amount:6},2)).toThrow();s=pass(s,0);expect(s.lastLot.buyer).toBe('p1');
  });
  it('rejects unaffordable, fractional, duplicate, negative and expired bids',()=>{
    const s=play(fixture(),'open');
    for(const amount of [101,-1,1.5,NaN,Infinity])expect(()=>command(s,'p1',{type:'bid',amount},1)).toThrow();
    expect(()=>command(s,'p1',{type:'bid',amount:1},15000)).toThrow();
    const bid=command(s,'p1',{type:'bid',amount:4},1);expect(()=>command(bid,'p1',{type:'bid',amount:5},2)).toThrow();
  });
  it('once-around goes left, ends with seller, and each may bid only once',()=>{
    let s=play(fixture('once'),'once');expect(()=>command(s,'p0',{type:'bid',amount:3})).toThrow();
    s=command(s,'p1',{type:'bid',amount:5});s=pass(s,2);s=command(s,'p0',{type:'bid',amount:6});
    expect(s.players.map(p=>p.cash)).toEqual([94,100,100]);expect(s.lastLot.buyer).toBe('p0');
  });
  it('secret bids are sealed until all submit; seller wins a tied high bid',()=>{
    let s=play(fixture('sealed'),'sealed');s=command(s,'p1',{type:'bid',amount:9});
    expect(()=>command(s,'p1',{type:'bid',amount:10})).toThrow();s=command(s,'p0',{type:'bid',amount:9});
    expect(s.phase).toBe('auction');s=command(s,'p2',{type:'bid',amount:8});
    expect(s.lastLot.buyer).toBe('p0');expect(s.lastLot.revealedBids).toEqual({p0:9,p1:9,p2:8});
  });
  it('secret tie without seller goes clockwise from seller left; zero bids free to seller',()=>{
    let s=play(fixture('sealed'),'sealed');for(const [i,b]of [[2,5],[0,0],[1,5]])s=command(s,`p${i}`,{type:'bid',amount:b});expect(s.lastLot.buyer).toBe('p1');
    s=play(fixture('sealed'),'sealed');for(let i=0;i<3;i++)s=command(s,`p${i}`,{type:'bid',amount:0});expect(s.lastLot.buyer).toBe('p0');
  });
  it('fixed price cannot exceed seller cash, is clockwise, defaults to seller payment',()=>{
    let s=play(fixture('fixed'),'fixed');expect(()=>command(s,'p0',{type:'price',amount:101})).toThrow();
    s=command(s,'p0',{type:'price',amount:23});expect(()=>command(s,'p2',{type:'buy'})).toThrow();s=pass(s,1);s=pass(s,2);
    expect(s.lastLot.buyer).toBe('p0');expect(s.players[0].cash).toBe(77);
  });
  it('fixed purchase pays the seller and a zero price is allowed',()=>{
    let s=play(fixture('fixed'),'fixed');s=command(s,'p0',{type:'price',amount:10});s=command(s,'p1',{type:'buy'});
    expect(s.players.map(p=>p.cash)).toEqual([110,90,100]);
    s=play(fixture('fixed'),'fixed');s=command(s,'p0',{type:'price',amount:0});s=command(s,'p1',{type:'buy'});expect(s.lastLot.price).toBe(0);
  });
});
describe('double auction and round settlement',()=>{
  for (const round of [1,4]) it(`shows the unsold fifth painting instead of the previous 8-coin sale in round ${round}`,()=>{
    let s=fixture();s.round=round;s.counts[0]=4;
    s.lastLot={cards:[card('fixed',2)],price:8,buyer:'p1',seller:'p2'};
    s=play(s,'open');
    const display=lotDisplay(publicView(s,'p0'),card('fixed',4));
    expect(s.phase).toBe(round===4?'finished':'roundEnd');
    expect(display.cards).toEqual([card('open')]);
    expect(display.caption).toContain('此画未成交');
    expect(s.players.map(p=>p.cash)).toEqual([100,100,100]);
    expect(s.lastLot.price).toBe(8);
  });
  it('shows both unsold cards when a double triggers settlement',()=>{
    let s=fixture('double');s.counts[0]=3;s.players[0].hand.push(card('sealed'));
    s.lastLot={cards:[card('fixed',2)],price:8,buyer:'p1',seller:'p2'};
    s=command(s,'p0',{type:'play',cardId:card('double'),secondId:card('sealed')});
    const display=lotDisplay(publicView(s,'p0'));
    expect(display.cards).toEqual([card('double'),card('sealed')]);
    expect(display.caption).toContain('这两幅画均未成交');
    expect(s.players.map(p=>p.cash)).toEqual([100,100,100]);
    s=command(s,'p0',{type:'nextRound'});
    expect(lotDisplay(publicView(s,'p0')).settlement).toBe(false);
    expect(lotDisplay(publicView(s,'p0')).cards).toEqual([]);
  });
  it('second provider receives ALL money and next turn follows that provider',()=>{
    let s=fixture('double');s.players[1].hand.push(card('once'));
    s=play(s,'double');s=command(s,'p1',{type:'pair',cardId:card('once')});
    s=command(s,'p2',{type:'bid',amount:12});s=pass(s,0);s=pass(s,1);
    expect(s.players.map(p=>p.cash)).toEqual([100,112,88]);expect(s.players[2].collection).toHaveLength(2);expect(s.turn).toBe(2);
  });
  it('self pairing selects the second auction method',()=>{
    let s=fixture('double');s.players[0].hand.push(card('sealed'));
    s=command(s,'p0',{type:'play',cardId:card('double'),secondId:card('sealed')});expect(s.auction.method).toBe('sealed');expect(s.counts[0]).toBe(2);
  });
  it('no partner means free first painting to original seller',()=>{
    let s=play(fixture('double'),'double');s=pass(s,1);s=pass(s,2);expect(s.lastLot.buyer).toBe('p0');expect(s.lastLot.price).toBe(0);
  });
  it('fifth painting ends before auction; fourth+fifth double both unsold',()=>{
    let s=fixture();s.counts[0]=4;s=play(s,'open');expect(s.phase).toBe('roundEnd');expect(s.settlement.counts[0]).toBe(5);expect(s.settlement.unsold).toEqual([card('open')]);expect(s.players[0].collection).toHaveLength(0);
    s=fixture('double');s.counts[0]=3;s.players[0].hand.push(card('sealed'));s=command(s,'p0',{type:'play',cardId:card('double'),secondId:card('sealed')});expect(s.phase).toBe('roundEnd');expect(s.settlement.unsold).toHaveLength(2);
  });
  it('double fifth needs no partner and delegated fifth makes next starter follow provider',()=>{
    let s=fixture('double');s.counts[0]=4;s=play(s,'double');expect(s.phase).toBe('roundEnd');
    s=fixture('double');s.counts[0]=3;s.players[2].hand.push(card('open'));s=play(s,'double');s=pass(s,1);s=command(s,'p2',{type:'pair',cardId:card('open')});expect(s.nextStarter).toBe(0);
  });
  it('only current top three get historical value; ties use leftmost category',()=>{
    let s=fixture();s.round=2;s.history=[[0,10,20,30,0]];s.counts=[4,3,3,2,0];s.players[1].collection=[card('fixed',0),card('fixed',2),card('open',3)];
    s=play(s,'open');expect(s.settlement.awards).toEqual([30,20,10,0,0]);expect(s.settlement.values).toEqual([30,30,30,0,0]);expect(s.players[1].cash).toBe(160);expect(s.players[1].collection).toHaveLength(0);
  });
  it('hands carry over and round four draws nothing',()=>{
    let s=fixture();s.round=3;s.history=[[30,20,10,0,0],[0,30,20,10,0]];s.counts[0]=4;s=play(s,'open');const hands=s.players.map(p=>p.hand.length);const deck=s.deck.length;
    s=command(s,'p0',{type:'nextRound'});expect(s.round).toBe(4);expect(s.players.map(p=>p.hand.length)).toEqual(hands);expect(s.deck.length).toBe(deck);expect(s.turn).toBe(1);
  });
  it('last hand card ends round unsold even without a fifth category',()=>{
    let s=fixture();s.players.forEach(p=>p.hand=[]);s.players[0].hand=[card('open')];s=play(s,'open');expect(s.phase).toBe('roundEnd');expect(s.settlement.counts[0]).toBe(1);expect(s.settlement.unsold).toHaveLength(1);
  });
  it('final cash is revealed and equal cash shares victory',()=>{
    let s=fixture();s.round=4;s.counts[0]=4;s=play(s,'open');expect(s.phase).toBe('finished');expect(s.winners).toHaveLength(3);expect(publicView(s,'p0').players.every(p=>p.cash===100)).toBe(true);
  });
});
describe('complete games',()=>{
  for(const n of [3,4,5])it(`finishes four rounds with ${n} bots across 8 deterministic shuffles`,()=>{
    for(let seed=1;seed<=8;seed++) {
      let rng=seed;const random=()=>{rng=(rng*1664525+1013904223)>>>0;return rng/2**32;};
      const deck=CARDS.map(c=>c.id);for(let i=deck.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
      let s=command(createGame(players(n),deck),'p0',{type:'start'},0),steps=0;
      while(s.phase!=='finished'&&steps++<2000) {
        if(s.phase==='roundEnd'){s=command(s,'p0',{type:'nextRound'},0);continue;}
        let advanced=false;
        for(const [seat,p] of s.players.entries()){
          const temperature=seed<=4?1:[.55,1.45,1,1.2,.7][seat];
          const action=chooseBotAction(publicView(s,p.id),temperature);
          if(action){s=command(s,p.id,action,0);advanced=true;break;}
        }
        if(!advanced){const before=s;s=expireAuction(s,20000);expect(s).not.toBe(before);}
        expect(s.players.every(p=>Number.isSafeInteger(p.cash)&&p.cash>=0)).toBe(true);
        const owned=s.players.flatMap(p=>[...p.hand,...p.collection]).concat(s.deck,s.auction?.cards||[]);expect(new Set(owned).size).toBe(owned.length);
      }
      expect(s.phase).toBe('finished');expect(s.history).toHaveLength(4);expect(s.winners.length).toBeGreaterThan(0);
    }
  });
});

describe('room auction timeout settings',()=>{
  it('uses custom duration initially and after each bid',()=>{
    const initial=fixture();initial.settings={timeoutEnabled:true,timeoutSeconds:45};
    let s=play(initial,'open');expect(s.auction.deadline).toBe(45000);
    s=command(s,'p1',{type:'bid',amount:8},44000);
    expect(s.auction.deadline).toBe(89000);expect(expireAuction(s,88999)).toBe(s);
    expect(()=>command(s,'p2',{type:'bid',amount:9},89000)).toThrow();
    expect(expireAuction(s,89000).lastLot.price).toBe(8);
  });
  it('disabled timers allow late bids and passes, and still settle',()=>{
    const initial=fixture();initial.settings={timeoutEnabled:false,timeoutSeconds:15};
    let s=play(initial,'open');expect(s.auction.deadline).toBeNull();
    expect(expireAuction(s,999999)).toBe(s);
    s=command(s,'p1',{type:'bid',amount:8},999999);
    expect(s.auction.deadline).toBeNull();expect(expireAuction(s,9999999)).toBe(s);
    s=command(s,'p0',{type:'pass'},9999999);s=command(s,'p2',{type:'pass'},9999999);
    expect(s.lastLot.buyer).toBe('p1');expect(s.lastLot.price).toBe(8);
    s=play(initial,'open');for(let i=0;i<3;i++)s=pass(s,i);
    expect(s.lastLot.buyer).toBe('p0');expect(s.lastLot.price).toBe(0);
  });
  it('validates settings and supports legacy rooms',()=>{
    for(const settings of [null,[],{timeoutEnabled:'false'},...[0,-1,1.5,3601,Infinity,'30',null].map(timeoutSeconds=>({timeoutSeconds}))]) {
      expect(()=>createGame(players(3),undefined,settings)).toThrow();
    }
    const s=fixture();delete s.settings;
    expect(publicView(s,'p0').settings).toEqual({timeoutEnabled:true,timeoutSeconds:15});
    expect(play(s,'open').auction.deadline).toBe(15000);
  });
});
