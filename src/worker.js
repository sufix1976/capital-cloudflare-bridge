import { resolveInstrument } from "./instruments.js";
const BASE = "https://demo-api-capital.backend-capital.com";
function reply(message,status=200){return new Response(message,{status,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});}
async function capital(path,method,headers,body){return fetch(BASE+path,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});}
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(url.pathname==="/" && request.method==="GET") return reply("Bridge online - DEMO US500 BOS");
 if(url.pathname!=="/bos-update" || request.method!=="POST") return reply("Not Found",404);
 const bearerValid=!!env.BRIDGE_ACCESS_TOKEN && request.headers.get("Authorization")==="Bearer "+env.BRIDGE_ACCESS_TOKEN;
 let data; try{data=await request.json();}catch{return reply("Invalid JSON",400);}
 const webhookValid=!!env.TV_WEBHOOK_SECRET && typeof data?.secret==="string" && data.secret===env.TV_WEBHOOK_SECRET;
 if(!bearerValid&&!webhookValid)return reply("Unauthorized",401);
 if(env.TRADING_MODE!=="DEMO")return reply("DEMO required",403);
 if(!env.CAPITAL_API_KEY||!env.CAPITAL_IDENTIFIER||!env.CAPITAL_PASSWORD)return reply("Missing configuration",503);
 const entryPrice=Number(data?.entryPrice),entryTime=Number(data?.entryTime),barTime=Number(data?.barTime);
 if(!Number.isFinite(entryPrice)||entryPrice<=0||!Number.isFinite(entryTime)||!Number.isFinite(barTime)||entryTime>barTime||barTime>Date.now()+30000||Date.now()-barTime>120000)return reply("Invalid or outdated BOS signal",409);
 const instrument=resolveInstrument(data?.symbol),direction=data?.direction,stop=data?.stopLevel;
 if(data?.event!=="bos_stop_update"||instrument!=="US500"||!["BUY","SELL"].includes(direction)||typeof stop!=="number"||!Number.isFinite(stop)||stop<=0)return reply("Invalid BOS signal",400);
 try{
 const login=await capital("/api/v1/session","POST",{"Content-Type":"application/json","X-CAP-API-KEY":env.CAPITAL_API_KEY},{identifier:env.CAPITAL_IDENTIFIER,password:env.CAPITAL_PASSWORD,encryptedPassword:false});
 if(!login.ok)return reply("Login failed: HTTP "+login.status,502);
 const cst=login.headers.get("CST"),token=login.headers.get("X-SECURITY-TOKEN");
 if(!cst||!token)return reply("Session tokens missing",502);
 const auth={CST:cst,"X-SECURITY-TOKEN":token,"Content-Type":"application/json"};
 const positionsResponse=await capital("/api/v1/positions","GET",auth);
 if(!positionsResponse.ok)return reply("Positions request failed",502);
 const positionsData=await positionsResponse.json();
 const matches=(positionsData.positions||[]).filter(item=>item.market?.epic==="US500"&&item.position?.direction===direction);
 if(matches.length!==1)return reply("Expected exactly one US500 "+direction+" position, found: "+matches.length,409);
 const dealId=matches[0].position.dealId,path="/api/v1/positions/"+encodeURIComponent(dealId);
 const positionResponse=await capital(path,"GET",auth);
 if(!positionResponse.ok)return reply("Position not found",409);
 const current=await positionResponse.json(),p=current.position||{},m=current.market||{};
 if(p.dealId!==dealId||m.epic!=="US500"||p.direction!==direction)return reply("Position identity mismatch",409);
 const brokerEntry=Number(p.level);
 if(!Number.isFinite(brokerEntry)||Math.abs(brokerEntry-entryPrice)>5)return reply("Entry price mismatch",409);
 const brokerEntryTime=Date.parse(p.createdDateUTC+"Z");
 if(!p.createdDateUTC||!Number.isFinite(brokerEntryTime)||Math.abs(brokerEntryTime-entryTime)>120000)return reply("Entry time mismatch",409);
 if(String(env.BOS_DRY_RUN).toLowerCase()!=="false"||data?.dryRun===true)return reply(["BOS POSITION MATCH SUCCESS","Instrument: "+m.epic,"Direction: "+p.direction,"DealId: "+dealId,"Broker entry: "+p.level,"TradingView entry: "+entryPrice,"Broker entry time: "+p.createdDateUTC,"TradingView entry time: "+new Date(entryTime).toISOString(),"Requested stop: "+stop,"NO TRADE EXECUTED"].join("\n"));
 const oldStop=Number(p.stopLevel);
 if(p.stopLevel==null||!Number.isFinite(oldStop))return reply("Current stop missing",409);
 if(direction==="BUY"&&stop<=oldStop||direction==="SELL"&&stop>=oldStop)return reply("No update: stop already tighter");
 const bid=Number(m.bid),offer=Number(m.offer);
 if(direction==="BUY"&&(!Number.isFinite(bid)||stop>=bid))return reply("Invalid LONG stop relative to bid",409);
 if(direction==="SELL"&&(!Number.isFinite(offer)||stop<=offer))return reply("Invalid SHORT stop relative to offer",409);
 const updateResponse=await capital(path,"PUT",auth,{stopLevel:stop});
 if(!updateResponse.ok)return reply("Broker rejected stop: HTTP "+updateResponse.status,502);
 const update=await updateResponse.json();
 if(!update.dealReference)return reply("Update status unknown - check broker manually",502);
 const confirmResponse=await capital("/api/v1/confirms/"+encodeURIComponent(update.dealReference),"GET",auth);
 if(!confirmResponse.ok)return reply("Confirmation unavailable - check broker manually",502);
 const confirmation=await confirmResponse.json();
 if(confirmation.dealStatus!=="ACCEPTED")return reply("Broker did not accept update",409);
 const verifyResponse=await capital(path,"GET",auth);
 if(!verifyResponse.ok)return reply("Update accepted - verification unavailable",502);
 const verified=await verifyResponse.json(),actualStop=Number(verified.position?.stopLevel);
 if(!Number.isFinite(actualStop)||Math.abs(actualStop-stop)>0.00001)return reply("Update accepted - broker stop not yet verified",502);
 return reply(["BOS STOP UPDATED AND VERIFIED","Instrument: US500","Direction: "+direction,"DealId: "+dealId,"Previous stop: "+oldStop,"New broker stop: "+actualStop].join("\n"));
 }catch{return reply("Request failed - verify broker stop before retrying",502);}
}};
