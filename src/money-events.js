// Only public transaction amounts are exposed; opponents' cash stays private.
export function moneyEvents(prior, next) {
  if (!prior || prior.room!==next.room || next.phase==='lobby' || next.round<prior.round) return [];
  const events=[];
  if(next.lastLot && JSON.stringify(next.lastLot)!==JSON.stringify(prior.lastLot)) {
    const lot=next.lastLot;
    events.push({kind:'sale',cards:lot.cards,buyer:lot.buyer,seller:lot.seller,
      recipient:lot.buyer===lot.seller?'bank':lot.seller,amount:lot.price});
  }
  if(next.settlement && next.settlement.round!==prior.settlement?.round) {
    events.push({kind:'settlement',round:next.settlement.round,sales:next.settlement.sales});
  }
  return events;
}
