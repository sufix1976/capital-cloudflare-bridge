import {previewOrder} from "./preview.js";
import {reserveOrder,transitionOrder,maintainJournal} from "./order-journal.js";
import {resolveInstrument} from "./instruments.js";
// Must run inside the monitor's serialized queue.
export async function executeDemoOrder(storage,client,env,data){
 if(env.TRADING_MODE!=="DEMO"||env.ORDER_WRITE_ENABLED!=="true"||data.confirm!==true)throw Error("Order disabled");
 const epic=resolveInstrument(data.symbol);
 if(!epic)throw Error("Invalid instrument");
 await maintainJournal(storage);
 const reservation=await reserveOrder(storage,data.signal_id,data.issued_at,epic);
 const {key}=reservation;
 if(reservation.duplicate)return {duplicate:true,record:reservation.record};
 let preview;
 try{
 preview=await previewOrder(client,data,env.BROKER_TIMEZONE);
 if(preview.payload.trailingStop!==false||!Number.isFinite(preview.payload.stopDistance))throw Error("Protective stop required");
 // Managed trailing must not be silently ignored before adoption is wired.
 if(preview.managedTrailing)throw Error("Managed trailing adoption not yet enabled");
 }catch(e){
 await transitionOrder(storage,key,"cancelled-before-submit");
 throw e;
 }
 await transitionOrder(storage,key,"submitting");
 let reference;
 try{
 reference=await client.submitOrder(preview.payload);
 // Persist reference before requesting confirmation.
 await transitionOrder(storage,key,"uncertain",{dealReference:reference});
 const confirmation=await client.confirmOrder(reference);
 if(confirmation.dealStatus==="REJECTED"){
 return {record:await transitionOrder(storage,key,"rejected")};
 }
 if(confirmation.dealStatus!=="ACCEPTED"||typeof confirmation.dealId!=="string"||!confirmation.dealId)throw Error("Confirmation uncertain");
 const dealId=confirmation.dealId;
 const result=await client.readPosition(dealId);
 const p=result.position,m=result.market;
 if(p?.dealId!==dealId||m?.epic!==epic||p.direction!==preview.payload.direction||Math.abs(p.size-preview.payload.size)>1e-8||!Number.isFinite(p.size)||!Number.isFinite(p.level)||!Number.isFinite(p.stopLevel)||p.stopLevel<=0)throw Error("Position verification failed");
 const distance=p.direction==="BUY"?p.level-p.stopLevel:p.stopLevel-p.level;
 if(distance<=0||distance>preview.payload.stopDistance+1e-8)throw Error("Protective stop verification failed");
 return {record:await transitionOrder(storage,key,"confirmed",{dealId}),stopLevel:p.stopLevel,size:p.size};
 }catch{
 const current=await storage.get(key);
 if(current?.status==="submitting")await transitionOrder(storage,key,"uncertain",reference?{dealReference:reference}:{});
 return {error:"Order outcome uncertain; reconcile with broker before any retry",record:await storage.get(key)};
 }
}
