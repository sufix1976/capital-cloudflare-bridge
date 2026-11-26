import {previewTrail} from "./trail-preview.js";
// Internal helper only. Never expose as a public deal-ID registration endpoint.
export async function adoptConfirmedOrder(storage,client,key,config){
 const record=await storage.get(key);
 if(!record||record.status!=="confirmed"||!record.dealId)throw Error("Confirmed order required");
 const state=await storage.get("state")??{active:false,positions:[],checks:0,expires:null};
 const positions=(state.positions??[]).filter(x=>x.active);
 if(positions.some(x=>x.data.dealId===record.dealId))return state;
 if(positions.length>=3)throw Error("Monitor capacity reached");
 if(!Number.isFinite(config.distance)||config.distance<=0||!Number.isFinite(config.step)||config.step<=0)throw Error("Invalid trailing configuration");
 const data={symbol:record.epic,dealId:record.dealId,direction:config.direction,distance:config.distance,step:config.step};
 await previewTrail(client,data);
 const next={...state,active:true,expires:null,positions:[...positions,{data,orderKey:key,active:true,checks:0,updates:0}]};
 await storage.put("state",next);
 await storage.setAlarm(Date.now()+5000);
 return next;
}
export async function isManagedDeal(storage,item){
 if(typeof item?.orderKey!=="string"||!item.orderKey.startsWith("order:"))return false;
 const record=await storage.get(item.orderKey);
 return record?.status==="confirmed"&&record.dealId===item.data?.dealId;
}
