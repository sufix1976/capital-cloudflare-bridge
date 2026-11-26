import {connectDemo} from "./capital.js";
import {previewTrail} from "./trail-preview.js";
export function meetsStep(next,step){return next.update&&Number.isFinite(step)&&step>0&&Number(Math.abs(next.stopLevel-next.previousStop).toPrecision(12))>=step;}
export class TrailMonitor {
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.queue=Promise.resolve();this.client=null;this.clientSince=0;}
 async broker(){if(!this.client||Date.now()-this.clientSince>=300000){this.client=await connectDemo(this.env);this.clientSince=Date.now();}return this.client;}
 serial(fn){const next=this.queue.then(fn,fn);this.queue=next.catch(()=>{});return next;}
 fetch(request){return this.serial(async()=>{
 const path=new URL(request.url).pathname;
 const reply=(v,status=200)=>Response.json(v,{status});
 if(path==="/trail-status")return reply(await this.ctx.storage.get("state")??{active:false});
 if(path==="/trail-stop"){await this.ctx.storage.put("state",{active:false,reason:"manual stop"});await this.ctx.storage.deleteAlarm();return reply({active:false});}
 if(path!=="/trail-start")return reply({error:"Not found"},404);
 const d=await request.json();
 const step=d.step??0.5;
 if(!Number.isFinite(step)||step<=0)return reply({error:"Invalid trailing step"},400);
 if(this.env.TRADING_MODE!=="DEMO"||this.env.TRAIL_WRITE_ENABLED!=="true"||this.env.TRAIL_TEST_DEAL_ID!==d.dealId||d.confirm!==true)return reply({error:"Not enabled"},403);
 if((await this.ctx.storage.get("state"))?.active)return reply({error:"Already active"},409);
 const client=await this.broker();
 await previewTrail(client,d);
 const state={active:true,data:{symbol:d.symbol,dealId:d.dealId,direction:d.direction,distance:d.distance,step},expires:Date.now()+300000,checks:0};
 await this.ctx.storage.put("state",state);await this.ctx.storage.setAlarm(Date.now()+5000);return reply(state);
 });}
 alarm(){return this.serial(async()=>{
 const state=await this.ctx.storage.get("state");
 if(!state?.active)return;
 try{
 if(Date.now()>=state.expires||this.env.TRADING_MODE!=="DEMO"||this.env.TRAIL_WRITE_ENABLED!=="true"||this.env.TRAIL_TEST_DEAL_ID!==state.data.dealId){state.active=false;state.reason="expired or disabled";}
 else{
 const client=await this.broker();
 const next=await previewTrail(client,state.data);
 state.checks++;state.lastCheck=Date.now();state.lastStop=next.previousStop;state.lastCandidate=next.stopLevel;state.lastImprovement=Number(Math.abs(next.stopLevel-next.previousStop).toPrecision(12));
 if(meetsStep(next,state.data.step??0.5)){state.lastStop=await client.updateStop(next.dealId,next.stopLevel);state.lastVerified=Date.now();state.updates=(state.updates??0)+1;}
 }
 }catch{this.client=null;this.clientSince=0;state.active=false;state.reason="Broker or validation error; check broker before restarting";}
 await this.ctx.storage.put("state",state);
 if(state.active)await this.ctx.storage.setAlarm(Date.now()+5000);
 });}
}
