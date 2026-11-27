import {transitionOrder} from "./order-journal.js";
export async function resolveUncertainOrder(storage,client,data){
 if(data.confirm!==true||typeof data.signal_id!=="string"||!/^[A-Za-z0-9_.:-]{1,160}$/.test(data.signal_id))throw Error("Invalid request");
 const key="order:"+data.signal_id,record=await storage.get(key);
 if(data.manual_no_reference===true){
 if(data.history_verified!==true||data.diagnostic===true||!record||!["uncertain","submitting"].includes(record.status)||!record.accountId||!record.epic||record.dealReference||record.dealId)throw Error("Manual reconciliation prerequisites missing");
 if((await client.account()).accountId!==record.accountId)throw Error("Account mismatch");
 const snapshot=await client.positions();
 if(!Array.isArray(snapshot?.positions)||snapshot.positions.some(x=>typeof x?.position?.dealId!=="string"||!x.position.dealId||typeof x?.market?.epic!=="string"||!x.market.epic)||new Set(snapshot.positions.map(x=>x.position.dealId)).size!==snapshot.positions.length)throw Error("Invalid positions snapshot");
 if((await client.account()).accountId!==record.accountId)throw Error("Account changed");
 if(snapshot.positions.some(x=>x.market.epic===record.epic)||await storage.get("close:"+key))throw Error("Position or close lock present");
 return {resolved:true,manual:true,record:await transitionOrder(storage,key,"manually-reconciled")};
 }
 if(!record||!["uncertain","submitting"].includes(record.status)||!record.accountId||!record.dealReference)throw Error("No recoverable reference");
 if((await client.account()).accountId!==record.accountId)throw Error("Account mismatch");
 const confirmation=await client.confirmOrder(record.dealReference).catch(e=>{throw Error('Confirmation lookup: '+e.message);});
 if(confirmation.dealStatus==="REJECTED"){
 if((await client.account()).accountId!==record.accountId)throw Error("Account changed");
 return {record:await transitionOrder(storage,key,"rejected")};
 }
 if(confirmation.dealStatus!=="ACCEPTED"||typeof confirmation.dealId!=="string"||!confirmation.dealId)throw Error("Still uncertain");
 if(data.diagnostic===true){
 const snapshot=await client.positions();
 if(!Array.isArray(snapshot.positions))throw Error("Invalid positions snapshot");
 if((await client.account()).accountId!==record.accountId)throw Error("Account changed");
 return {diagnostic:true,dealId:confirmation.dealId,affectedDeals:Array.isArray(confirmation.affectedDeals)?confirmation.affectedDeals.map(x=>({dealId:x.dealId,status:x.status})):[],positions:snapshot.positions.filter(x=>x.market?.epic===record.epic).map(x=>({dealId:x.position?.dealId,size:x.position?.size,direction:x.position?.direction,stopLevel:x.position?.stopLevel}))};
 }
 const opened=confirmation.affectedDeals?.filter(x=>x.status==="OPENED")??[];
 if(opened.length!==1||typeof opened[0].dealId!=="string"||!opened[0].dealId)throw Error("Unique opened deal required");
 const dealId=opened[0].dealId;
 const result=await client.readPosition(dealId).catch(e=>{throw Error('Position lookup: '+e.message);}),p=result.position;
 if(p?.dealId!==dealId||result.market?.epic!==record.epic||!Number.isFinite(p.stopLevel)||p.stopLevel<=0)throw Error("Position not verified");
 if((await client.account()).accountId!==record.accountId)throw Error("Account changed");
 return {record:await transitionOrder(storage,key,"confirmed",{dealId:p.dealId}),warning:"Check position and protective stop manually; trailing not automatically resumed"};
}
