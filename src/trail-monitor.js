import {connectDemo} from "./capital.js";
import {previewTrail} from "./trail-preview.js";
export class TrailMonitor {
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.queue=Promise.resolve();}
 serial(fn){const next=this.queue.then(fn,fn);this.queue=next.catch(()=>{});return next;}
 fetch(request){return this.serial(async()=>{
 const path=new URL(request.url).pathname;
 const reply=(v,status=200)=>Response.json(v,{status});
 if(path==="/trail-status")return reply(await this.ctx.storage.get("state")??{active:false});
 if(path==="/trail-stop"){await this.ctx.storage.put("state",{active:false,reason:"manual stop"});await this.ctx.storage.deleteAlarm();return reply({active:false});}
 if(path!=="/trail-start")return reply({error:"Not found"},404);
 const d=await request.json();
 if(this.env.TRADING_MODE!=="DEMO"||this.env.TRAIL_WRITE_ENABLED!=="true"||this.env.TRAIL_TEST_DEAL_ID!==d.dealId||d.confirm!==true)return reply({error:"Not enabled"},403);
 if((await this.ctx.storage.get("state"))?.active)return reply({error:"Already active"},409);
 const client=await connectDemo(this.env);
 await previewTrail(client,d);
 const state={active:true,data:{symbol:d.symbol,dealId:d.dealId,direction:d.direction,distance:d.distance},expires:Date.now()+300000,checks:0};
 await this.ctx.storage.put("state",state);await this.ctx.storage.setAlarm(Date.now()+5000);return reply(state);
 });}
 alarm(){return this.serial(async()=>{
 const state=await this.ctx.storage.get("state");
 if(!state?.active)return;
 try{
 if(Date.now()>=state.expires||this.env.TRADING_MODE!=="DEMO"||this.env.TRAIL_WRITE_ENABLED!=="true"||this.env.TRAIL_TEST_DEAL_ID!==state.data.dealId){state.active=false;state.reason="expired or disabled";}
 else{
 const client=await connectDemo(this.env);
 const next=await previewTrail(client,state.data);
 state.checks++;state.lastCheck=Date.now();state.lastStop=next.stopLevel;
 if(next.update){await client.updateStop(next.dealId,next.stopLevel);state.lastVerified=Date.now();}
 }
 }catch{state.active=false;state.reason="Broker or validation error; check broker before restarting";}
 await this.ctx.storage.put("state",state);
 if(state.active)await this.ctx.storage.setAlarm(Date.now()+5000);
 });}
}
