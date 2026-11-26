export function trailingCandidate({direction,bid,offer,oldStop,distance,tick,minDistance=0}){
 if(!["BUY","SELL"].includes(direction)||![bid,offer,oldStop,distance,tick].every(x=>Number.isFinite(x)&&x>0)||!Number.isFinite(minDistance)||minDistance<0||offer<bid)throw new Error("Invalid trailing inputs");
 const gap=Math.max(distance,minDistance,tick);
 const raw=direction==="BUY"?bid-gap:offer+gap;
 const stop=Number(((direction==="BUY"?Math.floor(raw/tick):Math.ceil(raw/tick))*tick).toPrecision(12));
 if(stop<=0||!Number.isFinite(stop)||(direction==="BUY"?stop>=bid||bid-stop<minDistance:stop<=offer||stop-offer<minDistance))throw new Error("Invalid stop distance");
 const improve=direction==="BUY"?stop>oldStop:stop<oldStop;
 return {update:improve,stopLevel:improve?stop:oldStop,previousStop:oldStop};
}
