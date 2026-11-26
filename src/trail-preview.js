import {trailingCandidate} from "./trailing.js";
import {resolveInstrument} from "./instruments.js";
export async function previewTrail(client,data){
 const epic=resolveInstrument(data.symbol);
 if(!epic||typeof data.dealId!=="string"||!data.dealId||!["BUY","SELL"].includes(data.direction))throw new Error("Invalid position identity");
 const positions=await client.positions();
 const matches=positions.positions?.filter(x=>x.position?.dealId===data.dealId&&x.market?.epic===epic&&x.position?.direction===data.direction);
 if(matches?.length!==1)throw new Error("Position not uniquely matched");
 const p=matches[0].position;
 const m=await client.market(epic),s=m.snapshot,r=m.dealingRules;
 if(s?.marketStatus!=="TRADEABLE"||s.scalingFactor!==1||!Number.isInteger(s.decimalPlacesFactor)||s.decimalPlacesFactor<0||s.decimalPlacesFactor>8)throw new Error("Market metadata not verified");
 const rule=r.minStopOrProfitDistance;
 const price=data.direction==="BUY"?s.bid:s.offer;
 const minDistance=rule.unit==="POINTS"?rule.value:rule.unit==="PERCENTAGE"?price*rule.value/100:NaN;
 const result=trailingCandidate({direction:data.direction,bid:s.bid,offer:s.offer,oldStop:p.stopLevel,distance:data.distance,tick:10**(-s.decimalPlacesFactor),minDistance});
 return {previewOnly:true,epic,dealId:data.dealId,direction:data.direction,...result};
}
