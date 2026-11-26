// Storage helpers for the serialized order coordinator. No broker writes.
export const RETENTION_MS=48*60*60*1000;
export const SIGNAL_MAX_AGE_MS=5*60*1000;
export function validateSignal(id,issuedAt,now=Date.now()){
 if(typeof id!=="string"||!/^[A-Za-z0-9_.:-]{1,160}$/.test(id))throw Error("Invalid signal ID");
 if(!Number.isSafeInteger(issuedAt)||issuedAt>now||now-issuedAt>SIGNAL_MAX_AGE_MS)throw Error("Invalid or stale signal timestamp");
 return "order:"+id;
}
export function canDeleteOrder(record,now=Date.now()){
 return !!record&&["closed","rejected","cancelled-before-submit"].includes(record.status)&&Number.isSafeInteger(record.finishedAt)&&now-record.finishedAt>=RETENTION_MS;
}
export async function pruneOrders(storage,now=Date.now()){
 let startAfter,removed=0;
 for(;;){
 const page=await storage.list({prefix:"order:",limit:128,...(startAfter?{startAfter}:{})});
 if(!page.size)break;
 for(const [key,record] of page){if(canDeleteOrder(record,now)){await storage.delete(key);removed++;}startAfter=key;}
 if(page.size<128)break;
 }
 return removed;
}

export async function pruneSignalRecords(storage,now=Date.now()){
 let removed=0;
 for(const prefix of ["tv:","dispatch:","exit:"]){
 let cursor;
 for(;;){
 const page=await storage.list({prefix,limit:128,...(cursor?{startAfter:cursor}:{})});
 for(const [key,r] of page){
 cursor=key;
 if(["completed","rejected","blocked"].includes(r.status)&&Number.isSafeInteger(r.finishedAt)&&now-r.finishedAt>=RETENTION_MS){await storage.delete(key);removed++;}
 }
 if(page.size<128)break;
 }
 }
 return removed;
}
