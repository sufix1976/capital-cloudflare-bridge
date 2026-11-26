// Read-only discovery client for Capital.com DEMO.
const BASE="https://demo-api-capital.backend-capital.com/api/v1";
export async function connectDemo(env, fetcher=fetch) {
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
   return {equity,available,currency:account.currency};
  },
  preferences:()=>get("/accounts/preferences"),
  async market(epic){
   const market=await get("/markets/"+encodeURIComponent(epic));
   if(market.instrument?.epic!==epic) throw new Error("EPIC mismatch");
   return market;
  },
  positions:()=>get("/positions")
 };
}
