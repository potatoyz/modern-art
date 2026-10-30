import { describe, it, expect } from 'vitest';
import { moneyEvents } from '../../../src/money-events.js';
const base={room:'TEST',phase:'choose',round:1,lastLot:null,settlement:null};
const lot={cards:['0-0'],buyer:'b',seller:'a',price:12};
describe('money animation events',()=>{
  it('routes peer payments to the seller',()=>{
    expect(moneyEvents(base,{...base,lastLot:lot})[0]).toMatchObject({kind:'sale',buyer:'b',recipient:'a',amount:12});
  });
  it('routes self purchases to the bank, including zero bids',()=>{
    expect(moneyEvents(base,{...base,lastLot:{...lot,buyer:'a',price:0}})[0]).toMatchObject({recipient:'bank',amount:0});
  });
  it('pays settlement earnings even though lastLot remains unchanged',()=>{
    const before={...base,lastLot:lot};
    const sales=[{playerId:'a',paintings:['0-0'],earned:30},{playerId:'b',paintings:[],earned:0}];
    expect(moneyEvents(before,{...before,phase:'roundEnd',settlement:{round:1,sales}})).toEqual([{kind:'settlement',round:1,sales}]);
  });
  it('sequences a last sale followed by settlement without netting away the purchase',()=>{
    expect(moneyEvents(base,{...base,lastLot:lot,phase:'finished',settlement:{round:4,sales:[]}}).map(e=>e.kind)).toEqual(['sale','settlement']);
  });
  it('does not replay old transactions on repeated snapshots or reconnect',()=>{
    const next={...base,lastLot:lot,settlement:{round:1,sales:[]}};
    expect(moneyEvents(next,structuredClone(next))).toEqual([]);
    expect(moneyEvents(null,next)).toEqual([]);
    expect(moneyEvents(base,{...next,room:'OTHER'})).toEqual([]);
    expect(moneyEvents(next,{...base,phase:'lobby',round:0})).toEqual([]);
  });
});
