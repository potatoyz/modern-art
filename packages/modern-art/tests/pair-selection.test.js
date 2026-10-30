import { describe, it, expect } from 'vitest';
import { CARDS } from '../src/catalog.js';
import { pairingContext, selectHandCard } from '../../../src/pair-selection.js';
const id=(method,category=0)=>CARDS.find(c=>c.method===method&&c.category===category).id;
const main=id('double'), first=id('open'), other=id('sealed');
const state={phase:'choose',turn:0,me:{seat:0}};
describe('direct hand pairing',()=>{
  it('selects and replaces a companion without changing the main card',()=>{
    expect(selectHandCard(state,main,null,first)).toEqual({selected:main,second:first});
    expect(selectHandCard(state,main,first,other)).toEqual({selected:main,second:other});
  });
  it('clicking the companion cancels only that card',()=>{
    expect(selectHandCard(state,main,first,first)).toEqual({selected:main,second:null});
  });
  it('clicking the main card cancels the entire selection',()=>{
    expect(selectHandCard(state,main,first,main)).toEqual({selected:null,second:null});
  });
  it('invalid cards never replace either selected card',()=>{
    for(const invalid of [id('open',1),id('double',1)]) {
      expect(selectHandCard(state,main,first,invalid)).toMatchObject({selected:main,second:first,error:expect.any(String)});
    }
  });
  it('an invited player can select and cancel without removing the public main card',()=>{
    const invited={...state,phase:'double',auction:{activeSeat:0,cards:[main]}};
    expect(selectHandCard(invited,null,null,first)).toEqual({selected:null,second:first});
    expect(selectHandCard(invited,null,first,first)).toEqual({selected:null,second:null});
    expect(pairingContext({...invited,auction:{...invited.auction,activeSeat:1}},null)).toBeNull();
  });
  it('ordinary cards keep single-selection behavior outside pairing',()=>{
    expect(selectHandCard(state,first,null,other)).toEqual({selected:other,second:null});
    expect(selectHandCard(state,first,null,first)).toEqual({selected:null,second:null});
  });
});
