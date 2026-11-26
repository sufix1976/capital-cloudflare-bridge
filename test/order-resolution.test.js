import test from "node:test";
import assert from "node:assert/strict";
import {resolveUncertainOrder} from "../src/order-resolution.js";
import worker from "../src/preview-worker.js";
function setup(status="REJECTED",accountId="A",reference="ref"){
 let record={status:"uncertain",accountId:"A",epic:"GOLD",dealReference:reference};
 const s={get:async()=>record,put:async(k,v)=>{record=v;},transaction:async fn=>fn(s)};
 const b={account:async()=>({accountId}),confirmOrder:async()=>({dealStatus:status,dealId:"D"}),readPosition:async()=>({position:{dealId:"D",stopLevel:100},market:{epic:"GOLD"}})};
 return {s,b};
}
const data={signal_id:"test",confirm:true};
test("resolution of rejected order",async()=>{const {s,b}=setup();assert.equal((await resolveUncertainOrder(s,b,data)).record.status,"rejected");});
test("resolution of accepted protected position",async()=>{const {s,b}=setup("ACCEPTED");const result=await resolveUncertainOrder(s,b,data);assert.equal(result.record.status,"confirmed");assert.equal(result.record.dealId,"D");assert.ok(result.warning);});
test("unverified outcomes remain uncertain",async()=>{for(const args of [["PENDING"],["REJECTED","B"],["REJECTED","A",""]]){const {s,b}=setup(...args);await assert.rejects(resolveUncertainOrder(s,b,data));assert.equal((await s.get()).status,"uncertain");}});
test("resolution requires authentication and demo mode",async()=>{const req=()=>new Request("https://example.com/order-resolve",{method:"POST",headers:{Authorization:"Bearer test"}});assert.equal((await worker.fetch(req(),{TRADING_MODE:"DEMO",BRIDGE_ACCESS_TOKEN:"other"})).status,401);assert.equal((await worker.fetch(req(),{TRADING_MODE:"LIVE",BRIDGE_ACCESS_TOKEN:"test"})).status,403);});
