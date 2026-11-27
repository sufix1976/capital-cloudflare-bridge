import {reconcileCloseLocks} from "./close-resolution.js";
import {resolveInstrument} from "./instruments.js";
import {transitionOrder} from "./order-journal.js";
import {validateSignal} from "./order-retention.js";
async function snapshot(client,accountId){
 const s=await client.positions();
 if(!Array.isArray(s?.positions)||s.positions.some(x=>typeof x?.position?.dealId!=="string"||!x.position.dealId)||new Set(s.positions.map(x=>x.position.dealId)).size!==s.positions.length)throw Error("Invalid positions snapshot");
 if((await client.account()).accountId!==accountId)throw Error("Account changed");
 return s.positions;
}
// Only call inside the serialized coordinator. No public route yet.
export async function exitStrategy(storage,client,env,data){
 if(env.TRADING_MODE!=="DEMO"||env.ORDER_WRITE_ENABLED!=="true"||data.confirm!==true)throw Error("Close disabled");
 const strategyId=data.strategy_id,epic=resolveInstrument(data.symbol),direction=data.direction;
 if(typeof strategyId!=="string"||!/^[A-Za-z0-9_.:-]{1,64}$/.test(strategyId)||!epic||!["BUY","SELL"].includes(direction))throw Error("Invalid exit identity");
 const eventKey=validateSignal(data.signal_id,data.issued_at).replace(/^order:/,"exit:");
 if(await storage.get(eventKey))return {duplicate:true};
 const {accountId}=await client.account();
 if(typeof accountId!=="string"||!accountId)throw Error("Account identity required");
 await reconcileCloseLocks(storage,client,accountId,epic);
 const matches=[];let cursor;
 for(;;){
 const page=await storage.list({prefix:"order:",limit:128,...(cursor?{startAfter:cursor}:{})});
 for(const [key,r] of page){
 cursor=key;
 if(["submitting","uncertain"].includes(r.status)&&(!r.accountId||r.accountId===accountId))throw Error("Unresolved order");
 if(r.status==="confirmed"&&r.accountId===accountId&&r.strategyId===strategyId&&r.epic===epic)matches.push([key,r]);
 }
 if(page.size<128)break;
 }
 if(matches.length>1)throw Error("Ambiguous ownership");
 if(!matches.length)return {closed:false,reason:"No owned position"};
 const [key,r]=matches[0];
 if(r.direction!==direction||typeof r.dealId!=="string"||!r.dealId)throw Error("Direction or deal mismatch");
 const positions=await snapshot(client,accountId);
 const live=positions.find(x=>x.position.dealId===r.dealId);
 if(!live){await transitionOrder(storage,key,"closed");return {closed:true,alreadyAbsent:true};}
 if(live.market?.epic!==epic||live.position.direction!==direction)throw Error("Broker identity mismatch");
 const lock="close:"+key;
 if(await storage.get(lock))throw Error("Previous close uncertain; reconcile manually");
 await storage.transaction(async tx=>{
 if(await tx.get(lock)||await tx.get(eventKey))throw Error("Duplicate close");
 await tx.put(lock,{dealId:r.dealId,accountId,createdAt:Date.now()});
 await tx.put(eventKey,{createdAt:Date.now()});
 });
 try{
 const reference=await client.closePosition(r.dealId);
 await storage.put(lock,{dealId:r.dealId,accountId,reference,createdAt:Date.now()});
 const confirmation=await client.confirmOrder(reference);
 if(confirmation.dealStatus!=="ACCEPTED")throw Error("Close not confirmed");
 if((await snapshot(client,accountId)).some(x=>x.position.dealId===r.dealId))throw Error("Position still present");
 await transitionOrder(storage,key,"closed");
 await storage.put(eventKey,{status:"completed",finishedAt:Date.now()});
 await storage.delete(lock);
 return {closed:true,dealId:r.dealId};
 }catch{return {error:"Close outcome uncertain; no automatic retry"};}
}
