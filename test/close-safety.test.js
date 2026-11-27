import test from "node:test";
import assert from "node:assert/strict";
import {resolveClose,reconcileCloseLocks} from "../src/close-resolution.js";
import {executeDemoOrder} from "../src/order-coordinator.js";
import {pruneOrders,RETENTION_MS} from "../src/order-retention.js";
import {connectDemo} from "../src/capital.js";
function storage(){
 const m=new Map();
 const s={get:async k=>m.get(k),put:async(k,v)=>m.set(k,structuredClone(v)),delete:async k=>m.delete(k),transaction:async fn=>fn(s),list:async({prefix,limit,startAfter})=>new Map([...m].filter(([k])=>k.startsWith(prefix)&&(!startAfter||k>startAfter)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit))};return s;
}
const env={TRADING_MODE:"DEMO",ORDER_WRITE_ENABLED:"true"};
async function setup(){const s=storage();await s.put("order:old",{status:"confirmed",accountId:"demo",dealId:"owned",epic:"GOLD",direction:"BUY"});await s.put("close:order:old",{accountId:"demo",dealId:"owned"});return s;}
const client=(positions=[],accountId="demo")=>({account:async()=>({accountId}),positions:async()=>({positions})});
const request={confirm:true,signal_id:"old"};
test("absent owned position resolves close lock",async()=>{const s=await setup();assert.equal((await resolveClose(s,client([{position:{dealId:"foreign"}}]),request)).resolved,true);assert.equal(await s.get("close:order:old"),undefined);assert.equal((await s.get("order:old")).status,"closed");});
test("open position retains close lock",async()=>{const s=await setup();assert.equal((await resolveClose(s,client([{position:{dealId:"owned"}}]),request)).resolved,false);assert.ok(await s.get("close:order:old"));});
test("wrong account and invalid snapshot retain close lock",async()=>{const s=await setup();await assert.rejects(resolveClose(s,client([],"other"),request));await assert.rejects(resolveClose(s,client([{}]),request));assert.ok(await s.get("close:order:old"));});
test("unresolved close blocks new order before submission",async()=>{const s=await setup();await assert.rejects(executeDemoOrder(s,client([{position:{dealId:"owned",direction:"BUY"},market:{epic:"GOLD"}}]),env,{confirm:true,symbol:"GOLD",action:"buy",signal_id:"new",issued_at:Date.now()}),/Unresolved close/);});
test("retention preserves closed order with unresolved close lock",async()=>{const s=await setup();await s.put("order:old",{status:"closed",finishedAt:Date.now()-RETENTION_MS-1000});assert.equal(await pruneOrders(s),0);assert.ok(await s.get("order:old"));});
for(const hedgingMode of [false,true]){
 test("broker hedging guard "+hedgingMode,async()=>{
 let writes=0;
 const fetcher=async(url,options)=>{
 if(url.endsWith("/session"))return new Response("{}",{headers:{CST:"test","X-SECURITY-TOKEN":"test"}});
 if(url.endsWith("/accounts/preferences"))return Response.json({hedgingMode});
 if(url.endsWith("/positions")&&options.method==="POST"){writes++;return Response.json({dealReference:"ref"});}
 throw Error("Unexpected request");
 };
 const b=await connectDemo({...env,CAPITAL_API_KEY:"test",CAPITAL_IDENTIFIER:"test",CAPITAL_PASSWORD:"test"},fetcher);
 const p={epic:"GOLD",direction:"BUY",size:1,stopDistance:7,trailingStop:false};
 if(hedgingMode)assert.equal(await b.submitOrder(p),"ref");else await assert.rejects(b.submitOrder(p),/Hedging mode required/);
 assert.equal(writes,hedgingMode?1:0);
 });
}

test("absent close automatically resolves before new signal",async()=>{const s=await setup();await reconcileCloseLocks(s,client(),"demo","GOLD");assert.equal(await s.get("close:order:old"),undefined);assert.equal((await s.get("order:old")).status,"closed");});
test("verified open close blocks only its instrument",async()=>{const s=await setup(),b=client([{position:{dealId:"owned",direction:"BUY"},market:{epic:"GOLD"}}]);await reconcileCloseLocks(s,b,"demo","DE40");await assert.rejects(reconcileCloseLocks(s,b,"demo","GOLD"),/Unresolved close/);assert.ok(await s.get("close:order:old"));});
test("unknown identity blocks all instruments",async()=>{const s=await setup();await s.put("close:order:old",{dealId:"owned"});await assert.rejects(reconcileCloseLocks(s,client(),"demo","DE40"),/Unresolved close/);assert.ok(await s.get("close:order:old"));});
test("invalid snapshot or changed account retains lock",async()=>{const s=await setup();for(const b of [client([{}]),client([],"other")])await assert.rejects(reconcileCloseLocks(s,b,"demo","DE40"),/Unresolved close/);assert.ok(await s.get("close:order:old"));});
test("mismatched live identity blocks all instruments",async()=>{const s=await setup();await assert.rejects(reconcileCloseLocks(s,client([{position:{dealId:"owned",direction:"SELL"},market:{epic:"GOLD"}}]),"demo","DE40"),/Unresolved close/);assert.ok(await s.get("close:order:old"));});
