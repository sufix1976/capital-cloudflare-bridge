import {transitionOrder} from "./order-journal.js";
export async function resolveUncertainOrder(storage,client,data){
 if(data.confirm!==true||typeof data.signal_id!=="string"||!/^[A-Za-z0-9_.:-]{1,160}$/.test(data.signal_id))throw Error("Invalid request");
 const key="order:"+data.signal_id,record=await storage.get(key);
 if(!record||!["uncertain","submitting"].includes(record.status)||!record.accountId||!record.dealReference)throw Error("No recoverable reference");
 if((await client.account()).accountId!==record.accountId)throw Error("Account mismatch");
 const confirmation=await client.confirmOrder(record.dealReference);
 if(confirmation.dealStatus==="REJECTED"){
 if((await client.account()).accountId!==record.accountId)throw Error("Account changed");
 return {record:await transitionOrder(storage,key,"rejected")};
 }
 if(confirmation.dealStatus!=="ACCEPTED"||typeof confirmation.dealId!=="string"||!confirmation.dealId)throw Error("Still uncertain");
 const result=await client.readPosition(confirmation.dealId),p=result.position;
 if(p?.dealId!==confirmation.dealId||result.market?.epic!==record.epic||!Number.isFinite(p.stopLevel)||p.stopLevel<=0)throw Error("Position not verified");
 if((await client.account()).accountId!==record.accountId)throw Error("Account changed");
 return {record:await transitionOrder(storage,key,"confirmed",{dealId:p.dealId}),warning:"Check position and protective stop manually; trailing not automatically resumed"};
}
