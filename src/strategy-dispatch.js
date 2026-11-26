import {executeDemoOrder} from "./order-coordinator.js";
import {exitStrategy} from "./strategy-exit.js";
import {validateSignal} from "./order-retention.js";
import {resolveInstrument} from "./instruments.js";
// Internal only; caller must serialize and authenticate.
export async function dispatchStrategy(storage,client,env,data){
 if(env.TRADING_MODE!=="DEMO"||env.ORDER_WRITE_ENABLED!=="true"||data.confirm!==true)throw Error("Strategy writes disabled");
 if(typeof data.strategy_id!=="string"||!/^[A-Za-z0-9_.:-]{1,64}$/.test(data.strategy_id)||!resolveInstrument(data.symbol))throw Error("Invalid strategy identity");
 if(!["buy","sell","exit_long","exit_short","flip_long","flip_short"].includes(data.action))throw Error("Invalid action");
 validateSignal(data.signal_id,data.issued_at);
 if(data.signal_id.length>150)throw Error("Signal ID too long");
 const key="dispatch:"+data.signal_id;
 const previous=await storage.get(key);
 if(previous)return {duplicate:true,status:previous.status};
 const stream="strategy-clock:"+data.strategy_id+":"+resolveInstrument(data.symbol);
 const admitted=await storage.transaction(async tx=>{
 const last=await tx.get(stream);
 if(last&&data.issued_at<=last.issuedAt)return false;
 await tx.put(stream,{issuedAt:data.issued_at,signalId:data.signal_id});
 await tx.put(key,{status:"processing",createdAt:Date.now()});
 return true;
 });
 if(!admitted)return {error:"Out-of-order strategy signal"};
 try{
 let result;
 const flip=data.action.startsWith("flip_"),exit=data.action.startsWith("exit_");
 if(flip||exit){
 const direction=["exit_long","flip_short"].includes(data.action)?"BUY":"SELL";
 const closed=await exitStrategy(storage,client,env,{...data,direction,signal_id:data.signal_id+":exit"});
 if(closed.error||closed.duplicate||(!closed.closed&&closed.reason!=="No owned position"))throw Error("Exit not verified");
 if(exit)result=closed;
 }
 if(!exit){
 const action=["buy","flip_long"].includes(data.action)?"buy":"sell";
 result=await executeDemoOrder(storage,client,env,{...data,action,signal_id:data.signal_id+":entry"});
 }
 const status=result.error?"uncertain":"completed";
 await storage.put(key,{status,finishedAt:Date.now()});
 return result;
 }catch{
 await storage.put(key,{status:"uncertain",finishedAt:Date.now()});
 return {error:"Strategy event blocked or uncertain; inspect broker before retry"};
 }
}
