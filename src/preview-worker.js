export {TrailMonitor} from "./trail-monitor.js";
import {previewTrail} from "./trail-preview.js";
import {connectDemo} from "./capital.js";
import {previewOrder} from "./preview.js";
import {resolveInstrument} from "./instruments.js";
function reply(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});}
export default {async fetch(request,env){
 const path=new URL(request.url).pathname;
 if(path==="/"&&request.method==="GET")return reply({mode:"demo-gated",version:"preview-v14.3"});
 if(request.method!=="POST"||!["/order-resolve","/trade","/trade-preview","/market-check","/trail-preview","/positions","/trail-update","/trail-start","/trail-stop","/trail-status","/trail-add","/trail-remove","/trail-config"].includes(path))return reply({error:"Not found"},404);
 if(!env.BRIDGE_ACCESS_TOKEN||request.headers.get("Authorization")!=="Bearer "+env.BRIDGE_ACCESS_TOKEN)return reply({error:"Unauthorized"},401);
 if(env.TRADING_MODE!=="DEMO")return reply({error:"DEMO required"},403);
 if(path==="/trade"&&env.ORDER_WRITE_ENABLED!=="true")return reply({error:"Order disabled"},403);
 if(["/order-resolve","/trade","/trail-start","/trail-stop","/trail-status","/trail-add","/trail-remove","/trail-config"].includes(path)){
 if(!env.TRAIL_MONITOR)return reply({error:"Monitor binding missing"},503);
 return env.TRAIL_MONITOR.get(env.TRAIL_MONITOR.idFromName("demo-single")).fetch(request);
 }
 if(path==="/trail-update")return reply({error:"Manual writes disabled in monitor version"},403);
 let stage="request";
 try{
 if(path==="/positions"){
 stage="login";
 const client=await connectDemo(env);
 stage="positions";
 const result=await client.positions();
 if(!Array.isArray(result.positions))throw new Error("Invalid positions response");
 return reply({previewOnly:true,positions:result.positions.map(({position:p,market:m})=>({dealId:p.dealId,epic:m.epic,direction:p.direction,size:p.size,entryPrice:p.level,stopLevel:p.stopLevel??null}))});
 }
 const data=await request.json(),epic=resolveInstrument(data.symbol);
 if(!epic)return reply({error:"Unknown instrument"},400);
 if(path==="/trail-update"&&(env.TRAIL_WRITE_ENABLED!=="true"||!env.TRAIL_TEST_DEAL_ID||data.dealId!==env.TRAIL_TEST_DEAL_ID||data.confirm!==true))return reply({error:"Explicit demo stop write not enabled"},403);
 stage="login";
 const client=await connectDemo(env);
 if(path==="/trail-update"){
 stage="trailing";
 const first=await previewTrail(client,data);
 if(!first.update)return reply({...first,updated:false});
 const next=await previewTrail(client,data);
 if(!next.update)return reply({...next,updated:false});
 stage="stop-write";
 const actualStop=await client.updateStop(next.dealId,next.stopLevel);
 return reply({...next,previewOnly:false,updated:true,verified:true,stopLevel:actualStop});
 }
 if(path==="/trail-preview"){stage="trailing";return reply(await previewTrail(client,data));}
 if(path==="/market-check"){
 stage="market";
 const market=await client.market(epic);
 stage="preferences";
 const preferences=await client.preferences();
 return reply({epic,instrument:market.instrument,dealingRules:market.dealingRules,snapshot:market.snapshot,leverages:preferences.leverages??null});
 }
 stage="sizing";
 return reply(await previewOrder(client,data,env.BROKER_TIMEZONE));
 }catch(e){const message=String(e?.message??"");const sizingErrors=new Set(["Invalid symbol or action","Invalid managed trailing flag","Invalid trailing flag","Market not tradeable","Currency or contract conversion not verified","Unknown margin requirements","Invalid quote","Unknown currency","No verified fresh FX quote","Unknown size rule","Invalid equity","Invalid percentage","Invalid marginPerUnit","Invalid minSize","Invalid sizeStep","Invalid maxSize","Invalid available","Invalid sizing limits","Insufficient available margin","No valid size within margin budget","Invalid stop distance","Trailing support not verified","Unknown stop rule","Unknown stop unit","Stop outside broker limits","Invalid managed trailing parameters","Active CFD account not verified","Invalid account data"]);const safe=(stage==="sizing"&&sizingErrors.has(message))||/^(Login HTTP \d{3}|Broker read HTTP \d{3}|Missing configuration|Missing tokens|EPIC mismatch|DEMO required)$/.test(message)?message:"Request or metadata validation failed";return reply({error:stage==="stop-write"?"Stop outcome uncertain: check broker before retrying":"Preview blocked",stage,detail:safe,...(stage==="login"&&typeof e?.brokerCode==="string"&&/^error\.[a-zA-Z0-9_.-]{1,100}$/.test(e.brokerCode)?{brokerCode:e.brokerCode}:{})},409);}
}};
