export function quoteTime(snapshot,zone){
 const stamp=snapshot?.updateTimeUTC??snapshot?.updateTime;
 if(typeof stamp!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(stamp))return NaN;
 if(/(?:Z|[+-]\d{2}:\d{2})$/.test(stamp))return Date.parse(stamp);
 const naive=Date.parse(stamp+"Z");
 if(snapshot.updateTimeUTC!=null)return naive;
 if(!zone)return NaN;
 try{
 const fmt=new Intl.DateTimeFormat("en-GB",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
 const target=stamp.slice(0,19);
 const matches=[];
 for(let offset=-14*60;offset<=14*60;offset+=15){
 const candidate=naive-offset*60000;
 const parts=Object.fromEntries(fmt.formatToParts(new Date(candidate)).map(p=>[p.type,p.value]));
 if(parts.year+"-"+parts.month+"-"+parts.day+"T"+parts.hour+":"+parts.minute+":"+parts.second===target)matches.push(candidate);
 }
 return matches.length===1?matches[0]:NaN;
 }catch{return NaN;}
}
export async function conversionRate(client,from,to,zone){
 if(!/^[A-Z]{3}$/.test(from)||!/^[A-Z]{3}$/.test(to))throw new Error("Unknown currency");
 if(from===to)return 1;
 for(const inverse of [false,true]){
 const epic=inverse?to+from:from+to;
 let m;try{m=await client.market(epic);}catch{continue;}
 const s=m.snapshot,i=m.instrument;
 const time=quoteTime(s,zone);
 if(i?.type!=="CURRENCIES"||i.currency!==(inverse?from:to)||s?.marketStatus!=="TRADEABLE"||!Number.isFinite(time)||Math.abs(Date.now()-time)>120000||!Number.isFinite(s.bid)||!Number.isFinite(s.offer)||s.bid<=0||s.offer<s.bid)continue;
 return inverse?1/s.bid:s.offer;
 }
 throw new Error("No verified fresh FX quote");
}
