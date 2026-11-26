import test from "node:test";
import assert from "node:assert/strict";
import {executeDemoOrder} from "../src/order-coordinator.js";
import {reserveOrder,transitionOrder} from "../src/order-journal.js";
import {pruneOrders,RETENTION_MS} from "../src/order-retention.js";
import worker from "../src/preview-worker.js";
function storage(){
 const map=new Map();
 const s={get:async k=>map.get(k),put:async(k,v)=>map.set(k,structuredClone(v)),delete:async k=>map.delete(k),transaction:async fn=>fn(s),list:async({prefix,limit,startAfter})=>new Map([...map].filter(([k])=>k.startsWith(prefix)&&(!startAfter||k>startAfter)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit)),setAlarm:async()=>{}};
 return s;
}
const env={TRADING_MODE:"DEMO",ORDER_WRITE_ENABLED:"true",TRAIL_WRITE_ENABLED:"true"};
const signal=()=>({symbol:"GOLD",action:"buy",signal_id:"test-1",issued_at:Date.now(),confirm:true,sl_distance_price:7,risk_percentage:0.2});
function broker(outcome){
 let calls=0;
 const rule=value=>({unit:"POINTS",value});
 const market={instrument:{epic:"GOLD",lotSize:1,type:"COMMODITIES",currency:"USD",marginFactorUnit:"PERCENTAGE",marginFactor:5},dealingRules:{minDealSize:rule(0.01),maxDealSize:rule(100),minSizeIncrement:rule(0.01),minStopOrProfitDistance:rule(1),maxStopOrProfitDistance:rule(100)},snapshot:{marketStatus:"TRADEABLE",bid:100,offer:101,scalingFactor:1,decimalPlacesFactor:2}};
 let payload;
 const position=()=>({position:{dealId:"deal-1",direction:"BUY",size:payload.size,level:101,stopLevel:94},market:{epic:"GOLD"}});
 return {calls:()=>calls,account:async()=>({equity:10000,available:10000,currency:"USD",accountId:"demo-test"}),market:async()=>market,preferences:async()=>({leverages:{COMMODITIES:{current:20}}}),submitOrder:async p=>{calls++;payload=p;if(outcome==="timeout")throw Error("timeout");return "ref-1";},confirmOrder:async()=>({dealStatus:outcome==="reject"?"REJECTED":"ACCEPTED",dealId:"deal-1"}),readPosition:async()=>position(),positions:async()=>({positions:[position()]})};
}
for(const outcome of ["timeout","reject","accept"]){
 test("order "+outcome+" is never submitted twice",async()=>{
 const s=storage(),b=broker(outcome),d=signal();
 const first=await executeDemoOrder(s,b,env,d);
 assert.equal(first.record.status,{timeout:"uncertain",reject:"rejected",accept:"confirmed"}[outcome]);
 assert.equal((await executeDemoOrder(s,b,env,d)).duplicate,true);
 assert.equal(b.calls(),1);
 });
}
test("managed trailing adoption",async()=>{
 const s=storage(),b=broker("accept");
 const result=await executeDemoOrder(s,b,env,{...signal(),managed_trailing:true,trailing_distance:7,trailing_step:0.5});
 assert.equal(result.error,undefined);
 assert.equal((await s.get("state")).positions[0].data.dealId,"deal-1");
});
test("disabled route rejects before broker",async()=>{
 const response=await worker.fetch(new Request("https://example.com/trade",{method:"POST",headers:{Authorization:"Bearer test"}}),{TRADING_MODE:"DEMO",BRIDGE_ACCESS_TOKEN:"test"});
 assert.equal(response.status,403);
});
test("retention preserves uncertain and active orders",async()=>{
 const s=storage(),now=Date.now();
 for(const status of ["closed","rejected","uncertain","confirmed"])await s.put("order:"+status,{status,finishedAt:now-RETENTION_MS});
 assert.equal(await pruneOrders(s,now),2);
 assert.ok(await s.get("order:uncertain"));assert.ok(await s.get("order:confirmed"));
});
test("stale signals rejected",async()=>{await assert.rejects(reserveOrder(storage(),"old",Date.now()-600000,"GOLD"));});
test("invalid transition rejected",async()=>{const s=storage();const r=await reserveOrder(s,"x",Date.now(),"GOLD");await assert.rejects(transitionOrder(s,r.key,"confirmed",{dealId:"x"}));});
