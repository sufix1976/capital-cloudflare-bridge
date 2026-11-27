import {transitionOrder} from "./order-journal.js";
export async function resolveClose(storage,client,data){
 if(data.confirm!==true||typeof data.signal_id!=="string"||!/^[A-Za-z0-9_.:-]{1,160}$/.test(data.signal_id))throw Error("Invalid request");
 const key="order:"+data.signal_id,lockKey="close:"+key;
 const lock=await storage.get(lockKey),record=await storage.get(key);
 if(!lock||!record||!lock.accountId||lock.accountId!==record.accountId||lock.dealId!==record.dealId||!["confirmed","closed"].includes(record.status))throw Error("Close identity not verified");
 if((await client.account()).accountId!==lock.accountId)throw Error("Account mismatch");
 const snapshot=await client.positions();
 if(!Array.isArray(snapshot?.positions)||snapshot.positions.some(x=>typeof x?.position?.dealId!=="string"||!x.position.dealId)||new Set(snapshot.positions.map(x=>x.position.dealId)).size!==snapshot.positions.length)throw Error("Invalid snapshot");
 if((await client.account()).accountId!==lock.accountId)throw Error("Account changed");
 if(snapshot.positions.some(x=>x.position.dealId===lock.dealId))return {resolved:false,reason:"Position still open; lock retained"};
 if(record.status==="confirmed")await transitionOrder(storage,key,"closed");
 await storage.delete(lockKey);
 return {resolved:true,dealId:lock.dealId,positionAbsent:true};
}

export async function closeStatus(storage,client){
 const before=await client.account();
 if(typeof before.accountId!=="string"||!before.accountId)throw Error("Account identity required");
 const snapshot=await client.positions();
 if(!Array.isArray(snapshot?.positions)||snapshot.positions.some(x=>typeof x?.position?.dealId!=="string"||!x.position.dealId)||new Set(snapshot.positions.map(x=>x.position.dealId)).size!==snapshot.positions.length)throw Error("Invalid snapshot");
 if((await client.account()).accountId!==before.accountId)throw Error("Account changed");
 const locks=[];let cursor;
 for(;;){
 const page=await storage.list({prefix:"close:",limit:128,...(cursor?{startAfter:cursor}:{})});
 for(const [key,lock] of page){
 cursor=key;
 const record=await storage.get(key.slice(6));
 const verified=!!(record&&lock?.accountId===before.accountId&&record.accountId===before.accountId&&typeof lock.dealId==="string"&&lock.dealId&&lock.dealId===record.dealId&&["confirmed","closed"].includes(record.status));
 locks.push({signal_id:key.slice("close:order:".length),symbol:record?.epic??null,strategy_id:record?.strategyId??null,direction:record?.direction??null,dealId:lock?.dealId??null,createdAt:lock?.createdAt??null,recordStatus:record?.status??null,identityVerified:verified,positionPresent:verified?snapshot.positions.some(x=>x.position.dealId===lock.dealId):null,hasCloseReference:!!lock?.reference});
 }
 if(page.size<128)break;
 }
 return {previewOnly:true,lockCount:locks.length,locks};
}

 // Serialized caller only. Never submits or retries a broker order.
export async function reconcileCloseLocks(storage,client,accountId,epic){
 let cursor;const pending=[];
 for(;;){
 const page=await storage.list({prefix:"close:",limit:128,...(cursor?{startAfter:cursor}:{})});
 for(const [key,lock] of page){
 cursor=key;
 if(lock?.accountId&&lock.accountId!==accountId)continue;
 const record=await storage.get(key.slice(6));
 if(!key.startsWith("close:order:")||!lock?.accountId||record?.accountId!==accountId||typeof lock.dealId!=="string"||!lock.dealId||record.dealId!==lock.dealId||!["confirmed","closed"].includes(record.status)||typeof record.epic!=="string"||!record.epic)throw Error("Unresolved close; manual reconciliation required");
 pending.push({key,lock,record});
 }
 if(page.size<128)break;
 }
 if(!pending.length)return;
 let positions;
 try{
 if((await client.account()).accountId!==accountId)throw Error("Account changed");
 const snapshot=await client.positions();
 if(!Array.isArray(snapshot?.positions)||snapshot.positions.some(x=>typeof x?.position?.dealId!=="string"||!x.position.dealId)||new Set(snapshot.positions.map(x=>x.position.dealId)).size!==snapshot.positions.length)throw Error("Invalid snapshot");
 if((await client.account()).accountId!==accountId)throw Error("Account changed");
 positions=snapshot.positions;
 }catch{throw Error("Unresolved close; manual reconciliation required");}
 let blocked=false;
 for(const {key,lock,record} of pending){
 const live=positions.find(x=>x.position.dealId===lock.dealId);
 if(live){
 if(live.market?.epic!==record.epic||live.position.direction!==record.direction)throw Error("Unresolved close; manual reconciliation required");
 if(record.epic===epic)blocked=true;
 continue;
 }
 if(record.status==="confirmed")await transitionOrder(storage,key.slice(6),"closed");
 await storage.delete(key);
 console.info("close.auto-resolved",{symbol:record.epic,signal_id:key.slice("close:order:".length)});
 }
 if(blocked)throw Error("Unresolved close; manual reconciliation required");
}
