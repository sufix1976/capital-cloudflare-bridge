export {TrailMonitor} from "./trail-monitor.js";
import {authenticateTV,normalizeTV} from "./tv-webhook.js";
import {previewTrail} from "./trail-preview.js";
import {connectDemo} from "./capital.js";
import {previewOrder} from "./preview.js";
import {resolveInstrument} from "./instruments.js";
function reply(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});}
export default {async fetch(request,env){
 const path=new URL(request.url).pathname;
 if(path==="/"&&request.method==="GET")return reply({mode:"demo-gated",version:"preview-v15.12"});
 if(path==="/webhook"&&request.method==="POST"){
 if(env.TRADING_MODE!=="DEMO"||env.TV_WEBHOOK_ENABLED!=="true"||env.ORDER_WRITE_ENABLED!=="true")return reply({error:"Webhook disabled"},403);
 let phase="body",identity={};
 try{
 const reader=request.body?.getReader();if(!reader)return reply({error:"Invalid body"},400);
 let size=0;const decoder=new TextDecoder();let raw="";
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();return reply({error:"Payload too large"},413);}raw+=decoder.decode(value,{stream:true});}
 raw+=decoder.decode();
 phase="json";const d=JSON.parse(raw);
 phase="authentication";
 if(!(await authenticateTV(d?.token,env.TV_WEBHOOK_TOKEN)))return reply({error:"Unauthorized"},401);
 phase="validation";const data=normalizeTV(d);
 identity={symbol:data.symbol,action:data.action,signal_id:data.signal_id};
 console.info("tv.validated",identity);
 phase="inbox";
 if(!env.TRAIL_MONITOR)return reply({error:"Monitor binding missing"},503);
 const response=await env.TRAIL_MONITOR.get(env.TRAIL_MONITOR.idFromName("demo-single")).fetch(new Request("https://internal/tv-inbox",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)}));
 console.info("tv.inbox.response",{...identity,status:response.status});return response;
 }catch(e){const reason=String(e?.message??"");console.warn("tv.failed",{...identity,phase,reason:/^(Invalid payload|Invalid identity|Invalid sizing|Invalid trailing|Signal too long|Invalid signal ID|Invalid or stale signal timestamp)$/.test(reason)?reason:"Invalid request or internal failure"});return reply({error:"Invalid webhook or inbox unavailable"},400);}
 }
 if(request.method!=="POST"||!["/order-status","/close-status","/close-resolve","/order-resolve","/trade","/trade-preview","/market-check","/trail-preview","/positions","/trail-update","/trail-start","/trail-stop","/trail-status","/trail-add","/trail-remove","/trail-config"].includes(path))return reply({error:"Not found"},404);
 if(!env.BRIDGE_ACCESS_TOKEN||request.headers.get("Authorization")!=="Bearer "+env.BRIDGE_ACCESS_TOKEN)return reply({error:"Unauthorized"},401);
 if(env.TRADING_MODE!=="DEMO")return reply({error:"DEMO required"},403);
 if(path==="/trade"&&env.ORDER_WRITE_ENABLED!=="true")return reply({error:"Order disabled"},403);
 if(["/order-status","/close-status","/close-resolve","/order-resolve","/trade","/trail-start","/trail-stop","/trail-status","/trail-add","/trail-remove","/trail-config"].includes(path)){
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
 return reply({epic,instrument:market.instrument,dealingRules:market.dealingRules,snapshot:market.snapshot,leverages:preferences.leverages??null,hedgingMode:preferences.hedgingMode??null});
 }
 stage="sizing";
 return reply(await previewOrder(client,data,env.BROKER_TIMEZONE));
 }catch(e){const message=String(e?.message??"");const sizingErrors=new Set(["Invalid symbol or action","Invalid managed trailing flag","Invalid trailing flag","Market not tradeable","Currency or contract conversion not verified","Unknown margin requirements","Invalid quote","Unknown currency","No verified fresh FX quote","Unknown size rule","Invalid equity","Invalid percentage","Invalid marginPerUnit","Invalid minSize","Invalid sizeStep","Invalid maxSize","Invalid available","Invalid sizing limits","Insufficient available margin","No valid size within margin budget","Invalid stop distance","Trailing support not verified","Unknown stop rule","Unknown stop unit","Stop outside broker limits","Invalid managed trailing parameters","Active CFD account not verified","Invalid account data"]);const safe=(stage==="sizing"&&sizingErrors.has(message))||/^(Login HTTP \d{3}|Broker read HTTP \d{3}|Missing configuration|Missing tokens|EPIC mismatch|DEMO required)$/.test(message)?message:"Request or metadata validation failed";return reply({error:stage==="stop-write"?"Stop outcome uncertain: check broker before retrying":"Preview blocked",stage,detail:safe,...(stage==="login"&&typeof e?.brokerCode==="string"&&/^error\.[a-zA-Z0-9_.-]{1,100}$/.test(e.brokerCode)?{brokerCode:e.brokerCode}:{})},409);}
}};
