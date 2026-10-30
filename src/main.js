import './table.css';
import './readability.css';
import { createMoneyEffects } from './money-effects.js';
import { OPEN_SECONDS, MAX_TIMEOUT_SECONDS } from '../packages/modern-art/src/settings.js';
import { lotDisplay } from './lot-display.js';
import { pairingContext, canPair, selectHandCard } from './pair-selection.js';
import { CATEGORIES, METHODS, cardById } from '../packages/modern-art/src/catalog.js';
import { artData, avatar } from '../packages/modern-art/src/art.js';
import { createGallery } from '../packages/modern-art/src/gallery.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const createSettings={timeoutEnabled:true,timeoutSeconds:String(OPEN_SECONDS)};
let state=null, socket=null, gallery=null, selected=null, second=null, pending=false, retries=0, retryTimer=null, online=false;
let demo=false, demoExpected=null, session=null, clockOffset=0, modalKind=null, toastTimer, collectionTarget=null, lotRenderKey='', handRenderKey='';
let bidConfirmation=null;
let dealAnimations=[], dealing=false, dealHandSignature='';

function stopDeal() {
  dealAnimations.forEach(animation=>animation.cancel()); dealAnimations=[]; dealing=false;
  $('#hand')?.classList.remove('dealing');
}
function animateDeal(prior, next) {
  if (!prior || prior.room!==next.room || next.round===prior.round || !next.me.hand.length || next.phase==='lobby') return;
  stopDeal();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const added=next.me.hand.filter(id=>!prior.me.hand.includes(id));
  if (!added.length) return; // The fourth round has no new cards.
  const cards=[...$('#hand').querySelectorAll('[data-card]')], strip=$('#hand .cards-strip');
  const compact=matchMedia('(max-width:850px)').matches;
  // Receive new cards at the right-hand end; category sorting only happens
  // after the entire hand has gathered into a pile.
  const receivedOrder=[
    ...cards.filter(card=>!added.includes(card.dataset.card)).map(card=>card.dataset.card),
    ...added,
  ];
  const slots=cards.map(card=>({transform:getComputedStyle(card).transform,left:card.offsetLeft}));
  const gatherAt=added.length*150+350, duration=gatherAt+900;
  dealing=true; $('#hand').classList.add('dealing');
  dealHandSignature=JSON.stringify([next.round,next.me.hand]);
  const hint=$('#hand .hand-title>small'); if(hint)hint.textContent='正在发牌 · 整理后即可选牌';
  for (const [sortedIndex,card] of cards.entries()) {
    const index=added.indexOf(card.dataset.card), receivedIndex=receivedOrder.indexOf(card.dataset.card);
    const final=slots[sortedIndex].transform;
    const received=compact?`translateX(${slots[receivedIndex].left-card.offsetLeft}px)`:slots[receivedIndex].transform;
    const pile=compact?`translateX(${strip.clientWidth/2-card.offsetLeft-card.offsetWidth/2}px) rotate(-4deg)`:'translateX(-50%) translateY(0) rotate(-4deg)';
    const incoming=compact?`${pile} translateY(-240px) scale(.65)`:'translateX(-50%) translateY(-400px) rotate(-20deg) scale(.65)';
    const frames=index>=0?[
      {offset:0,transform:incoming,opacity:0},
      {offset:index*150/duration,transform:incoming,opacity:0},
      {offset:(index*150+330)/duration,transform:received,opacity:1},
      {offset:gatherAt/duration,transform:received,opacity:1},
    ]:[{offset:0,transform:received,opacity:1},{offset:gatherAt/duration,transform:received,opacity:1}];
    frames.forEach(frame=>{frame.zIndex=receivedIndex+1;});
    frames.push(
      {offset:(gatherAt+250)/duration,transform:pile,opacity:1,zIndex:receivedIndex+1},
      {offset:(gatherAt+380)/duration,transform:`${pile} translateX(${sortedIndex%2?22:-22}px) rotate(${sortedIndex%2?6:-6}deg)`,opacity:1,zIndex:sortedIndex+1},
      {offset:(gatherAt+500)/duration,transform:pile,opacity:1,zIndex:sortedIndex+1},
      {offset:1,transform:final,opacity:1,zIndex:sortedIndex+1},
    );
    dealAnimations.push(card.animate(frames,{duration,easing:'ease-in-out',fill:'backwards'}));
  }
  const batch=dealAnimations;
  Promise.allSettled(batch.map(animation=>animation.finished)).then(()=>{
    if(dealAnimations!==batch)return;
    stopDeal(); handRenderKey=''; renderHand();
  });
}
try { session=JSON.parse(sessionStorage.getItem('modern-art-session') || 'null'); } catch {}
const invite = new URLSearchParams(location.search).get('room')?.toUpperCase() || '';
$('#app').innerHTML=`
  <div id="gallery" role="img" aria-label="卡通三维拍卖牌桌"></div><div class="room-vignette"></div>
  <header class="game-hud"><a class="brand" href="/" aria-label="现代艺术首页"><span class="brand-icon">m<span>a</span></span><span><b>现代艺术</b><small>MODERN ART</small></span></a>
    <div id="round-label" class="round-label"></div>
    <div class="hud-right"><span class="connection"><i class="live-dot"></i><span id="connection">连接中…</span></span><button class="hud-button" data-action="toggleMarket" aria-label="展开或收起计分板">计分板</button><button class="hud-button" data-action="rules">规则</button><button class="hud-button" data-action="settings" aria-label="画质设置">⚙</button></div>
  </header>
  <main class="game-table">
    <section class="opponents" id="players" aria-label="对手区"></section>
    <aside class="scoreboard" id="market" aria-label="桌面计分板"></aside>
    <section class="auction-table" aria-label="桌面拍卖区"><div id="gallery-pill" class="table-status"></div><div id="lot" class="lot"></div><div id="gallery-caption" class="lot-caption"></div></section>
    <aside class="action-dock" id="actions" aria-label="拍卖操作"></aside>
    <section class="hand-zone" id="hand" aria-label="我的手牌"></section>
    <div class="table-signature">MODERN ART <span>·</span> THE AUCTION TABLE</div>
  </main><div id="toast" role="status" aria-live="polite"></div><dialog id="modal" aria-labelledby="modal-title"></dialog>`;

const moneyEffects=createMoneyEffects();
function validBidConfirmation() {
  return bidConfirmation && online && state?.phase==='auction' && state.auction?.method==='once' &&
    state.auction.activeSeat===state.me.seat && state.revision===bidConfirmation.revision;
}

function toast(message) { $('#toast').textContent=message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4500); }
function send(message) { if (!online) { toast('正在恢复连接，请稍候。'); return false; } socket.send(JSON.stringify(message)); return true; }
function act(action) { if (pending) return; pending=true; if (!send({type:'action', revision:state.revision, action})) pending=false; }
function setConnection(text) { $('#connection').textContent=text; $('.live-dot').classList.toggle('offline',!online); }
function connect() {
  socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);
  socket.onopen=()=> { online=true; retries=0; setConnection('拍卖馆已连接'); if (session) send({type:'resume',...session}); render(); };
  socket.onmessage=event=> {
    const msg=JSON.parse(event.data);
    if (msg.type==='session') { session={room:msg.room,playerId:msg.playerId,token:msg.token}; sessionStorage.setItem('modern-art-session',JSON.stringify(session)); }
    if (msg.type==='state') {
      const prior=state; state=msg; pending=false; clockOffset=msg.serverNow-Date.now();
      if (prior?.phase!==msg.phase || prior?.auction?.cards?.join()!==msg.auction?.cards?.join()) { selected=null; second=null; }
      if (selected && !msg.me.hand.includes(selected)) selected=null;
      const context=pairingContext(msg,selected);
      if(second&&(!context||!msg.me.hand.includes(second)||!canPair(context.main,second)))second=null;
      setConnection(`房间 ${msg.room} · 已连接`); render();
      const moneyFinished=moneyEffects.update(prior,msg);
      animateDeal(prior,msg);
      if (msg.phase==='finished' && prior?.phase!=='finished') moneyFinished.then(()=>{if(state?.room===msg.room&&state.phase==='finished'&&!$('#modal').open)showModal('finalScores');});
      if (prior?.phase==='finished' && msg.phase!=='finished') { $('#modal').close(); modalKind=null; }
      if (demo && msg.phase==='lobby') {
        if (msg.players.length < 3 && demoExpected!==msg.players.length) { demoExpected=msg.players.length; send({type:'addBot'}); }
        else if (msg.players.length>=3) { demo=false; act({type:'start'}); }
      }
    }
    if (msg.type==='error') { pending=false; toast(msg.message); if (/凭证失效/.test(msg.message)) { session=null; state=null; sessionStorage.removeItem('modern-art-session'); } render(); }
    if (msg.type==='left') { moneyEffects.clear(); session=null; state=null; selected=null; second=null; pending=false; demo=false; $('#modal').close(); modalKind=null; sessionStorage.removeItem('modern-art-session'); setConnection('拍卖馆已连接'); render(); }
    if (msg.type==='replaced') { moneyEffects.clear(); session=null; sessionStorage.removeItem('modern-art-session'); socket.onclose=null; online=false; state=null; setConnection('席位已在另一页面打开'); render(); }
  };
  socket.onclose=()=> { online=false; pending=false; setConnection('连接中断，正在重连…'); render(); clearTimeout(retryTimer); retryTimer=setTimeout(connect,Math.min(8000,700 * 2**retries++)); };
  socket.onerror=()=>setConnection('正在连接联机服务…');
}
const button = (label, action, cls='primary', disabled=false, extra='') => `<button class="${cls}" data-action="${action}" ${disabled?'disabled':''} ${extra}>${label}</button>`;
const meTurn=()=>state && state.turn===state.me.seat;
const isHost=()=>state?.hostId===state?.me.id;
function seatMarkers(seat) {
  if(!state)return '';
  const current=['choose','double','price','auction'].includes(state.phase)&&state.turn===seat;
  return `<span class="seat-number" title="出牌顺序 ${seat+1} · 下一位 ${(seat+1)%state.players.length+1} 号" aria-label="${seat+1} 号玩家">${seat+1}</span>${current?'<span class="turn-crown" role="img" aria-label="当前出牌玩家" title="当前出牌玩家">👑</span>':''}`;
}
function renderMarket() {
  const counts=state?.counts || [0,0,0,0,0], history=state?.history || [];
  const ranked=[0,1,2,3,4].filter(i=>counts[i]>0).sort((a,b)=>counts[b]-counts[a]||a-b).slice(0,3);
  $('#market').innerHTML=`<div class="board-title"><span>✦</span><h2>艺术行情板</h2><span>✦</span></div>
    <table class="artist-market" aria-label="艺术家四轮行情，左侧艺术家在出牌数量相同时排名优先">
      <thead><tr><th scope="col">艺术家</th>${CATEGORIES.map(c=>`<th scope="col" style="--category:${c.color};--category-light:${c.light}"><span class="artist-swatch">${c.mark}</span><b>${c.name}</b></th>`).join('')}</tr></thead>
      <tbody><tr class="market-counts"><th scope="row">本轮<br>已出</th>${CATEGORIES.map(c=>`<td style="--category:${c.color};--category-light:${c.light}"><b>${counts[c.id]}<small> / 5</small></b><div class="market-pips" aria-hidden="true">${Array.from({length:5},(_,i)=>`<i class="${i<counts[c.id]?'filled':''}"></i>`).join('')}</div></td>`).join('')}</tr>
      ${[0,1,2,3].map(i=>`<tr class="${state?.round===i+1?'current-market-round':''}"><th scope="row">第 ${i+1} 轮</th>${CATEGORIES.map(c=>`<td class="market-award ${history[i]?.[c.id]?'scored':''}" style="--category:${c.color};--category-light:${c.light}">${history[i]?(history[i][c.id]||'—'):'·'}</td>`).join('')}</tr>`).join('')}</tbody>
    </table><div class="board-footer"><span>本轮人气前三 · 新增价值</span><div>${ranked.length?ranked.map((id,i)=>`<b style="--category:${CATEGORIES[id].color}">${CATEGORIES[id].mark} ${30-i*10}</b>`).join(''):'<b>① 30</b><b>② 20</b><b>③ 10</b>'}</div></div>`;
}
function renderGallery() {
  const a=state?.auction, preparing=!state||state.phase==='lobby';
  document.body.classList.toggle('in-lobby',preparing);document.body.classList.toggle('my-turn',!!meTurn()&&state.phase==='choose');
  const display=lotDisplay(state,selected), context=pairingContext(state,selected);
  const ids=context&&second?[context.main.id,second]:display.cards;
  gallery?.setArt(ids[0]||'0-0');
  $('#gallery-pill').innerHTML=preparing?'<span>MODERN ART</span><b>现代艺术</b><small>一场关于眼光与财富的博弈</small>':a?`<span class="auction-method-badge">${METHODS[a.method].icon} ${METHODS[a.method].name}</span><small>${esc(state.players[a.seller].name)} 主持${a.cards.length===2?' · 双画组合':''}</small>`:`<span class="turn-banner">${state.phase==='finished'?'本场拍卖结束':state.phase==='roundEnd'?'本轮落槌 · 画作变现':meTurn()?'轮到你出牌':`${esc(state.players[state.turn].name)}正在选牌`}</span>`;
  $('#lot').className=`lot ${ids.length===2?'double-lot':''} ${!a?'preview-lot':''}`;
  const nextLotKey=`${preparing}:${a?.method||'preview'}:${ids.join(',')}`;
  if(nextLotKey!==lotRenderKey){lotRenderKey=nextLotKey;$('#lot').innerHTML=preparing?`<div class="title-cards">${['1-1','0-0','2-0'].map((id,i)=>tableCard(id,i)).join('')}</div>`:ids.length?ids.map(tableCard).join(''):'<div class="empty-lot"><span>♧</span><b>拍卖区</b><small>从手牌中选择一幅画作</small></div>';}
  const price=a?.method==='fixed'?a.price:a?.method==='sealed'?null:a?.highBid;
  $('#gallery-caption').innerHTML=preparing?'':display.settlement?`<span class="selection-hint">${display.caption}</span>`:state?.phase==='double'||context?`<span class="selection-hint">${second?`双画预览 · ${METHODS[cardById(second).method].name} · 确认后出牌`:'组合配牌中 · 请选择高亮手牌'}</span>`:a?`<div class="table-bid"><i class="coin">¤</i><div><small>${a.method==='sealed'?'秘密竞价':a.method==='fixed'?'一口价':'当前出价'}</small><strong>${price===null||price===undefined?'?':price}<em>金币</em></strong></div>${a.method==='sealed'?`<span>${a.submitted.length}/${state.players.length} 已锁定</span>`:a.highBidder!==null?`<span>${esc(state.players[a.highBidder].name)}<small>目前领先</small></span>`:'<span>等待出价</span>'}</div>`:selected?'<span class="selection-hint">已选择手牌 · 确认后才会出牌</span>':state.lastLot?`<div class="sold-result"><span class="sold-stamp">已成交 · ${state.lastLot.price} 金币</span><b>${esc(state.players.find(p=>p.id===state.lastLot.buyer)?.name||'收藏家')}${state.lastLot.buyer===state.me.id?'（你）':' '} 购得</b></div>`:'';
  $('#round-label').innerHTML=`<span class="round-title">${state?.round?`第 ${state.round} 回合`:'等待开局'}</span><span class="round-dots">${[1,2,3,4].map(i=>`<i class="${i===(state?.round||0)?'current':i<(state?.round||0)?'complete':''}">${i}</i>`).join('')}</span>`;
}
function tableCard(id,i=0) {const c=cardById(id),cat=CATEGORIES[c.category];return `<div class="table-card" style="--category:${cat.color};--category-light:${cat.light};--card-i:${i}"><div class="table-card-top"><span>${cat.mark} ${cat.name}</span><b>${METHODS[c.method].icon}</b></div><img src="${artData(id)}" alt="${c.title}"><strong>${c.title}</strong><small>${METHODS[c.method].name}</small></div>`;}
function renderPlayers() {
  const opponents=state?state.players.map((p,i)=>({...p,seat:i})).filter(p=>p.id!==state.me.id):[];
  const slots=Math.max(2,opponents.length);$('#players').style.setProperty('--seats',slots);
  $('#players').innerHTML=Array.from({length:slots},(_,i)=>{
    const p=opponents[i];if(!p)return `<div class="opponent empty-seat"><div class="seat-avatar">＋</div><b>空位待入座</b><small>邀请朋友 / 添加机器人</small><div class="seat-shadow"></div></div>`;
    const active=state.phase==='choose'?state.turn===p.seat:state.phase==='price'?state.auction.seller===p.seat:state.auction?.activeSeat===p.seat;
    return `<div data-seat-id="${p.id}" class="opponent ${active?'active':''} ${!p.bot&&!state.online.includes(p.id)?'disconnected':''}"><div class="opponent-top"><div class="seat-avatar">${avatar(p.seat)}${seatMarkers(p.seat)}<i class="presence ${p.bot||state.online.includes(p.id)?'on':''}"></i></div><div class="opponent-name"><b>${esc(p.name)}${p.id===state.hostId?'<em class="host-label">房主</em>':''}</b><small>${active?'◉ 正在行动':p.bot?'机器人':state.online.includes(p.id)?'已入座':'等待重连'}</small></div></div><div class="opponent-hand">${Array.from({length:Math.min(7,p.handCount)},(_,j)=>`<i class="card-back" style="--fan:${j-(Math.min(7,p.handCount)-1)/2}"><span>m<span>a</span></span></i>`).join('')}<b>${p.handCount}</b></div><button class="collection-button" data-action="collection" data-player="${p.id}">${p.collection.length?`<span class="mini-collection">${p.collection.slice(-3).map(id=>`<img src="${artData(id)}" alt="公开藏品">`).join('')}</span>`:'<span class="collection-empty">▧</span>'} 藏品 ${p.collection.length}<span>查看 ›</span></button></div>`;
  }).join('');
}
function artistLabel(category) {
  return `<span class="artist-label"><i class="artist-color-dot" style="--category:${category.color}" aria-hidden="true"></i>${esc(category.name)}</span>`;
}
function renderActions() {
  if (!state) {
    $('#actions').innerHTML=`<span class="eyebrow">TAKE YOUR SEAT</span><h2 class="welcome-title">准备入座</h2><p class="muted">3–5 位收藏家，四轮拍卖。<br>用你的眼光，赢下这张牌桌。</p>
      <label class="field-label" for="nickname">你的收藏家昵称</label><input id="nickname" maxlength="16" value="${esc(localStorage.getItem('modern-art-name')||'') }" placeholder="怎么称呼你？" autocomplete="nickname">
      <div class="room-settings"><label class="timeout-toggle"><input id="timeout-enabled" type="checkbox" ${createSettings.timeoutEnabled?'checked':''}>公开拍卖超时自动落槌</label>
      <label class="timeout-duration" for="timeout-seconds">无人加价时长（秒）<input id="timeout-seconds" type="number" min="1" max="${MAX_TIMEOUT_SECONDS}" step="1" required value="${esc(createSettings.timeoutSeconds)}" ${createSettings.timeoutEnabled?'':'disabled'}></label>
      <p>关闭后，须其余玩家退出竞价才会落槌。</p></div>
      ${button('创建私人房间 <span>→</span>','create','primary wide',!online)}
      <div class="join-row"><input id="room-code" maxlength="6" placeholder="输入 6 位房间码" aria-label="房间码" value="${esc(invite)}">${button('加入','join','secondary',!online)}</div>
      <div class="or-divider"><span>或者，先熟悉一下</span></div>${button('和两位机器人试玩','demo','text-button wide',!online)}<p class="small-note">无需注册 · 发房间码就能一起玩</p>`; return;
  }
  if (state.phase==='lobby') {
    $('#actions').innerHTML=`<span class="eyebrow">WAITING FOR PLAYERS</span><h2>等待玩家入座</h2><div class="room-code-box"><span>房间码</span><b>${state.room}</b>${button('复制邀请链接','invite','text-button')}</div><p class="muted">${state.players.length} / 5 位收藏家已落座<br>至少 3 人，空位可以交给机器人。</p>
      <p class="room-timeout-summary">公开拍卖：${state.settings.timeoutEnabled?`${state.settings.timeoutSeconds} 秒无人加价自动落槌`:'不限时，等待玩家退出竞价'}</p>
      ${isHost()?`${button('＋ 添加机器人','addBot','secondary wide',state.players.length>=5)}<div class="bot-list">${state.players.filter(p=>p.bot).map(p=>`<button class="small-link" data-action="removeBot" data-player="${p.id}">移除${esc(p.name)} ×</button>`).join('')}</div>${button('开始拍卖 <span>→</span>','start','primary wide',state.players.length<3||!online)}`:'<div class="waiting">等房主开启拍卖…</div>'}
      ${hostClaim()}${button('离开房间','leave','text-button wide')}`; return;
  }
  const a=state.auction, me=state.me;
  let content='';
  if (state.phase==='choose') {
    const c=cardById(selected);
    content=meTurn()?`<h2>轮到你出牌</h2><p class="muted">选择下方手牌，主持一场拍卖。</p>${c?`<div class="selection-summary"><b>${esc(c.title)}</b><span>${METHODS[c.method].icon} ${METHODS[c.method].name}</span><small>${METHODS[c.method].hint}</small></div>${c.method==='double'?pairControls(c):`${button('确认出牌 →','play','primary wide',!online||pending)}${button('取消选牌','cancelSelection','text-button wide',pending)}`}`:'<div class="waiting">↓ 点击一张手牌</div>'}`:`<h2>等待对手出牌</h2><p class="muted">${esc(state.players[state.turn].name)}正在选牌。</p>`;
  } else if (state.phase==='double') {
    const my=a.activeSeat===me.seat;
    content=`<h2>两幅画，一起上场。</h2><p class="muted">${my?'轮到你选择是否加入配牌。加入后，你将收取全部拍卖收入。':`等待${esc(state.players[a.activeSeat].name)}决定是否配牌。`}</p>${my?`${pairControls(cardById(a.cards[0]),true)}`:'<div class="waiting">组合拍卖配牌中…</div>'}`;
  } else if (state.phase==='price') {
    content=`<h2>给好画开个价。</h2><p class="muted">${a.seller===me.seat?'定价不能超过你的现金。若无人购买，你需要按此价自购。':`等待${esc(state.players[a.seller].name)}开价。`}</p>${a.seller===me.seat?`${bidInput(0,Math.min(me.cash,20))}${button('确认一口价','price','primary wide')}`:''}`;
  } else if (state.phase==='auction') {
    const method=METHODS[a.method], my=a.activeSeat===me.seat;
    content=`<div class="auction-method">${method.icon} ${method.name}</div><h2>${a.method==='sealed'?'好眼光，悄悄出价。':a.method==='fixed'?'喜欢，就收入画廊。':'为你的眼光出价。'}</h2><p class="muted">${method.hint}</p>`;
    if (a.method==='open'||a.method==='once') {
      content+=`<div class="price-display"><span>当前最高价</span><strong>${a.highBid}<small>金币</small></strong><p>${a.highBidder===null?'尚未有人出价':`${esc(state.players[a.highBidder].name)}领先`}</p></div>`;
      if (a.method==='open') content+=a.deadline===null?'<div class="timer-line">不限时 · 其余玩家退出后落槌</div>':'<div class="timer-line"><span>无人加价后落槌</span><b id="auction-timer">–</b></div>';
      const can=a.method==='open'?!a.passed.includes(me.seat)&&a.highBidder!==me.seat:my;
      if (can) content+=`${bidInput(a.highBid+1,Math.min(me.cash,a.highBid+3))}${button('举牌竞价 ↗','bid','primary wide',me.cash<=a.highBid)}${button(a.method==='open'?'退出本次竞价':'放弃本次出价','pass','secondary wide')}`;
      else content+=`<div class="waiting">${a.highBidder===me.seat?'你正在领先。':a.method==='once'?`等待${esc(state.players[a.activeSeat].name)}出价…`:'你已退出，等待落槌。'}</div>`;
    }
    if (a.method==='sealed') {
      content+=`<div class="sealed-progress">${state.players.map((p,i)=>`<span class="${a.submitted.includes(i)?'submitted':''}" title="${esc(p.name)}">${a.submitted.includes(i)?'✓':'?'}</span>`).join('')}</div><p class="small-note">${a.submitted.length} / ${state.players.length} 位收藏家已锁定</p>`;
      if (a.myBid===null) content+=`${bidInput(0,Math.min(me.cash,15))}${button('锁定秘密出价','bid','primary wide')}<p class="small-note">可以出价 0。提交后不能修改。</p>`;
      else content+=`<div class="waiting">已锁定 <b>${a.myBid}</b>，等待同时揭晓。</div>`;
    }
    if (a.method==='fixed') content+=`<div class="price-display"><span>主持人定价</span><strong>${a.price}<small>金币</small></strong></div>${my?`${button('按一口价买下','buy','primary wide',me.cash<a.price)}${button('留给下一位','pass','secondary wide')}`:`<div class="waiting">等待${esc(state.players[a.activeSeat].name)}决定…</div>`}`;
  } else if (state.phase==='roundEnd'||state.phase==='finished') {
    const finished=state.phase==='finished';
    content=`<span class="eyebrow">${finished?'THE FINAL COLLECTION':'THE HAMMER FALLS'}</span><h2>${finished?'眼光，终于兑现。':'这一轮，收获如何？'}</h2><p class="muted">${finished?`${state.players.filter(p=>state.winners.includes(p.id)).map(p=>esc(p.name)).join('、')}赢得本场！`:'画作已变现，剩余手牌继续保留。'}</p>
      <div class="settlement-short">${state.settlement.ranking.map((i,n)=>`<div><span>${n+1}. ${artistLabel(CATEGORIES[i])}</span><b>${state.settlement.values[i]} / 幅</b></div>`).join('')}</div>
      ${finished?`<div class="final-scores">${[...state.players].sort((a,b)=>b.cash-a.cash).map(p=>`<div><span>${esc(p.name)}${state.winners.includes(p.id)?' ♛':''}</span><b>${p.cash}</b></div>`).join('')}</div>`:''}
      ${finished?button('查看总分结算','finalScores','primary wide'):''}${button('查看结算明细','settlement','secondary wide')}${isHost()?button(finished?'再来一局 →':'进入下一回合 →',finished?'rematch':'nextRound','primary wide'):'<div class="waiting">等待房主继续…</div>'}`;
  }
  $('#actions').innerHTML=`<div class="action-top"><span class="eyebrow">${a?`主持 · ${esc(state.players[a.seller].name)}`:'THE AUCTION ROOM'}</span><button class="small-link" data-action="invite">${state.room} ⧉</button></div>${content}${hostClaim()}<div class="activity-preview"><span>刚刚发生</span><p>${esc(state.log.at(-1)?.text||'欢迎来到拍卖馆。')}</p><button class="small-link" data-action="history">查看拍卖记录 ↗</button></div>`;
}
function hostClaim() { return state&&!state.online.includes(state.hostId)?button('房主离线 · 接任房主','claimHost','text-button wide'):''; }
function bidInput(min,value) { return `<label class="field-label" for="bid-amount">你的出价 <span>可用 ${state.me.cash}</span></label><div class="bid-input"><button data-action="minus" aria-label="减少出价">−</button><input id="bid-amount" type="number" min="${min}" max="${state.me.cash}" step="1" value="${Math.max(min,value)}" inputmode="numeric"><button data-action="plus" aria-label="增加出价">＋</button></div>`; }
function pairControls(main, invited=false) {
  if(!invited&&state.counts[main.category]>=4) return `<div class="pair-guide"><b>这张主牌将触发回合结算</b><p>已达到第五张，无需配牌，主牌不成交。</p></div>${button('确认出牌并结束回合','play','primary wide',pending||!online)}${button('取消选牌','cancelSelection','text-button wide',pending)}`;
  const options=state.me.hand.filter(id=>canPair(main,id)), paired=cardById(second);
  const count=state.counts[main.category]+(invited?0:1)+(paired?1:0);
  const closes=count>=5;
  return `<div class="pair-guide" role="status"><b>${paired?`已配好 · ${esc(paired.title)}`:options.length?'点击一张高亮手牌作为配牌':'没有可配的手牌'}</b><p>${paired?`拍卖方式：${METHODS[paired.method].icon} ${METHODS[paired.method].name}`:`需要 ${esc(CATEGORIES[main.category].name)} 的非组合牌。`}</p>${closes?'<p class="pair-warning">达到第五张，将结束本回合，结束回合的画作不成交。</p>':''}<small>${paired?'再点配牌可撤选，点另一张高亮牌可更换。':'选牌只是预览，确认后才会打出。'}</small></div>
    ${paired?button(closes?'确认出牌并结束回合':invited?'确认配牌并接任主持':'确认组合拍卖',invited?'pair':'play','primary wide',pending||!online):''}
    ${paired?button('取消配牌 · 保留主牌','clearPair','secondary wide',pending):''}
    ${paired?'':invited?button('不参与组合 · 跳过机会','pass','secondary wide',pending||!online):`${button('请其他玩家配牌 · 仅打出主牌','invitePair','secondary wide',pending||!online)}${button('取消选牌','cancelSelection','text-button wide',pending)}`}`;
}
function renderHand() {
  if(dealing&&dealHandSignature===JSON.stringify([state?.round,state?.me.hand]))return;
  const allIds=[...(state?.me.hand || ['0-2','1-1','2-7','3-0','4-8'])].sort((a,b)=>cardById(a).category-cardById(b).category);
  const collection=state?.players[state.me.seat].collection||[];
  const context=pairingContext(state,selected);
  const ids=context?allIds.filter(id=>id===selected||canPair(context.main,id)):allIds;
  $('#hand').classList.toggle('pairing-hand',!!context);
  const nextHandKey=JSON.stringify([state?.me,selected,second,state?.phase,state?.turn,state?.auction?.activeSeat,state?.auction?.cards,state?.players[state?.me.seat]?.collection]);
  if(handRenderKey===nextHandKey)return;handRenderKey=nextHandKey;
  if(dealing)stopDeal();
  $('#hand').innerHTML=`<div class="hand-rail"></div><div class="self-seat"><div class="self-avatar">${avatar(state?.me.seat||0)}${seatMarkers(state?.me.seat||0)}</div><div><b>${esc(state?.players[state.me.seat].name||'你的席位')} <em>你</em></b><span class="self-money"><i class="coin">¤</i><span data-cash-value="${state?state.me.cash:100}">${state?state.me.cash:'100'}</span><small>金币</small></span></div>${state?'':'<small class="seat-note">初始资金</small>'}</div>
    <div class="hand-title"><span>${state?`我的手牌 <b>${allIds.length}</b>`:'准备你的收藏'}</span><small>${context?'仅展示主牌和可配牌 · 其余暂时隐藏':state?.phase==='choose'&&meTurn()?'你的回合 · 点击选牌，再确认出牌':state?'仅你可见 · 悬停查看画作':'3–5 人 · 4 轮拍卖'}</small></div>
    ${state?`<button id="my-collection" class="collection-button hand-collection" data-action="collection" data-player="${state.me.id}" aria-label="我的藏品 ${collection.length} 幅，查看详情">${collection.length?`<span class="mini-collection">${collection.slice(-3).map(id=>`<img src="${artData(id)}" alt="${esc(cardById(id).title)}">`).join('')}</span>`:'<span class="collection-empty">▧</span>'}<b>我的藏品 ${collection.length}</b><span>查看详情 ›</span></button>`:''}
    <div class="cards-strip" style="--n:${Math.max(1,ids.length-1)}">${ids.length?ids.map((id,i)=>{const c=cardById(id),cat=CATEGORIES[c.category],offset=i-(ids.length-1)/2;return `<button class="art-card ${selected===id||second===id?'selected':''} ${context?(id===selected?'pair-main':canPair(context.main,id)?'pair-eligible':'pair-ineligible'):''} ${second===id?'pair-chosen':''}" data-card="${id}" style="--category:${cat.color};--category-light:${cat.light};--offset:${offset};--angle:${offset*Math.min(3,32/ids.length)}deg;--rise:${Math.abs(offset)*2}px;--order:${i}" aria-label="${c.title}，${cat.name}，${METHODS[c.method].name}" aria-pressed="${selected===id||second===id}">${context?`<span class="pair-card-label">${id===selected?'主牌 · 再点取消':second===id?'配牌 · 再点撤选':canPair(context.main,id)?'可配牌':'不可配牌'}</span>`:''}<div class="hand-card-top"><span>${cat.mark} ${cat.name}</span><b>${METHODS[c.method].icon}</b></div><div class="card-art"><img src="${artData(id)}" alt="${c.title}" draggable="false"></div><div class="card-copy"><b>${c.title}</b><span>${METHODS[c.method].name}</span></div></button>`;}).join(''):`<div class="empty-hand">${context?'没有可配的手牌 · 可选择不参与组合':state?.phase==='lobby'?'等待开局发牌':'手牌已用完 · 仍可参与竞拍'}</div>`}</div><div class="hand-helper"><b>${state?.phase==='choose'&&meTurn()?'◉ 轮到你出牌':'✦ 现代艺术'}</b><small>${selected?'已选中 1 张手牌':'选择 · 竞价 · 收藏'}</small>${selected?button('放大画作','inspect','text-button'):''}</div>`;
}
function render() {
  let leaveButton=$('#leave-room');
  if (!leaveButton) { $('.hud-right').insertAdjacentHTML('beforeend','<button id="leave-room" class="hud-button" data-action="leave">退出房间</button>'); leaveButton=$('#leave-room'); }
  leaveButton.hidden=!state; leaveButton.disabled=!online;
  const focused=document.activeElement;
  const keep=focused?.tagName==='INPUT'?{id:focused.id,value:focused.value,start:focused.selectionStart}:null;
  renderMarket();renderGallery();renderActions();renderPlayers();renderHand();
  if (keep&&$(`#${keep.id}`)) { const input=$(`#${keep.id}`); input.value=keep.value; input.focus({preventScroll:true}); if (input.type!=='number') input.setSelectionRange(keep.start,keep.start); }
  if (!online) $('#actions').querySelectorAll('button[data-action]').forEach(b=>{ if (!['rules','history','settlement'].includes(b.dataset.action)) b.disabled=true; });
  if (modalKind==='settlement'&&$('#modal').open) showModal('settlement');
  if (modalKind==='finalScores'&&$('#modal').open) showModal('finalScores');
  if (modalKind==='confirmBid'&&!validBidConfirmation()) { $('#modal').close(); modalKind=null; bidConfirmation=null; toast('拍卖状态已更新，请重新确认出价。'); }
  if (modalKind==='collection'&&$('#modal').open) showModal('collection');
  if (modalKind==='history'&&$('#modal').open) showModal('history');
  updateTimer();
}
function updateTimer() { const el=$('#auction-timer'); if(el&&state?.auction?.deadline) el.textContent=`${Math.max(0,Math.ceil((state.auction.deadline-Date.now()-clockOffset)/1000))}s`; }

function showModal(kind) {
  modalKind=kind; const modal=$('#modal'); let title='',html='';
  modal.dataset.kind=kind;
  if(kind==='confirmBid'&&bidConfirmation) {
    title='确认一轮拍卖出价';
    html=`<p class="modal-lead">${state.auction.cards.map(id=>esc(cardById(id).title)).join(' ＋ ')}</p><div class="confirm-amount"><strong>${bidConfirmation.amount}</strong><span>金币</span></div><p>每人只有一次出价机会，提交后不能修改。若最终拍得，剩余资金为 <b>${state.me.cash-bidConfirmation.amount}</b> 金币。</p>${button(`确认出价 ${bidConfirmation.amount} 金币`,'confirmBid','primary wide')}${button('返回修改','closeModal','secondary wide')}`;
  }
  if(kind==='leave'&&state) {
    title='退出房间';
    html=`<p>${['lobby','finished'].includes(state.phase)?'退出后返回入座页面。':'退出后，你的席位将由机器人接手，本局无法恢复该席位。其他玩家可以继续游戏。'}</p>${button('确认退出','confirmLeave','primary wide')}${button('继续留在房间','closeModal','secondary wide')}`;
  }
  if(kind==='finalScores'&&state?.phase==='finished') {
    title='游戏结束 · 总分结算';
    const players=[...state.players].sort((a,b)=>b.cash-a.cash);
    html=`<p class="modal-lead">${players.filter(p=>state.winners.includes(p.id)).map(p=>esc(p.name)).join('、')}${state.winners.length>1?'并列获胜':'获胜'}！</p><p>四轮拍卖已结束。总分为最终现金，已包含第四轮画作变现；剩余手牌不计分。</p><table><thead><tr><th>名次</th><th>收藏家</th><th>总分 / 金币</th><th>净收益</th></tr></thead><tbody>${players.map(p=>`<tr><td>${players.findIndex(other=>other.cash===p.cash)+1}</td><td>${esc(p.name)}${p.id===state.me.id?'（你）':''}${state.winners.includes(p.id)?' ♛':''}</td><td><b>${p.cash}</b></td><td>${p.cash>=100?'+':''}${p.cash-100}</td></tr>`).join('')}</tbody></table><p class="small-note">净收益 = 最终金币 − 初始资金 100；同分并列。</p>${button('查看第四轮变现明细','settlement','secondary wide')}${isHost()?button('再来一局 →','rematch','primary wide'):'<p class="waiting">等待房主开启下一局。</p>'}${button('退出房间','leave','secondary wide')}`;
  }
  if(kind==='rules') {
    title='一场拍卖，怎样玩？'; html=`<p class="modal-lead">你是一间画廊的主人。买画、卖画，让 100 金币在四轮拍卖中不断增长。</p><div class="rules-grid"><article><b>01 / 轮流当主持人</b><p>选一张手牌展出。其他人买下，钱归你；你自己买下，钱付给银行。无人出价时，主持人免费收下（一口价除外）。</p></article><article><b>02 / 五张，落槌结算</b><p>某类别出现第五张，立即结束回合。这张画不拍卖、不归任何人，但计入数量。组合让数量达到五张时，两张都不成交。</p></article><article><b>03 / 人气决定价值</b><p>按本轮展出数量取前三名，获得 30 / 20 / 10 的新价值。数量相同，市场左侧艺术家优先（总牌数较少者）。本轮前三类的单幅售价 = 历次价值之和，其余类别为 0。</p></article><article><b>04 / 四轮后，比现金</b><p>每轮所有已购画作自动变现并弃置，手牌保留。前三轮发牌，第四轮不补。按 3 / 4 / 5 人，每轮发牌数分别为 10·6·6·0 / 9·4·4·0 / 8·3·3·0。用尽手牌跳过主持，仍能竞拍。</p></article></div>
      <h3>看符号，选拍卖方式</h3><div class="method-help">${Object.entries(METHODS).map(([k,m])=>`<article><span>${m.icon}</span><div><b>${m.name}</b><p>${m.hint}${k==='sealed'?' 同价时，主持人优先；否则按主持人左手起顺时针，最先遇到者胜。':''}${k==='double'?' 主持人可自己配牌，或依次询问其他人。配牌者接任主持，收取两幅画全部收入，之后从其左手继续。无人配牌，原主持人免费收下组合牌。':''}${k==='fixed'?' 定价可为 0，不得超过自己现金。':''}</p></div></article>`).join('')}</div>
      <p>触发结算者左手边玩家开始下一轮。若全桌手牌耗尽，最后展出的画不成交，立即结算。现金与手牌在结束前仅本人可见。断线保留席位，使用原浏览器标签页重连；离线玩家的选择不会被自动代替。</p>
      <div class="rule-note">此版实现 PDF 的标准 3–5 人规则，暂未加入三人虚拟玩家变体。公开拍卖可在建房时开启超时自动落槌并设置 1–3600 秒（默认 15 秒），每次有效加价重新计时；关闭后等待其余玩家主动退出。也可主动退出；退出后本次不能再加价。PDF 未列拍卖符号配比，本版采用可配置牌组，类别总数严格为 12 / 13 / 14 / 15 / 16。画作是本版原创插画。</div>`;
  }
  if(kind==='settings') { title='舒服地看，轻松地玩。'; const low=localStorage.getItem('modern-art-quality')==='low'; html=`<p>桌面静止时停止绘制，切到后台时不渲染。选择低功耗会降低像素密度并关闭抗锯齿，适合手机与笔记本。</p><div class="settings-options">${button(`${!low?'✓ ':''}标准画质 · 最高 1.5 倍像素`,'qualityStandard','secondary wide')}${button(`${low?'✓ ':''}低功耗 · 1 倍像素`,'qualityLow','secondary wide')}</div><p class="small-note">切换后页面会刷新，已加入的席位会自动恢复。</p>`; }
  if(kind==='collection'&&state) {const p=state.players.find(p=>p.id===collectionTarget);title=`${p?.name||'收藏家'}的藏品`;html=`<p>这些画作已经买下，将在本轮结束时按市场价值变现。</p><div class="collection-grid">${p?.collection.length?p.collection.map(tableCard).join(''):'<div class="empty-collection">尚未拍得画作</div>'}</div>`;}
  if(kind==='inspect'&&selected) {const c=cardById(selected);title=c.title;html=`<div class="inspect-card">${tableCard(selected)}</div><p>${METHODS[c.method].hint}</p>`;}
  if(kind==='history') { title='拍卖记录'; html=`<p class="small-note">最新记录在上方 · 时间为本地时间</p><ol class="history-list">${[...(state?.log||[])].reverse().map(e=>`<li>${Number.isFinite(e.timestamp)?`<time datetime="${new Date(e.timestamp).toISOString()}">${new Date(e.timestamp).toLocaleTimeString('zh-CN',{hour12:false})}</time>`:'<time>时间未记录</time>'}<span>${esc(e.text)}</span></li>`).join('')}</ol>${state?.lastLot?.revealedBids?`<h3>最近一轮秘密出价</h3>${Object.entries(state.lastLot.revealedBids).map(([id,bid])=>`<p>${esc(state.players.find(p=>p.id===id)?.name)}：${bid}</p>`).join('')}`:''}`; }
  if(kind==='settlement'&&state?.settlement) {
    const s=state.settlement; title=`第 ${s.round} 回合 · 画作变现`;
    html=`<table><thead><tr><th>类别</th><th>数量</th><th>本轮新增</th><th>每幅售价</th></tr></thead><tbody>${CATEGORIES.map(c=>`<tr><td>${artistLabel(c)}</td><td>${s.counts[c.id]}</td><td>${s.awards[c.id]}</td><td><b>${s.values[c.id]}</b></td></tr>`).join('')}</tbody></table><h3>各画廊收入</h3><div class="sales-list">${s.sales.map(row=>`<div><span>${esc(state.players.find(p=>p.id===row.playerId)?.name)}<small>售出 ${row.paintings.length} 幅藏品</small></span><b>＋${row.earned}</b></div>`).join('')}</div><p class="small-note">结束回合的画不成交。没有进入本轮前三名的类别，每幅售价为 0。</p>`;
  }
  modal.innerHTML=`<div class="modal-heading"><h2 id="modal-title">${title}</h2><button class="icon-button" data-action="closeModal" aria-label="关闭弹窗">×</button></div><div class="modal-body">${html}</div>`;
  if(!modal.open)modal.showModal();
}

document.addEventListener('click',async event=> {
  const card=event.target.closest('[data-card]');
  if(card&&dealing)return;
  if(card) { if(pending)return; const chosen=card.dataset.card; const choice=selectHandCard(state,selected,second,chosen); if(choice.error){toast(choice.error);return;} selected=choice.selected;second=choice.second; renderGallery();renderActions();renderHand(); if(event.detail===0)document.querySelector(`[data-card="${chosen}"]`)?.focus({preventScroll:true});return; }
  const control=event.target.closest('[data-action]'); if(!control||control.disabled)return;
  const action=control.dataset.action;
  if(action==='clearPair'||action==='cancelSelection') {if(pending)return; second=null;if(action==='cancelSelection')selected=null;renderGallery();renderActions();renderHand();return;}
  if(action==='invitePair'&&selected) {act({type:'play',cardId:selected});return;}
  if(action==='toggleMarket') {const compact=matchMedia('(max-width:850px)').matches;document.body.classList.remove(compact?'hide-market':'show-market');document.body.classList.toggle(compact?'show-market':'hide-market');return;}
  if(action==='collection') {collectionTarget=control.dataset.player;showModal('collection');return;}
  if(action==='inspect') {showModal('inspect');return;}
  if (['rules','settings','history','settlement','finalScores','leave'].includes(action)) {showModal(action);return;}
  if(action==='confirmLeave') {send({type:'leave'});return;}
  if(action==='confirmBid') {
    if (!validBidConfirmation()||pending) { toast('拍卖状态已更新，请重新出价。'); return; }
    const amount=bidConfirmation.amount; bidConfirmation=null; $('#modal').close(); modalKind=null;
    act({type:'bid',amount});return;
  }
  if(action==='closeModal') {$('#modal').close();modalKind=null;return;}
  if(action==='qualityLow'||action==='qualityStandard') {localStorage.setItem('modern-art-quality',action==='qualityLow'?'low':'standard');location.reload();return;}
  if(action==='rotateLeft'||action==='rotateRight') {gallery?.rotate(action==='rotateLeft'?-1:1);return;}
  if(action==='resetCamera') {gallery?.reset();return;}
  if(action==='create'||action==='join'||action==='demo') {
    const name=$('#nickname').value.trim()||(action==='demo'?'小收藏家':''); if(!name){toast('先给自己起个名字吧。');$('#nickname').focus();return;}
    if(action!=='join'&&createSettings.timeoutEnabled&&!$('#timeout-seconds').reportValidity())return;
    localStorage.setItem('modern-art-name',name); demo=action==='demo'; demoExpected=null;
    send({type:action==='join'?'join':'create',name,room:$('#room-code').value.trim().toUpperCase(),...(action==='join'?{}:{settings:{timeoutEnabled:createSettings.timeoutEnabled,timeoutSeconds:createSettings.timeoutEnabled?Number(createSettings.timeoutSeconds):OPEN_SECONDS}})});return;
  }
  if(action==='invite') {
    const url=new URL(location.href); url.search='';url.searchParams.set('room',state.room);
    try {await navigator.clipboard.writeText(url.href);toast('邀请链接已复制，发给朋友就能入座。');} catch {toast(`房间码：${state.room}`);} return;
  }
  if(['addBot','removeBot','claimHost','leave','rematch'].includes(action)) {send({type:action,playerId:control.dataset.player});return;}
  if(action==='plus'||action==='minus') {const input=$('#bid-amount');input.value=Math.min(Number(input.max),Math.max(Number(input.min),Number(input.value)+(action==='plus'?1:-1)));return;}
  if(action==='play'&&selected) {act({type:'play',cardId:selected,...(second?{secondId:second}:{})});return;}
  if(action==='pair'&&second) {act({type:'pair',cardId:second});return;}
  if(action==='bid'||action==='price') {
    const input=$('#bid-amount');if(!input.reportValidity()||input.value==='')return;
    if(action==='bid'&&state.auction?.method==='once') { if(pending)return; bidConfirmation={amount:Number(input.value),revision:state.revision}; showModal('confirmBid');return; }
    act({type:action,amount:Number(input.value)});return;
  }
  if(['start','pass','buy','nextRound'].includes(action))act({type:action});
});
document.addEventListener('input',event=>{
  if(event.target.id==='timeout-seconds')createSettings.timeoutSeconds=event.target.value;
  if(event.target.id==='timeout-enabled'){createSettings.timeoutEnabled=event.target.checked;$('#timeout-seconds').disabled=!event.target.checked;}
});

$('#modal').addEventListener('click',event=>{if(event.target===$('#modal')){$('#modal').close();modalKind=null;}});
$('#modal').addEventListener('close',()=>{modalKind=null;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#modal').open&&!pending&&(selected||second)){event.preventDefault();if(second)second=null;else selected=null;renderGallery();renderActions();renderHand();}if(event.key==='Enter'&&event.target.id==='room-code')$('[data-action="join"]').click();});
render();connect();setInterval(updateTimer,500);
try {
  gallery=await createGallery($('#gallery')); renderGallery();
  // Read-only, redacted runtime evidence for GameFactory. Never expose the credential or server state.
  window.__A3GAME_GAME__={host:gallery.host,getState:()=>({phase:state?.phase||'entry',round:state?.round||0,players:state?.players.length||0,render:gallery.stats()})};
} catch(err) {
  console.error('Gallery initialization:',err);
  $('#gallery').classList.add('flat-table');
}
