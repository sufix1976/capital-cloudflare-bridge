import {validateSignal,pruneOrders} from "./order-retention.js";
// Call from the serialized Durable Object coordinator only.
export async function reserveOrder(storage,signalId,issuedAt,epic,now=Date.now()){
 const key=validateSignal(signalId,issuedAt,now);
 return storage.transaction(async tx=>{
 const existing=await tx.get(key);
 if(existing)return {duplicate:true,key,record:existing};
 const record={status:"reserved",epic,issuedAt,createdAt:now};
 await tx.put(key,record);
 return {duplicate:false,key,record};
 });
}
export async function transitionOrder(storage,key,status,fields={},now=Date.now()){
 const allowed={reserved:["cancelled-before-submit","submitting"],submitting:["uncertain","rejected","confirmed"],uncertain:["confirmed","rejected"],confirmed:["closed"]};
 return storage.transaction(async tx=>{
 const old=await tx.get(key);
 if(!old||!allowed[old.status]?.includes(status))throw Error("Invalid order transition");
 const next={...old,status,updatedAt:now};
 if(fields.strategyId!==undefined)next.strategyId=fields.strategyId;
 if(fields.direction!==undefined)next.direction=fields.direction;
 if(fields.accountId!==undefined)next.accountId=fields.accountId;
 if(fields.dealReference!==undefined)next.dealReference=fields.dealReference;
 if(fields.dealId!==undefined)next.dealId=fields.dealId;
 if(status==="confirmed"&&(typeof next.dealId!=="string"||!next.dealId))throw Error("Missing confirmed deal ID");
 if(["closed","rejected","cancelled-before-submit"].includes(status))next.finishedAt=now;
 await tx.put(key,next);
 return next;
 });
}
export async function maintainJournal(storage,now=Date.now()){
 const day=new Date(now).toISOString().slice(0,10);
 if(await storage.get("order-prune-day")===day)return 0;
 const removed=await pruneOrders(storage,now);
 await storage.put("order-prune-day",day);
 return removed;
}
