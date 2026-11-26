import {connectDemo,allowedTrailDeal} from "./capital.js";
import {previewTrail} from "./trail-preview.js";
export function meetsStep(next,step){return next.update&&Number.isFinite(step)&&step>0&&Math.abs(next.stopLevel-next.previousStop)+1e-9>=step;}
export class TrailMonitor {
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.queue=Promise.resolve();this.client=null;this.clientSince=0;this.logins=0;}
 async broker(){if(!this.client||Date.now()-this.clientSince>=300000){this.client=await connectDemo(this.env);this.clientSince=Date.now();this.logins++;}return this.client;}
 serial(fn){const next=this.queue.then(fn,fn);this.queue=next.catch(()=>{});return next;}
 enabled(){return this.env.TRADING_MODE==="DEMO"&&this.env.TRAIL_WRITE_ENABLED==="true";}
 fetch(request){return this.serial(async()=>{
 const path=new URL(request.url).pathname,reply=(v,status=200)=>Response.json(v,{status});
 if(path==="/trail-status")return reply(await this.ctx.storage.get("state")??{active:false});
 if(path==="/trail-stop"){await this.ctx.storage.put("state",{active:false,reason:"manual stop"});await this.ctx.storage.deleteAlarm();return reply({active:false});}
 if(path!=="/trail-start")return reply({error:"Not found"},404);
 let stage="request",symbol=null;
 try{
 const d=await request.json(),items=d.positions??[d];
 if(!this.enabled()||d.confirm!==true)return reply({error:"Not enabled"},403);
 if(!Array.isArray(items)||items.length<1||items.length>3||new Set(items.map(x=>x.dealId)).size!==items.length||items.some(x=>!allowedTrailDeal(this.env,x.dealId)||!Number.isFinite(x.step??0.5)||(x.step??0.5)<=0))return reply({error:"Invalid or unauthorized positions"},400);
 const old=await this.ctx.storage.get("state");
 if(old?.active&&Date.now()<old.expires)return reply({error:"Already active"},409);
 stage="login";const client=await this.broker();stage="positions";const snapshot=await client.positions(),positions=[];
 for(const x of items){stage="position-validation";symbol=typeof x.symbol==="string"&&/^[A-Z0-9_]{1,20}$/.test(x.symbol)?x.symbol:null;const data={symbol:x.symbol,dealId:x.dealId,direction:x.direction,distance:x.distance,step:x.step??0.5};await previewTrail(client,data,snapshot);positions.push({data,active:true,checks:0,updates:0});}
 stage="storage";const state={active:true,positions,expires:Date.now()+300000,checks:0};
 await this.ctx.storage.put("state",state);await this.ctx.storage.setAlarm(Date.now()+5000);return reply(state);
 }catch(e){const message=String(e?.message??"");const detail=/^(Login HTTP \d{3}|Broker read HTTP \d{3}|Invalid position identity|Position not uniquely matched|Market metadata not verified|Invalid trailing inputs|Invalid stop distance|EPIC mismatch|Missing tokens|Missing configuration)$/.test(message)?message:"Unexpected validation or storage error";return reply({error:"Start validation failed",stage,symbol,detail},409);}
 });}
 alarm(){return this.serial(async()=>{
 const state=await this.ctx.storage.get("state");if(!state?.active)return;
 try{
 if(!Array.isArray(state.positions)||Date.now()>=state.expires||!this.enabled()){state.active=false;state.reason="expired, legacy state or disabled";}
 else{
 const client=await this.broker(),snapshot=await client.positions();
 if(!Array.isArray(snapshot.positions))throw Error("Invalid positions");
 state.checks++;
 for(const item of state.positions){
 if(!item.active)continue;
 if(Date.now()>=state.expires||!allowedTrailDeal(this.env,item.data.dealId)){item.active=false;item.reason="expired or disabled";continue;}
 if(!snapshot.positions.some(x=>x.position?.dealId===item.data.dealId)){item.active=false;item.reason="position absent";continue;}
 const next=await previewTrail(client,item.data,snapshot);
 item.checks++;item.lastStop=next.previousStop;item.lastCandidate=next.stopLevel;item.lastImprovement=Number(Math.abs(next.stopLevel-next.previousStop).toFixed(8));
 if(meetsStep(next,item.data.step)){
 const fresh=await previewTrail(client,item.data);
 if(Date.now()<state.expires&&meetsStep(fresh,item.data.step)){item.lastStop=await client.updateStop(fresh.dealId,fresh.stopLevel);item.lastVerified=Date.now();item.updates++;}
 }
 }
 state.active=state.positions.some(x=>x.active)&&Date.now()<state.expires;
 state.lastCheck=Date.now();state.sessionLoginsSinceInstanceStart=this.logins;
 }
 }catch{this.client=null;this.clientSince=0;state.active=false;state.reason="Broker or validation error; check broker before restarting";}
 await this.ctx.storage.put("state",state);if(state.active)await this.ctx.storage.setAlarm(Date.now()+5000);
 });}
}
