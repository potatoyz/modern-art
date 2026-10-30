import { cardById } from '../packages/modern-art/src/catalog.js';

export function pairingContext(state, selected) {
  if (!state) return null;
  if (state.phase==='double' && state.auction?.activeSeat===state.me.seat) {
    return {main:cardById(state.auction.cards[0]), invited:true};
  }
  const main=cardById(selected);
  if (state.phase==='choose' && state.turn===state.me.seat && main?.method==='double') {
    return {main,invited:false};
  }
  return null;
}
export function canPair(main, id) {
  const card=cardById(id);
  return !!main && !!card && card.category===main.category && card.method!=='double';
}
export function selectHandCard(state, selected, second, id) {
  const context=pairingContext(state,selected);
  if (!context) return {selected:selected===id?null:id,second:null};
  if (!context.invited && id===selected) return {selected:null,second:null};
  if (!canPair(context.main,id)) return {selected,second,error:context.invited?'请选择同艺术家的非组合牌，或点击“不参与组合”。':'请选择同艺术家的非组合牌；更换主牌请先取消选牌。'};
  return {selected,second:second===id?null:id};
}
