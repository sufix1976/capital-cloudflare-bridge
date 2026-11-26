import {validateSignal} from "./order-retention.js";
import {resolveInstrument} from "./instruments.js";
export async function authenticateTV(value,secret){
 if(typeof value!=="string"||typeof secret!=="string"||secret.length<32||value.length>256)return false;
 const enc=new TextEncoder();
 const a=new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(value)));
 const b=new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(secret)));
 let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
export function normalizeTV(d){
 if(!d||typeof d!=="object"||Array.isArray(d))throw Error("Invalid payload");
 const symbol=resolveInstrument(d.symbol),strategy_id=d.strategy_id,action=d.action,signal_id=d.signal_id;
 if(!symbol||typeof strategy_id!=="string"||!/^[A-Za-z0-9_.:-]{1,64}$/.test(strategy_id)||!["buy","sell","exit_long","exit_short","flip_long","flip_short"].includes(action))throw Error("Invalid identity");
 const issued_at=typeof d.issued_at==="string"&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(d.issued_at)?Date.parse(d.issued_at):d.issued_at;
 validateSignal(signal_id,issued_at);
 if(signal_id.length>150)throw Error("Signal too long");
 const result={symbol,strategy_id,action,signal_id,issued_at,confirm:true};
 if(!action.startsWith("exit_")){
 if(!Number.isFinite(d.risk_percentage)||d.risk_percentage<=0||d.risk_percentage>100||!Number.isFinite(d.sl_distance_price)||d.sl_distance_price<=0||typeof d.managed_trailing!=="boolean")throw Error("Invalid sizing");
 Object.assign(result,{risk_percentage:d.risk_percentage,sl_distance_price:d.sl_distance_price,managed_trailing:d.managed_trailing});
 if(d.managed_trailing){
 if(!Number.isFinite(d.trailing_distance)||d.trailing_distance<=0||!Number.isFinite(d.trailing_step)||d.trailing_step<=0)throw Error("Invalid trailing");
 Object.assign(result,{trailing_distance:d.trailing_distance,trailing_step:d.trailing_step});
 }
 }
 return result;
}
