// Settlement takes precedence over both hand previews and the previous sale.
// lastLot remains available to the auction history, not the settlement table.
export function lotDisplay(state, selected = null) {
  if (state?.phase === 'roundEnd' || state?.phase === 'finished') {
    const cards = state.settlement?.unsold || [];
    return {
      cards,
      settlement: true,
      caption: cards.length
        ? `本轮结束 · ${cards.length === 2 ? '这两幅画均未成交' : '此画未成交'}`
        : '本轮结束 · 藏品已变现',
    };
  }
  return { cards: state?.auction?.cards || (selected ? [selected] : state?.lastLot?.cards || []), settlement: false };
}
