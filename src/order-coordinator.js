import {reconcileCloseLocks} from "./close-resolution.js";
import {previewOrder} from "./preview.js";
import {reserveOrder,transitionOrder,maintainJournal} from "./order-journal.js";
import {adoptConfirmedOrder} from "./order-adoption.js";
import {reconcileClosedOrders} from "./order-reconcile.js";
import {resolveInstrument} from "./instruments.js";
// Must run inside the monitor's serialized queue.
export async function executeDemoOrder(storage,client,env,data){
 if(env.TRADING_MODE!=="DEMO"||env.ORDER_WRITE_ENABLED!=="true"||data.confirm!==true)throw Error("Order disabled");
 const strategyId=data.strategy_id;
 if(strategyId!==undefined&&(typeof strategyId!=="string"||!/^[A-Za-z0-9_.:-]{1,64}$/.test(strategyId)))throw Error("Invalid strategy ID");
 const epic=resolveInstrument(data.symbol);
 if(!epic)throw Error("Invalid instrument");
 await maintainJournal(storage);
 const reservation=await reserveOrder(storage,data.signal_id,data.issued_at,epic);
 const {key}=reservation;
 if(reservation.duplicate)console.info("order.duplicate",{symbol:epic,signal_id:data.signal_id});
 if(reservation.duplicate)return {duplicate:true,record:reservation.record};
 let preview,accountId;
 try{
 const account=await client.account();
 accountId=account.accountId;
 if(typeof accountId!=="string"||!accountId)throw Error("Account identity required");
 await reconcileCloseLocks(storage,client,accountId,epic);
 if(strategyId){
 const snapshot=await client.positions();
 if((await client.account()).accountId!==accountId)throw Error("Account changed");
 await reconcileClosedOrders(storage,snapshot,accountId);
 const state=await storage.get("state");
 if(state?.positions){
 let changed=false;
 for(const item of state.positions){
 if(!item.active||!item.orderKey)continue;
 const record=await storage.get(item.orderKey);
 if(record?.accountId===accountId&&record.status==="closed"){item.active=false;item.reason="position closed";changed=true;}
 }
 if(changed){state.active=state.positions.some(x=>x.active);await storage.put("state",state);}
 }
 }
 let cursor;
 for(;;){
 const page=await storage.list({prefix:"order:",limit:128,...(cursor?{startAfter:cursor}:{})});
 for(const [id,record] of page){
 cursor=id;
 if(id!==key&&strategyId&&record.strategyId===strategyId&&record.accountId===accountId&&record.epic===epic&&record.status==="confirmed")throw Error("Strategy position already registered; reconcile before entry");
 if(id!==key&&["submitting","uncertain"].includes(record.status)&&(!record.accountId||(record.accountId===accountId&&(!record.epic||record.epic===epic))))throw Error("Unresolved order; manual reconciliation required");
 }
 if(page.size<128)break;
 }
 preview=await previewOrder(client,data,env.BROKER_TIMEZONE);
 console.info("order.sizing",{symbol:epic,signal_id:data.signal_id,size:preview.payload.size,budget:preview.budget,estimatedMargin:preview.estimatedMargin});
 if((await client.account()).accountId!==accountId)throw Error("Account changed");
 if(preview.payload.trailingStop!==false||!Number.isFinite(preview.payload.stopDistance))throw Error("Protective stop required");
 // Managed trailing must not be silently ignored before adoption is wired.
 if(preview.managedTrailing){
 if(env.TRAIL_WRITE_ENABLED!=="true")throw Error("Trailing disabled");
 const state=await storage.get("state");
 if((state?.positions??[]).filter(x=>x.active).length>=3)throw Error("Monitor capacity reached");
 }
 }catch(e){
 console.warn("order.blocked",{symbol:epic,signal_id:data.signal_id,reason:safeReason(e)});
 await transitionOrder(storage,key,"cancelled-before-submit");
 throw e;
 }
 await transitionOrder(storage,key,"submitting",{accountId,strategyId,direction:preview.payload.direction});
 let reference;
 try{
 console.info("order.submit",{symbol:epic,signal_id:data.signal_id});
 reference=await client.submitOrder(preview.payload);
 // Persist reference before requesting confirmation.
 await transitionOrder(storage,key,"uncertain",{dealReference:reference});
 const confirmation=await client.confirmOrder(reference);
 if(confirmation.dealStatus==="REJECTED"){
 console.warn("order.rejected",{symbol:epic,signal_id:data.signal_id});
 return {record:await transitionOrder(storage,key,"rejected")};
 }
 if(confirmation.dealStatus!=="ACCEPTED"||typeof confirmation.dealId!=="string"||!confirmation.dealId)throw Error("Confirmation uncertain");
 if((await client.account()).accountId!==accountId)throw Error("Account changed");
 const opened=confirmation.affectedDeals?.filter(x=>x.status==="OPENED")??[];
 if(confirmation.affectedDeals?.length!==1)throw Error("Unexpected affected deals");
 if(opened.length!==1||typeof opened[0].dealId!=="string"||!opened[0].dealId)throw Error("Unique opened deal required");
 const dealId=opened[0].dealId;
 const result=await client.readPosition(dealId);
 const p=result.position,m=result.market;
 if(p?.dealId!==dealId||m?.epic!==epic||p.direction!==preview.payload.direction||Math.abs(p.size-preview.payload.size)>1e-8||!Number.isFinite(p.size)||!Number.isFinite(p.level)||!Number.isFinite(p.stopLevel)||p.stopLevel<=0)throw Error("Position verification failed");
 const distance=p.direction==="BUY"?p.level-p.stopLevel:p.stopLevel-p.level;
 if(distance<=0||distance>preview.payload.stopDistance+1e-8)throw Error("Protective stop verification failed");
 const record=await transitionOrder(storage,key,"confirmed",{dealId});
 console.info("order.confirmed",{symbol:epic,signal_id:data.signal_id,size:p.size,stopLevel:p.stopLevel});
 if(preview.managedTrailing){
 try{await adoptConfirmedOrder(storage,client,key,{...preview.managedTrailing,direction:p.direction});}
 catch{return {record,stopLevel:p.stopLevel,size:p.size,error:"Position confirmed but trailing adoption failed; check broker"};}
 }
 return {record,stopLevel:p.stopLevel,size:p.size,managedTrailing:!!preview.managedTrailing};
 }catch(e){
 console.warn("order.uncertain",{symbol:epic,signal_id:data.signal_id,reason:safeReason(e)});
 const current=await storage.get(key);
 if(current?.status==="submitting")await transitionOrder(storage,key,"uncertain",reference?{dealReference:reference}:{});
 return {error:"Order outcome uncertain; reconcile with broker before any retry",record:await storage.get(key)};
 }
}

function safeReason(e){const m=String(e?.message??"");return /^(Invalid (equity|available|percentage|marginPerUnit|quote|account data|stop distance|sizing limits)|Unknown (margin requirements|size rule|currency|stop rule|stop unit)|No valid size within margin budget|Insufficient available margin|Stop outside broker limits|Market not tradeable|Currency or contract conversion not verified|No verified fresh FX quote|Monitor capacity reached|Trailing disabled|Account changed|Account identity required|Unresolved (order|close); manual reconciliation required|Strategy position already registered; reconcile before entry|Protective stop required|Hedging mode required|Order outcome requires reconciliation|Confirmation uncertain|Unexpected affected deals|Unique opened deal required|Position verification failed|Protective stop verification failed|Broker read HTTP \d{3}|Login HTTP \d{3})$/.test(m)?m:"Internal or broker failure";}
