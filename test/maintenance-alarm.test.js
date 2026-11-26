import test from "node:test";
import assert from "node:assert/strict";
import {TrailMonitor} from "../src/trail-monitor.js";
function setup(){
 const map=new Map([["maintenance-enabled",true],["state",{active:true}]]);
 let alarm=Date.now()+5000;
 const s={get:async k=>map.get(k),put:async(k,v)=>map.set(k,structuredClone(v)),getAlarm:async()=>alarm,setAlarm:async t=>{alarm=t;},deleteAlarm:async()=>{alarm=null;},list:async()=>new Map()};
 const monitor=new TrailMonitor({storage:s},{TRADING_MODE:"DEMO"});
 return {s,monitor};
}
test("manual stop preserves daily maintenance alarm",async()=>{
 const {s,monitor}=setup();
 const response=await monitor.fetch(new Request("https://example.com/trail-stop",{method:"POST"}));
 assert.equal(response.status,200);
 assert.equal((await s.get("state")).active,false);
 assert.ok(await s.getAlarm()>Date.now()+86390000);
});
test("idle maintenance runs and reschedules even after broker failure",async()=>{
 const {s,monitor}=setup();
 await s.put("state",{active:false});
 let calls=0;
 monitor.broker=async()=>{calls++;throw Error("offline");};
 await monitor.alarm();
 assert.equal(calls,1);
 assert.equal(await s.get("reconcile-day"),undefined);
 assert.ok(await s.getAlarm()>Date.now()+86390000);
});
test("idle maintenance verifies account and records successful day",async()=>{
 const {s,monitor}=setup();
 await s.put("state",{active:false});
 monitor.broker=async()=>({account:async()=>({accountId:"A"}),positions:async()=>({positions:[]})});
 await monitor.alarm();
 assert.equal(await s.get("reconcile-day"),new Date().toISOString().slice(0,10));
 assert.ok(await s.getAlarm()>Date.now()+86390000);
});
