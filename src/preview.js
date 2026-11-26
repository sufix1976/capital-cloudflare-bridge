import { conversionRate } from "./fx.js";
import { calculateSize } from "./sizing.js";
import { resolveInstrument } from "./instruments.js";
// Estimates only. No mutation of broker state. Cross-currency and non-unit lots
// deliberately blocked until conversion and contract semantics are verified.
export async function previewOrder(client,data) {
 const epic=resolveInstrument(data?.symbol);
 const direction=String(data?.action??"").toUpperCase();
 if(!epic||!["BUY","SELL"].includes(direction)) throw new Error("Invalid symbol or action");
 const percentage=data.risk_percentage??0.2;
 const trailing=data.trailing_stop??false;
 if(typeof trailing!=="boolean") throw new Error("Invalid trailing flag");
 const [account,market,prefs]=await Promise.all([client.account(),client.market(epic),client.preferences()]);
 const i=market.instrument,r=market.dealingRules,s=market.snapshot;
 if(s?.marketStatus!=="TRADEABLE") throw new Error("Market not tradeable");
 if(i.lotSize!==1) throw new Error("Currency or contract conversion not verified");
 const leverage=prefs.leverages?.[i.type]?.current;
 if(!Number.isFinite(leverage)||leverage<1||i.marginFactorUnit!=="PERCENTAGE"||!Number.isFinite(i.marginFactor)||i.marginFactor<=0) throw new Error("Unknown margin requirements");
 if(!Number.isFinite(s.bid)||!Number.isFinite(s.offer)||s.bid<=0||s.offer<s.bid) throw new Error("Invalid quote");
 const price=Math.max(s.bid,s.offer);
 const fxRate=await conversionRate(client,i.currency,account.currency);
 const marginPerUnit=price*Math.max(i.marginFactor/100,1/leverage)*fxRate;
 function sizeRule(rule){if(rule?.unit!=="POINTS"||!Number.isFinite(rule.value)||rule.value<=0)throw new Error("Unknown size rule");return rule.value;}
 const sizing=calculateSize({equity:account.equity,available:account.available,percentage,marginPerUnit,minSize:sizeRule(r.minDealSize),maxSize:sizeRule(r.maxDealSize),sizeStep:sizeRule(r.minSizeIncrement)});
 const payload={epic,direction,size:sizing.size};
 if(trailing){
 const distance=data.sl_distance_price;
 if(typeof distance!=="number"||!Number.isFinite(distance)||distance<=0)throw new Error("Invalid stop distance");
 if(r.trailingStopsPreference!=="AVAILABLE")throw new Error("Trailing support not verified");
 function bounds(rule,reference){if(!Number.isFinite(rule?.value)||rule.value<0)throw new Error("Unknown stop rule");if(rule.unit==="POINTS")return rule.value;if(rule.unit==="PERCENTAGE")return reference*rule.value/100;throw new Error("Unknown stop unit");}
 if(distance<bounds(r.minStopOrProfitDistance,price)||distance>bounds(r.maxStopOrProfitDistance,s.bid))throw new Error("Stop outside broker limits");
 Object.assign(payload,{trailingStop:true,stopDistance:distance});
 }
 return {previewOnly:true,currency:account.currency,quote:{bid:s.bid,offer:s.offer},fxRate,marginPerUnit,...sizing,payload};
}
