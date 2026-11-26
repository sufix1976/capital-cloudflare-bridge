import {dispatchStrategy} from "./strategy-dispatch.js";
import {normalizeTV} from "./tv-webhook.js";
import {resolveUncertainOrder} from "./order-resolution.js";
import {executeDemoOrder} from "./order-coordinator.js";
import {connectDemo,allowedTrailDeal} from "./capital.js";
import {isManagedDeal} from "./order-adoption.js";
import {reconcileClosedOrders} from "./order-reconcile.js";
import {maintainJournal} from "./order-journal.js";
import {previewTrail} from "./trail-preview.js";
export function meetsStep(next,step){return next.update&&Number.isFinite(step)&&step>0&&Math.abs(next.stopLevel-next.previousStop)+1e-9>=step;}
export class TrailMonitor {
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.queue=Promise.resolve();this.client=null;this.clientSince=0;this.logins=0;this.lastRequest=0;this.apiCalls=0;}
 async broker(){if(!this.client||Date.now()-this.clientSince>=480000){this.client=await connectDemo(this.env,async (...args)=>{const wait=Math.max(0,250-(Date.now()-this.lastRequest));if(wait)await new Promise(r=>setTimeout(r,wait));this.lastRequest=Date.now();this.apiCalls++;const response=await fetch(...args);if(response.ok)this.clientSince=Date.now();return response;},async dealId=>{const state=await this.ctx.storage.get("state");const item=state?.positions?.find(x=>x.active&&x.data.dealId===dealId);return isManagedDeal(this.ctx.storage,item);});this.clientSince=Date.now();this.logins++;}return this.client;}
 serial(fn){const next=this.queue.then(fn,fn);this.queue=next.catch(()=>{});return next;}
 enabled(){return this.env.TRADING_MODE==="DEMO"&&this.env.TRAIL_WRITE_ENABLED==="true";}
 async scheduleMaintenance(){const alarm=await this.ctx.storage.getAlarm();if(alarm==null)await this.ctx.storage.setAlarm(Date.now()+86400000);}
 async maintenance(){const day=new Date().toISOString().slice(0,10);if(await this.ctx.storage.get("reconcile-day")===day)return;const client=await this.broker();const before=await client.account();const snapshot=await client.positions();const after=await client.account();if(!before.accountId||before.accountId!==after.accountId)throw Error("Account changed");await reconcileClosedOrders(this.ctx.storage,snapshot,before.accountId);await maintainJournal(this.ctx.storage);await this.ctx.storage.put("reconcile-day",day);}
 async enqueueTV(request){
 const data=normalizeTV(await request.json()),storage=this.ctx.storage,key="tv:"+data.signal_id;
 const duplicate=await storage.transaction(async tx=>{
 if(await tx.get(key))return true;
 const pending=await tx.list({prefix:"tv-pending:",limit:21});
 if(pending.size>=20)throw Error("Inbox full");
 await tx.put(key,{status:"queued",createdAt:Date.now()});
 await tx.put("tv-pending:"+String(Date.now()).padStart(13,"0")+":"+data.signal_id,data);
 return false;
 });
 const alarm=await storage.getAlarm();if(alarm==null||alarm>Date.now()+100)await storage.setAlarm(Date.now()+100);
 return Response.json({accepted:true,duplicate,signal_id:data.signal_id},{status:202});
 }
 async processTV(){
 const storage=this.ctx.storage,pending=await storage.list({prefix:"tv-pending:",limit:1});
 for(const [key,data] of pending){
 const id="tv:"+data.signal_id;
 await storage.transaction(async tx=>{await tx.put(id,{status:"processing",createdAt:Date.now()});await tx.delete(key);});
 let status="blocked";
 try{
 if(this.env.TV_WEBHOOK_ENABLED==="true"&&this.env.ORDER_WRITE_ENABLED==="true"&&this.env.TRADING_MODE==="DEMO"){
 normalizeTV(data);
 await storage.put("maintenance-enabled",true);
 const result=await dispatchStrategy(storage,await this.broker(),this.env,data);
 status=result.error?"uncertain":result.record?.status==="rejected"?"rejected":"completed";
 }
 }catch{status="uncertain";}
 await storage.put(id,{status,finishedAt:Date.now()});
 }
 }
 async scheduleTV(){const storage=this.ctx.storage;if((await storage.list({prefix:"tv-pending:",limit:1})).size){const alarm=await storage.getAlarm();if(alarm==null||alarm>Date.now()+100)await storage.setAlarm(Date.now()+100);}}
 fetch(request){return this.serial(async()=>{
 const path=new URL(request.url).pathname,reply=(v,status=200)=>Response.json(v,{status});
 if(path==="/tv-inbox"){
 if(this.env.TV_WEBHOOK_ENABLED!=="true"||this.env.ORDER_WRITE_ENABLED!=="true"||this.env.TRADING_MODE!=="DEMO")return reply({error:"Webhook disabled"},403);
 try{return await this.enqueueTV(request);}catch{return reply({error:"Inbox unavailable"},503);}
 }
 if(path==="/order-resolve"){
 if(this.env.TRADING_MODE!=="DEMO")return reply({error:"DEMO required"},403);
 try{
 const data=await request.json();
 if(data.confirm!==true)return reply({error:"Explicit confirmation required"},403);
 return reply(await resolveUncertainOrder(this.ctx.storage,await this.broker(),data));
 }catch(e){const message=String(e?.message??"");const safe=/^(Invalid request|No recoverable reference|Account mismatch|Account changed|Still uncertain|Position not verified|Invalid order transition|Confirmation lookup: Broker read HTTP \d{3}|Position lookup: Broker read HTTP \d{3}|Broker read HTTP \d{3}|Login HTTP \d{3})$/.test(message)?message:"Unexpected resolution error";return reply({error:"Resolution blocked; order remains uncertain",detail:safe},409);}
 }
 if(path==="/trade"){
 if(this.env.TRADING_MODE!=="DEMO"||this.env.ORDER_WRITE_ENABLED!=="true")return reply({error:"Order disabled"},403);
 try{
 const data=await request.json();
 if(data.confirm!==true)return reply({error:"Explicit confirmation required"},403);
 await this.ctx.storage.put("maintenance-enabled",true);await this.scheduleMaintenance();
 const result=await executeDemoOrder(this.ctx.storage,await this.broker(),this.env,data);
 return reply(result,result.error?409:200);
 }catch{return reply({error:"Order blocked or outcome uncertain; check broker before retrying"},409);}
 }
 if(path==="/trail-status")return reply(await this.ctx.storage.get("state")??{active:false});
 if(path==="/trail-stop"){await this.ctx.storage.put("state",{active:false,reason:"manual stop"});await this.ctx.storage.deleteAlarm();if(await this.ctx.storage.get("maintenance-enabled"))await this.scheduleMaintenance();return reply({active:false});}
 if(["/trail-add","/trail-remove","/trail-config"].includes(path)){
 try{
 const d=await request.json(),state=await this.ctx.storage.get("state");
 if(!this.enabled()||d.confirm!==true)return reply({error:"Not enabled"},403);
 if(!state?.active||!Array.isArray(state.positions)||(state.expires!=null&&Date.now()>=state.expires))return reply({error:"No active test"},409);
 const item=state.positions.find(x=>x.active&&x.data.dealId===d.dealId);
 if(path==="/trail-remove"){
 if(!item)return reply({error:"Position not monitored"},404);
 item.active=false;item.reason="manual removal";
 }else{
 if(!allowedTrailDeal(this.env,d.dealId))return reply({error:"Unauthorized deal"},403);
 if(path==="/trail-add"&&(item||state.positions.filter(x=>x.active).length>=3))return reply({error:"Duplicate or test limit reached"},409);
 if(path==="/trail-config"&&!item)return reply({error:"Position not monitored"},404);
 const data=path==="/trail-config"?{...item.data,distance:d.distance??item.data.distance,step:d.step??item.data.step}:{symbol:d.symbol,dealId:d.dealId,direction:d.direction,distance:d.distance,step:d.step??0.5};
 if(!Number.isFinite(data.step)||data.step<=0)return reply({error:"Invalid step"},400);
 await previewTrail(await this.broker(),data);
 if((state.expires!=null&&Date.now()>=state.expires))return reply({error:"Test expired"},409);
 if(item)item.data=data;else {state.positions=state.positions.filter(x=>x.active);state.positions.push({data,active:true,checks:0,updates:0});}
 }
 state.active=state.positions.some(x=>x.active);
 await this.ctx.storage.put("state",state);
 if(!state.active)await this.ctx.storage.deleteAlarm();if(await this.ctx.storage.get("maintenance-enabled"))await this.scheduleMaintenance();
 return reply(state);
 }catch{return reply({error:"Position management validation failed"},409);}
 }
 if(path!=="/trail-start")return reply({error:"Not found"},404);
 let stage="request",symbol=null;
 try{
 const d=await request.json(),items=d.positions??[d];
 if(!this.enabled()||d.confirm!==true)return reply({error:"Not enabled"},403);
 if(!Array.isArray(items)||items.length<1||items.length>3||new Set(items.map(x=>x.dealId)).size!==items.length||items.some(x=>!allowedTrailDeal(this.env,x.dealId)||!Number.isFinite(x.step??0.5)||(x.step??0.5)<=0))return reply({error:"Invalid or unauthorized positions"},400);
 const old=await this.ctx.storage.get("state");
 if(old?.active&&(old.expires==null||Date.now()<old.expires))return reply({error:"Already active"},409);
 stage="login";const client=await this.broker();stage="positions";const snapshot=await client.positions(),positions=[];
 for(const x of items){stage="position-validation";symbol=typeof x.symbol==="string"&&/^[A-Z0-9_]{1,20}$/.test(x.symbol)?x.symbol:null;const data={symbol:x.symbol,dealId:x.dealId,direction:x.direction,distance:x.distance,step:x.step??0.5};await previewTrail(client,data,snapshot);positions.push({data,active:true,checks:0,updates:0});}
 stage="storage";const state={active:true,positions,expires:null,startedAt:Date.now(),checks:0};
 await this.ctx.storage.put("state",state);await this.ctx.storage.setAlarm(Date.now()+5000);return reply(state);
 }catch(e){const message=String(e?.message??"");const detail=/^(Login HTTP \d{3}|Broker read HTTP \d{3}|Invalid position identity|Position not uniquely matched|Market metadata not verified|Invalid trailing inputs|Invalid stop distance|EPIC mismatch|Missing tokens|Missing configuration)$/.test(message)?message:"Unexpected validation or storage error";return reply({error:"Start validation failed",stage,symbol,detail},409);}
 });}
 alarm(){return this.serial(async()=>{
 try{
 await this.processTV();
 const maintenance=await this.ctx.storage.get("maintenance-enabled");
 if(maintenance&&this.env.TRADING_MODE==="DEMO"){try{await this.maintenance();}catch{this.client=null;this.clientSince=0;}}
 const state=await this.ctx.storage.get("state");if(!state?.active){if(maintenance)await this.ctx.storage.setAlarm(Date.now()+86400000);return;}
 try{
 if(!Array.isArray(state.positions)||(state.expires!=null&&Date.now()>=state.expires)||!this.enabled()){state.active=false;state.reason="expired, legacy state or disabled";}
 else{
 const client=await this.broker(),snapshot=await client.positions();
 if(!Array.isArray(snapshot.positions))throw Error("Invalid positions");
 await maintainJournal(this.ctx.storage);
 state.checks++;
 const day=new Date().toISOString().slice(0,10);const usage=await this.ctx.storage.get("usage")??{};const count=usage.day===day?(usage.cycles??0)+1:1;await this.ctx.storage.put("usage",{day,cycles:count});state.dailyCycles=count;state.usageWarning=count>=18000?"Monitor cycle budget reached":null;if(count>=20000)throw Error("Daily cycle budget reached");
 for(const item of state.positions){
 if(!item.active)continue;
 if((state.expires!=null&&Date.now()>=state.expires)||(!allowedTrailDeal(this.env,item.data.dealId)&&!(await isManagedDeal(this.ctx.storage,item)))){item.active=false;item.reason="expired or disabled";continue;}
 if(!snapshot.positions.some(x=>x.position?.dealId===item.data.dealId)){item.active=false;item.reason="position absent";continue;}
 let writing=false;
 try{
 const next=await previewTrail(client,item.data,snapshot);
 item.checks++;item.lastStop=next.previousStop;item.lastCandidate=next.stopLevel;item.lastImprovement=Number(Math.abs(next.stopLevel-next.previousStop).toFixed(8));
 if(meetsStep(next,item.data.step)){
 const fresh=await previewTrail(client,item.data);
 if((state.expires==null||Date.now()<state.expires)&&meetsStep(fresh,item.data.step)){writing=true;item.lastStop=await client.updateStop(fresh.dealId,fresh.stopLevel);item.lastVerified=Date.now();item.updates++;}
 }
 }catch(e){if(writing||/^Broker read HTTP|^Login HTTP/.test(String(e?.message??"")))throw e;item.active=false;item.reason="Position validation failed; check broker";}
 }
 state.active=state.positions.some(x=>x.active)&&(state.expires==null||Date.now()<state.expires);
 state.lastCheck=Date.now();state.sessionLoginsSinceInstanceStart=this.logins;state.apiCallsSinceInstanceStart=this.apiCalls;
 }
 }catch{this.client=null;this.clientSince=0;state.active=false;state.reason=state.dailyCycles>=20000?"Daily cycle budget reached":"Broker or validation error; check broker before restarting";}
 await this.ctx.storage.put("state",state);if(state.active)await this.ctx.storage.setAlarm(Date.now()+5000);else if(maintenance)await this.ctx.storage.setAlarm(Date.now()+86400000);
 }finally{await this.scheduleTV();}
 });}
}
