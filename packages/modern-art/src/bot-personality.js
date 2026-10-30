// Server-only behavioral parameters. Never include these in publicView.
const TEMPERATURES=[0.55,1.45,1,1.2];
export const normalizeTemperature=value=>Number.isFinite(value)?Math.max(.5,Math.min(1.5,value)):1;

export function assignBotTemperatures(players, pickIndex = () => 0) {
  for(const player of players.filter(p=>p.bot)) {
    if(Number.isFinite(player.botTemperature)) {
      player.botTemperature=normalizeTemperature(player.botTemperature);continue;
    }
    const counts=TEMPERATURES.map(t=>players.filter(p=>p.bot&&p.botTemperature===t).length);
    const available=TEMPERATURES.filter((t,i)=>counts[i]===Math.min(...counts));
    player.botTemperature=available[pickIndex(available.length)];
  }
}

export function temperament(value) {
  const temperature=normalizeTemperature(value), d=temperature-1;
  return {temperature,riskDiscount:.3-.4*d,valueScale:1+.2*d,
    reserveRate:.15-.16*d,reserveCap:12-8*d,
    jumpFraction:.4+.3*d,jumpCap:Math.round(12+8*d),jumpThreshold:.6+.2*d,
    sealedFraction:.83+.18*d,selfSealedFraction:.55+.2*d,
    onceFraction:.8+.22*d,priceFraction:.62+.2*d,
    saleRiskDiscount:.2-.25*d,portfolioRiskDiscount:-d*.3,carryScale:1-.4*d};
}
