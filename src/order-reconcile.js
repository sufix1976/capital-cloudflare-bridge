import {transitionOrder} from "./order-journal.js";
// Only use a complete successful broker positions snapshot from the same account.
export async function reconcileClosedOrders(storage,snapshot,now=Date.now()){
 if(!Array.isArray(snapshot?.positions)||snapshot.positions.some(x=>typeof x?.position?.dealId!=="string"||!x.position.dealId))throw Error("Invalid positions snapshot");
 const ids=new Set(snapshot.positions.map(x=>x.position.dealId));
 let startAfter,closed=0;
 for(;;){
 const page=await storage.list({prefix:"order:",limit:128,...(startAfter?{startAfter}:{})});
 if(!page.size)break;
 for(const [key,record] of page){
 startAfter=key;
 if(record.status==="confirmed"&&record.dealId&&!ids.has(record.dealId)){
 await transitionOrder(storage,key,"closed",{},now);closed++;
 }
 }
 if(page.size<128)break;
 }
 return closed;
}
