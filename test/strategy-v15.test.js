import test from "node:test";
import assert from "node:assert/strict";
import {dispatchStrategy} from "../src/strategy-dispatch.js";
import {exitStrategy} from "../src/strategy-exit.js";
import {executeDemoOrder} from "../src/order-coordinator.js";
function storage(){
 const m=new Map();
 const s={get:async k=>m.get(k),put:async(k,v)=>m.set(k,structuredClone(v)),delete:async k=>m.delete(k),transaction:async fn=>fn(s),list:async({prefix,limit,startAfter})=>new Map([...m].filter(([k])=>k.startsWith(prefix)&&(!startAfter||k>startAfter)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit)),setAlarm:async()=>{}};
 return s;
}
const env={TRADING_MODE:"DEMO",ORDER_WRITE_ENABLED:"true",TRAIL_WRITE_ENABLED:"true"};
const signal=(action="buy",id="new")=>({symbol:"GOLD",strategy_id:"EMA_TURN_V3",action,signal_id:id,issued_at:Date.now(),confirm:true,sl_distance_price:7,risk_percentage:.2,managed_trailing:false});
function broker(direction="BUY",fail=false){
 const calls=[],positions=new Map();
 const position=(dealId,direction,size=1)=>({position:{dealId,direction,size,level:101,stopLevel:direction==="BUY"?94:108},market:{epic:"GOLD"}});
 positions.set("owned",position("owned",direction));positions.set("foreign",position("foreign",direction));
 const rule=value=>({unit:"POINTS",value});
 const market={instrument:{epic:"GOLD",lotSize:1,type:"COMMODITIES",currency:"USD",marginFactorUnit:"PERCENTAGE",marginFactor:5},dealingRules:{minDealSize:rule(.01),maxDealSize:rule(100),minSizeIncrement:rule(.01),minStopOrProfitDistance:rule(1),maxStopOrProfitDistance:rule(100)},snapshot:{marketStatus:"TRADEABLE",bid:100,offer:101,scalingFactor:1,decimalPlacesFactor:2}};
 return {calls,positionsMap:positions,account:async()=>({equity:10000,available:10000,currency:"USD",accountId:"demo-test"}),market:async()=>market,preferences:async()=>({leverages:{COMMODITIES:{current:20}}}),positions:async()=>({positions:[...positions.values()]}),closePosition:async id=>{calls.push("close:"+id);if(fail)throw Error("timeout");positions.delete(id);return "close-ref";},submitOrder:async p=>{calls.push("open:"+p.direction);positions.set("new-deal",position("new-deal",p.direction,p.size));return "open-ref";},confirmOrder:async ref=>({dealStatus:"ACCEPTED",dealId:"order-id",affectedDeals:ref==="open-ref"?[{dealId:"new-deal",status:"OPENED"}]:[]}),readPosition:async id=>positions.get(id)};
}
async function setup(direction="BUY",fail=false){const s=storage(),b=broker(direction,fail);await s.put("order:old",{status:"confirmed",epic:"GOLD",accountId:"demo-test",strategyId:"EMA_TURN_V3",direction,dealId:"owned"});return {s,b};}
for(const [direction,action,next] of [["BUY","flip_short","SELL"],["SELL","flip_long","BUY"]]){
 test(action+" closes owned deal before opening opposite direction",async()=>{const {s,b}=await setup(direction);const d=signal(action);const result=await dispatchStrategy(s,b,env,d);assert.equal(result.record?.status,"confirmed");assert.deepEqual(b.calls,["close:owned","open:"+next]);assert.ok(b.positionsMap.has("foreign"));assert.equal((await dispatchStrategy(s,b,env,d)).duplicate,true);assert.equal(b.calls.length,2);});
}
test("exit closes only owned deal",async()=>{const {s,b}=await setup();const result=await dispatchStrategy(s,b,env,signal("exit_long"));assert.equal(result.closed,true);assert.deepEqual(b.calls,["close:owned"]);assert.ok(b.positionsMap.has("foreign"));});
test("uncertain close blocks flip",async()=>{const {s,b}=await setup("BUY",true);const result=await dispatchStrategy(s,b,env,signal("flip_short"));assert.ok(result.error);assert.deepEqual(b.calls,["close:owned"]);assert.ok(await s.get("close:order:old"));});
test("broker stop allows next entry without closing foreign position",async()=>{const {s,b}=await setup();b.positionsMap.delete("owned");const result=await executeDemoOrder(s,b,env,signal());assert.equal(result.record?.status,"confirmed");assert.equal((await s.get("order:old")).status,"closed");assert.deepEqual(b.calls,["open:BUY"]);assert.ok(b.positionsMap.has("foreign"));});
test("existing owned position blocks second entry",async()=>{const {s,b}=await setup();await assert.rejects(executeDemoOrder(s,b,env,signal()),/already registered/);assert.deepEqual(b.calls,[]);});
test("exit with no owned deal leaves foreign position alone",async()=>{const s=storage(),b=broker();const result=await exitStrategy(s,b,env,{...signal("exit_long"),direction:"BUY"});assert.equal(result.closed,false);assert.deepEqual(b.calls,[]);});
