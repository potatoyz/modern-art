import { moneyEvents } from './money-events.js';
import { artData } from '../packages/modern-art/src/art.js';
import './money-effects.css';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createMoneyEffects() {
  const layer=document.createElement('div'); layer.id='money-effects';
  layer.innerHTML='<div class="money-stage" aria-hidden="true"></div><div class="money-receipt" role="status" aria-live="polite"></div>';
  document.body.append(layer);
  const stage=layer.firstElementChild, receipt=layer.lastElementChild;
  let chain=Promise.resolve(), generation=0, animations=new Set(), timers=new Map();
  const wait=ms=>new Promise(resolve=>{const id=setTimeout(()=>{timers.delete(id);resolve();},ms);timers.set(id,resolve);});
  function clear() {
    generation++; animations.forEach(a=>a.cancel()); animations.clear();
    const cash=document.querySelector('[data-cash-value]');if(cash)cash.textContent=cash.dataset.cashValue;
    timers.forEach((resolve,id)=>{clearTimeout(id);resolve();});timers.clear();
    stage.replaceChildren();receipt.classList.remove('visible');chain=Promise.resolve();
  }
  function anchor(id, next) {
    const own=id===next.me.id;
    const el=id==='bank'?document.querySelector('#lot'):own?document.querySelector('.self-money'):document.querySelector(`[data-seat-id="${CSS.escape(id)}"] .seat-avatar`);
    const box=el?.getBoundingClientRect();
    if(box&&box.top>=70&&box.bottom<innerHeight-15) return {x:box.x+box.width/2,y:box.y+box.height/2};
    return id==='bank'?{x:innerWidth/2,y:innerHeight*.43}:own?{x:innerWidth*.25,y:innerHeight-75}:{x:innerWidth*.75,y:150};
  }
  function animate(el,frames,options) {
    const a=el.animate(frames,options);animations.add(a);
    a.finished.catch(()=>{}).finally(()=>{animations.delete(a);el.remove();});
  }
  function fly(kind,from,to,delay=0,card=null) {
    const el=document.createElement(card?'img':'span');el.className=`money-flight ${kind}`;
    if(card){el.src=artData(card);el.alt='';}else el.textContent='¤';
    el.style.left=`${from.x}px`;el.style.top=`${from.y}px`;stage.append(el);
    const dx=to.x-from.x,dy=to.y-from.y;
    animate(el,[{transform:'translate(-50%,-50%) scale(.6) rotate(-15deg)',opacity:0},
      {offset:.15,transform:'translate(-50%,-50%) scale(1)',opacity:1},
      {offset:.55,transform:`translate(calc(-50% + ${dx*.5}px),calc(-50% + ${dy*.5-65}px)) rotate(12deg)`,opacity:1},
      {transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.4)`,opacity:0}],
      {duration:850,delay,fill:'both',easing:'ease-in-out'});
  }
  function delta(id,amount,next,delay=0) {
    if(!amount)return;
    const point=anchor(id,next), el=document.createElement('div');
    el.className=`money-delta ${amount<0?'debit':'credit'}`;el.textContent=`${amount>0?'+':'−'}${Math.abs(amount)} 金币`;
    el.style.left=`${Math.max(85,Math.min(innerWidth-85,point.x))}px`;el.style.top=`${Math.max(110,point.y-25)}px`;stage.append(el);
    animate(el,[{transform:'translate(-50%,0) scale(.7)',opacity:0},{offset:.15,transform:'translate(-50%,-12px) scale(1.15)',opacity:1},
      {offset:.75,transform:'translate(-50%,-30px) scale(1)',opacity:1},{transform:'translate(-50%,-55px)',opacity:0}],{duration:1600,delay,fill:'both'});
  }
  async function play(event,next,token,balance) {
    if(token!==generation)return;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const name=id=>id==='bank'?'银行':`${next.players.find(p=>p.id===id)?.name||'收藏家'}${id===next.me.id?'（你）':''}`;
    const bank=event.kind==='settlement'?{x:innerWidth/2,y:innerHeight*.66}:anchor('bank',next);
    let ownChange=0;
    if(event.kind==='sale') {
      if(event.buyer===next.me.id)ownChange-=event.amount;
      if(event.recipient===next.me.id)ownChange+=event.amount;
      receipt.innerHTML=`<span class="money-kicker">落槌成交 · ${event.cards.length} 幅画作</span><b>${escape(name(event.buyer))} 拍得</b><strong>${event.amount}<small> 金币</small></strong><p>${event.amount?`${escape(name(event.buyer))} −${event.amount} → ${escape(name(event.recipient))} +${event.amount}`:'零元成交 · 无金币转移'}</p>`;
      if(!reduced) {
        event.cards.forEach((card,i)=>fly('painting',bank,anchor(event.buyer,next),i*130,card));
        if(event.amount)for(let i=0;i<7;i++)fly('gold',anchor(event.buyer,next),anchor(event.recipient,next),220+i*75);
        delta(event.buyer,-event.amount,next,150);delta(event.recipient,event.amount,next,700);
      }
    } else {
      const mine=event.sales.find(s=>s.playerId===next.me.id);
      ownChange=mine?.earned||0;
      receipt.innerHTML=`<span class="money-kicker">第 ${event.round} 回合 · 银行收购</span><b>藏品变现，金币入账</b><strong>+${ownChange}<small> 你的收入</small></strong><p>${mine?.paintings.length||0} 幅藏品${ownChange===0?' · 本轮无变现收入':''}</p><div class="bank-payouts">${event.sales.map(s=>`<span>${escape(name(s.playerId))}<b>+${s.earned}</b></span>`).join('')}</div>`;
      if(!reduced) {
        const marker=document.createElement('div');marker.className='bank-marker';marker.textContent='▥ 银行';marker.style.left=`${bank.x}px`;marker.style.top=`${bank.y}px`;stage.append(marker);
        event.sales.forEach((sale,i)=>{
          sale.paintings.slice(0,3).forEach((card,j)=>fly('painting',anchor(sale.playerId,next),bank,i*100+j*120,card));
          if(sale.earned)for(let j=0;j<5;j++)fly('gold',bank,anchor(sale.playerId,next),900+i*100+j*80);
          delta(sale.playerId,sale.earned,next,1300+i*100);
        });
      }
    }
    receipt.insertAdjacentHTML('beforeend',`<div class="wallet-change">你的余额 <span>${balance}</span><i>→</i><b>${balance+ownChange}</b><small>金币</small></div>`);
    receipt.classList.add('visible');
    // Count the visible local wallet; never derive or reveal another player's balance.
    const cash=document.querySelector('[data-cash-value]');
    if(!reduced&&ownChange&&cash&&Number(cash.dataset.cashValue)===balance+ownChange) {
      const start=performance.now();
      const count=now=>{
        if(token!==generation||!cash.isConnected)return;
        const t=Math.min(1,(now-start)/1200);
        cash.textContent=String(Math.round(balance+ownChange*(1-(1-t)**3)));
        if(t<1)requestAnimationFrame(count);
      };
      requestAnimationFrame(count);
    }
    await wait(reduced?1800:event.kind==='settlement'?3400:2400);
    if(token===generation){receipt.classList.remove('visible');stage.replaceChildren();}
  }
  return {clear, update(prior,next) {
    if(!prior||prior.room!==next.room||next.phase==='lobby'||next.round!==prior.round)clear();
    const token=generation;let balance=prior?.me.cash??next.me.cash;
    for(const event of moneyEvents(prior,next)) {
      const before=balance;
      chain=chain.then(()=>play(event,next,token,before));
      if(event.kind==='sale'){if(event.buyer===next.me.id)balance-=event.amount;if(event.recipient===next.me.id)balance+=event.amount;}
      else balance+=event.sales.find(s=>s.playerId===next.me.id)?.earned||0;
    }
    return chain;
  }};
}
