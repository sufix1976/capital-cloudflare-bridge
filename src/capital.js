// Demo broker client for Capital.com DEMO.
const BASE="https://demo-api-capital.backend-capital.com/api/v1";
export async function connectDemo(env, fetcher=fetch, authorizeManagedDeal=async()=>false) {
 if(env.TRADING_MODE!=="DEMO") throw new Error("DEMO required");
 if(!env.CAPITAL_API_KEY||!env.CAPITAL_IDENTIFIER||!env.CAPITAL_PASSWORD) throw new Error("Missing configuration");
 const login=await fetcher(BASE+"/session",{method:"POST",headers:{"Content-Type":"application/json","X-CAP-API-KEY":env.CAPITAL_API_KEY},body:JSON.stringify({identifier:env.CAPITAL_IDENTIFIER,password:env.CAPITAL_PASSWORD,encryptedPassword:false}),signal:AbortSignal.timeout(10000)});
 if(!login.ok) {
 let code="";try{const body=await login.json();if(typeof body.errorCode==="string"&&/^error\.[a-zA-Z0-9_.-]{1,100}$/.test(body.errorCode))code=body.errorCode;}catch{}
 const err=new Error("Login HTTP "+login.status);err.brokerCode=code;throw err;
 }
 const CST=login.headers.get("CST"), token=login.headers.get("X-SECURITY-TOKEN");
 if(!CST||!token) throw new Error("Missing tokens");
 const headers={CST,"X-SECURITY-TOKEN":token,"Accept":"application/json"};
 async function get(path){
  const response=await fetcher(BASE+path,{headers,signal:AbortSignal.timeout(10000)});
  if(!response.ok) throw new Error("Broker read HTTP "+response.status);
  return response.json();
 }
 return {
  async account(){
   const session=await get("/session");
   const accounts=await get("/accounts");
   const account=accounts.accounts?.find(a=>a.accountId===session.accountId);
   if(!account||account.status!=="ENABLED"||account.accountType!=="CFD") throw new Error("Active CFD account not verified");
   const equity=account.balance?.balance, available=account.balance?.available;
   if(!Number.isFinite(equity)||!Number.isFinite(available)||!account.currency) throw new Error("Invalid account data");
   return {equity,available,currency:account.currency,accountId:account.accountId};
  },
  preferences:()=>get("/accounts/preferences"),
  async market(epic){
   const market=await get("/markets/"+encodeURIComponent(epic));
   if(market.instrument?.epic!==epic) throw new Error("EPIC mismatch");
   return market;
  },
  positions:()=>get("/positions"),
  async submitOrder(payload){
   if(env.TRADING_MODE!=="DEMO"||env.ORDER_WRITE_ENABLED!=="true")throw Error("Order write disabled");
   if(!payload||typeof payload.epic!=="string"||!["BUY","SELL"].includes(payload.direction)||!Number.isFinite(payload.size)||payload.size<=0||!Number.isFinite(payload.stopDistance)||payload.stopDistance<=0||payload.trailingStop!==false)throw Error("Invalid protected order");
   const prefs=await get("/accounts/preferences");
   if(prefs.hedgingMode!==true)throw Error("Hedging mode required");
   const response=await fetcher(BASE+"/positions",{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({epic:payload.epic,direction:payload.direction,size:payload.size,stopDistance:payload.stopDistance,trailingStop:false}),signal:AbortSignal.timeout(10000)});
   if(!response.ok){
 let brokerCode="unavailable",responseFormat="unknown",errorFields=[];
 try{
 const raw=await response.text();
 try{
 const body=JSON.parse(raw);responseFormat="json";
 if(body&&typeof body==="object"){
 errorFields=["errorCode","code","error","message","reason","details"].filter(k=>Object.hasOwn(body,k));
 for(const candidate of [body.errorCode,body.code,body.error?.code,body.error]){
 if(typeof candidate==="string"&&/^[a-zA-Z][a-zA-Z0-9_.-]{0,119}$/.test(candidate)&&!/^[a-f0-9]{16,}$/i.test(candidate)){brokerCode=candidate;break;}
 }
 }
 }catch{responseFormat="non-json";if(/^[a-zA-Z][a-zA-Z0-9_.-]{0,119}$/.test(raw.trim())&&!/^[a-f0-9]{16,}$/i.test(raw.trim()))brokerCode=raw.trim();}
 }catch{responseFormat="unreadable";}
 console.warn("order.broker.response",{symbol:payload.epic,httpStatus:response.status,brokerCode,responseFormat,errorFields,direction:payload.direction,size:payload.size,stopDistance:payload.stopDistance,trailingStop:false});
 throw Error("Order outcome requires reconciliation");
 }
   const result=await response.json();
   if(typeof result.dealReference!=="string"||!result.dealReference)throw Error("Missing order reference");
   return result.dealReference;
  },
  async closePosition(dealId){
   if(env.TRADING_MODE!=="DEMO"||env.ORDER_WRITE_ENABLED!=="true"||typeof dealId!=="string"||!dealId)throw Error("Close disabled");
   const response=await fetcher(BASE+"/positions/"+encodeURIComponent(dealId),{method:"DELETE",headers,signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error("Close outcome requires reconciliation");
   const result=await response.json();
   if(typeof result.dealReference!=="string"||!result.dealReference)throw Error("Missing close reference");
   return result.dealReference;
  },
  async confirmOrder(reference){
   if(typeof reference!=="string"||!reference)throw Error("Invalid order reference");
   return get("/confirms/"+encodeURIComponent(reference));
  },
  async readPosition(dealId){
   if(typeof dealId!=="string"||!dealId)throw Error("Invalid deal ID");
   return get("/positions/"+encodeURIComponent(dealId));
  },
  async updateStop(dealId,stopLevel){
   if(env.TRAIL_WRITE_ENABLED!=="true"||(!allowedTrailDeal(env,dealId)&&!(await authorizeManagedDeal(dealId)))||!Number.isFinite(stopLevel)||stopLevel<=0)throw new Error("Stop write disabled");
   const path="/positions/"+encodeURIComponent(dealId);
   const response=await fetcher(BASE+path,{method:"PUT",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({stopLevel}),signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw new Error("Stop write HTTP "+response.status);
   const update=await response.json();
   if(!update.dealReference)throw new Error("Missing confirmation reference");
   const confirmation=await get("/confirms/"+encodeURIComponent(update.dealReference));
   if(confirmation.dealStatus!=="ACCEPTED")throw new Error("Stop update not accepted");
   const verified=await get(path);
   if(verified.position?.dealId!==dealId||typeof verified.position?.stopLevel!=="number"||Math.abs(verified.position.stopLevel-stopLevel)>0.000001)throw new Error("Stop verification failed");
   return verified.position.stopLevel;
  }
 };
}

export function allowedTrailDeal(env,id){return typeof id==="string"&&id.length>0&&[env.TRAIL_TEST_DEAL_ID,...String(env.TRAIL_TEST_DEAL_IDS??"").split(",").map(x=>x.trim())].includes(id);}
