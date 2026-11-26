export async function conversionRate(client,from,to){
 if(!/^[A-Z]{3}$/.test(from)||!/^[A-Z]{3}$/.test(to))throw new Error("Unknown currency");
 if(from===to)return 1;
 for(const inverse of [false,true]){
 const epic=inverse?to+from:from+to;
 let m;try{m=await client.market(epic);}catch{continue;}
 const s=m.snapshot,i=m.instrument;
 const stamp=s?.updateTimeUTC??s?.updateTime;
 const time=typeof stamp==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(stamp)?Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(stamp)?stamp:stamp+"Z"):NaN;
 if(i?.type!=="CURRENCIES"||i.currency!==(inverse?from:to)||s?.marketStatus!=="TRADEABLE"||!Number.isFinite(time)||Math.abs(Date.now()-time)>120000||!Number.isFinite(s.bid)||!Number.isFinite(s.offer)||s.bid<=0||s.offer<s.bid)continue;
 return inverse?1/s.bid:s.offer;
 }
 throw new Error("No verified fresh FX quote");
}
