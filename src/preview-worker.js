import {connectDemo} from "./capital.js";
import {previewOrder} from "./preview.js";
import {resolveInstrument} from "./instruments.js";
function reply(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});}
export default {async fetch(request,env){
 const path=new URL(request.url).pathname;
 if(path==="/"&&request.method==="GET")return reply({mode:"preview-only",version:"preview-v2"});
 if(request.method!=="POST"||!["/trade-preview","/market-check"].includes(path))return reply({error:"Not found"},404);
 if(!env.BRIDGE_ACCESS_TOKEN||request.headers.get("Authorization")!=="Bearer "+env.BRIDGE_ACCESS_TOKEN)return reply({error:"Unauthorized"},401);
 if(env.TRADING_MODE!=="DEMO")return reply({error:"DEMO required"},403);
 let stage="request";
 try{
 const data=await request.json(),epic=resolveInstrument(data.symbol);
 if(!epic)return reply({error:"Unknown instrument"},400);
 stage="login";
 const client=await connectDemo(env);
 if(path==="/market-check"){
 stage="market";
 const market=await client.market(epic);
 stage="preferences";
 const preferences=await client.preferences();
 return reply({epic,instrument:market.instrument,dealingRules:market.dealingRules,snapshot:market.snapshot,leverages:preferences.leverages??null});
 }
 stage="sizing";
 return reply(await previewOrder(client,data));
 }catch(e){const message=String(e?.message??"");const safe=/^(Login HTTP \d{3}|Broker read HTTP \d{3}|Missing configuration|Missing tokens|EPIC mismatch|DEMO required)$/.test(message)?message:"Request or metadata validation failed";return reply({error:"Preview blocked",stage,detail:safe},409);}
}};
