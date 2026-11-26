export async function conversionRate(client,from,to){
 if(!/^[A-Z]{3}$/.test(from)||!/^[A-Z]{3}$/.test(to))throw new Error("Unknown currency");
 if(from===to)return 1;
 for(const inverse of [false,true]){
 const epic=inverse?to+from:from+to;
 let m;try{m=await client.market(epic);}catch{continue;}
 const s=m.snapshot,i=m.instrument;
 const time=Date.parse(String(s?.updateTimeUTC??"").replace(/Z?$/,"Z"));
 if(i?.type!=="CURRENCIES"||i.currency!==(inverse?from:to)||s?.marketStatus!=="TRADEABLE"||!Number.isFinite(time)||Math.abs(Date.now()-time)>120000||!Number.isFinite(s.bid)||!Number.isFinite(s.offer)||s.bid<=0||s.offer<s.bid)continue;
 return inverse?1/s.bid:s.offer;
 }
 throw new Error("No verified fresh FX quote");
}
