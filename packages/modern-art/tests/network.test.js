import { it, expect } from 'vitest';
import { WebSocket } from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../../../server/index.js';

async function client(url) {
  const socket=new WebSocket(url),messages=[];let version=0;
  socket.on('message',raw=>{messages.push(JSON.parse(raw));version++;});
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  return {socket,messages,send:msg=>socket.send(JSON.stringify(msg)),mark:()=>messages.length,
    wait: async (type,from=0,predicate=()=>true)=>{
      const until=Date.now()+5000;
      while(Date.now()<until){const found=messages.slice(from).find(m=>m.type===type&&predicate(m));if(found)return found;await new Promise(r=>setTimeout(r,10));}
      throw new Error(`No ${type} message; last=${JSON.stringify(messages.at(-1))}, count=${version}`);
    }};
}
async function listen(app) {await new Promise(r=>app.server.listen(0,'127.0.0.1',r));return `ws://127.0.0.1:${app.server.address().port}/ws`;}
it('leaving during play transfers the seat to a bot and host to another player',async()=>{
  const app=createServer({persist:false,botDelay:999999});
  try {
    const url=await listen(app),a=await client(url),b=await client(url);
    a.send({type:'create',name:'A'});const session=await a.wait('session');
    b.send({type:'join',name:'B',room:session.room});const other=await b.wait('session');
    a.send({type:'addBot'});const lobby=await a.wait('state',0,m=>m.players.length===3);
    a.send({type:'action',revision:lobby.revision,action:{type:'start'}});
    await a.wait('state',0,m=>m.phase==='choose');
    const room=app.rooms.get(session.room),hand=[...room.game.players[0].hand],mark=b.mark();
    a.send({type:'leave'});await a.wait('left');
    const view=await b.wait('state',mark,m=>m.hostId===other.playerId);
    expect(view.players[0].bot).toBe(true);
    expect(Number.isFinite(room.game.players[0].botTemperature)).toBe(true);
    expect(JSON.stringify(view)).not.toContain('botTemperature');
    expect(room.game.players[0].hand).toEqual(hand);
    expect(room.tokens[session.playerId]).toBeUndefined();
    a.send({...session,type:'resume'});expect((await a.wait('error')).message).toContain('凭证');
    a.send({type:'create',name:'New'});await a.wait('session',a.messages.findIndex(m=>m.type==='left')+1);
  } finally {await app.close();}
});

it('keeps bot personality private and stable across restart and rematch',async()=>{
  const dataDir=mkdtempSync(path.join(tmpdir(),'modern-art-personality-'));
  let app=createServer({dataDir,botDelay:999999});
  try {
    const a=await client(await listen(app));a.send({type:'create',name:'A'});
    const session=await a.wait('session');
    a.send({type:'addBot'});a.send({type:'addBot'});
    const lobby=await a.wait('state',0,m=>m.players.length===3);
    expect(JSON.stringify(lobby)).not.toContain('botTemperature');
    const temperatures=app.rooms.get(session.room).game.players.filter(p=>p.bot).map(p=>p.botTemperature);
    expect(new Set(temperatures).size).toBe(2);
    await app.close();app=createServer({dataDir,botDelay:999999});
    const b=await client(await listen(app));b.send({...session,type:'resume'});
    const resumed=await b.wait('state');expect(JSON.stringify(resumed)).not.toContain('botTemperature');
    const game=app.rooms.get(session.room).game;
    expect(game.players.filter(p=>p.bot).map(p=>p.botTemperature)).toEqual(temperatures);
    game.phase='finished';const mark=b.mark();b.send({type:'rematch'});
    await b.wait('state',mark,m=>m.phase==='lobby');
    expect(app.rooms.get(session.room).game.players.filter(p=>p.bot).map(p=>p.botTemperature)).toEqual(temperatures);
  } finally {await app.close();rmSync(dataDir,{recursive:true,force:true});}
});
it('three independent clients join, protect private state, reject forged actions and resume after server restart',async()=>{
  const dataDir=mkdtempSync(path.join(tmpdir(),'modern-art-test-'));let app=createServer({dataDir,botDelay:999999});
  try {
    const url=await listen(app),a=await client(url),b=await client(url),c=await client(url);
    a.send({type:'create',name:'画廊甲',settings:{timeoutEnabled:false,timeoutSeconds:42}});const sa=await a.wait('session');
    b.send({type:'join',name:'画廊乙',room:sa.room});const sb=await b.wait('session');
    c.send({type:'join',name:'画廊丙',room:sa.room});await c.wait('session');
    const lobby=await a.wait('state',0,m=>m.players.length===3),bmark=b.mark();
    b.send({type:'action',revision:lobby.revision,action:{type:'start'}});expect((await b.wait('error',bmark)).message).toContain('房主');
    const start=a.mark();a.send({type:'action',revision:lobby.revision,action:{type:'start'}});const view=await a.wait('state',start,m=>m.phase==='choose');
    expect(view.me.hand).toHaveLength(10);expect(view.players[1]).not.toHaveProperty('cash');expect(view.players[1]).not.toHaveProperty('hand');expect(view).not.toHaveProperty('deck');expect(JSON.stringify(view)).not.toContain(sa.token);
    const stale=a.mark();a.send({type:'action',revision:lobby.revision,action:{type:'play',cardId:view.me.hand[0]}});expect((await a.wait('error',stale)).message).toContain('更新');
    const intruder=await client(url);intruder.send({type:'resume',room:sa.room,playerId:sa.playerId,token:'wrong'});expect((await intruder.wait('error')).message).toContain('凭证');
    await app.close();app=createServer({dataDir,botDelay:999999});const nextUrl=await listen(app);
    const recovered=await client(nextUrl);recovered.send({type:'resume',room:sa.room,playerId:sa.playerId,token:sa.token});
    const resumed=await recovered.wait('state');expect(resumed.me.hand).toEqual(view.me.hand);expect(resumed.revision).toBe(view.revision);expect(resumed.me.cash).toBe(100);expect(resumed.settings).toEqual({timeoutEnabled:false,timeoutSeconds:42});
    const other=await client(nextUrl);other.send({type:'resume',room:sb.room,playerId:sb.playerId,token:sb.token});const ov=await other.wait('state');expect(ov.me.hand).not.toEqual(view.me.hand);
    const dup=await client(nextUrl);dup.send({type:'resume',room:sa.room,playerId:sa.playerId,token:sa.token});await dup.wait('state');expect((await recovered.wait('replaced')).type).toBe('replaced');
  }finally{await app.close();rmSync(dataDir,{recursive:true,force:true});}
});
it('enforces five seats and host-only bot changes',async()=>{
  const app=createServer({persist:false});try{
    const url=await listen(app),a=await client(url),b=await client(url);a.send({type:'create',name:'A'});const sa=await a.wait('session');b.send({type:'join',name:'B',room:sa.room});await b.wait('session');
    b.send({type:'addBot'});expect((await b.wait('error')).message).toContain('房主');
    for(let i=0;i<3;i++)a.send({type:'addBot'});await a.wait('state',0,m=>m.players.length===5);const mark=a.mark();a.send({type:'addBot'});expect((await a.wait('error',mark)).message).toContain('5');
    const sixth=await client(url);sixth.send({type:'join',room:sa.room,name:'六号'});expect((await sixth.wait('error')).message).toContain('满');
  }finally{await app.close();}
});

it('validates room settings, shares them with joiners and preserves them on rematch',async()=>{
  const app=createServer({persist:false,botDelay:999999});
  try {
    const url=await listen(app),a=await client(url),b=await client(url);
    a.send({type:'create',name:'A',settings:{timeoutSeconds:0}});
    expect((await a.wait('error')).message).toContain('时长');expect(app.rooms.size).toBe(0);
    a.send({type:'create',name:'A',settings:{timeoutEnabled:true,timeoutSeconds:60}});
    const session=await a.wait('session');
    b.send({type:'join',name:'B',room:session.room});
    expect((await b.wait('state')).settings).toEqual({timeoutEnabled:true,timeoutSeconds:60});
    app.rooms.get(session.room).game.phase='finished';const mark=a.mark();
    a.send({type:'rematch'});
    const view=await a.wait('state',mark,m=>m.phase==='lobby');
    expect(view.settings).toEqual({timeoutEnabled:true,timeoutSeconds:60});
  } finally {await app.close();}
});
