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
