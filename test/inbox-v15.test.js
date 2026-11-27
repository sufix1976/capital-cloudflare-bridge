import test from "node:test";
import assert from "node:assert/strict";
import {TrailMonitor} from "../src/trail-monitor.js";
import {dispatchStrategy} from "../src/strategy-dispatch.js";
function storage(){
 const m=new Map();let alarm=null;
 const s={get:async k=>m.get(k),put:async(k,v)=>m.set(k,structuredClone(v)),delete:async k=>m.delete(k),transaction:async fn=>fn(s),list:async({prefix,limit,startAfter})=>new Map([...m].filter(([k])=>k.startsWith(prefix)&&(!startAfter||k>startAfter)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit)),getAlarm:async()=>alarm,setAlarm:async v=>{alarm=v;}};
 return s;
}
const env={TRADING_MODE:"DEMO",ORDER_WRITE_ENABLED:"true",TV_WEBHOOK_ENABLED:"true"};
const data=()=>({symbol:"GOLD",strategy_id:"EMA_TURN_V3",action:"exit_long",signal_id:"inbox-1",issued_at:Date.now(),confirm:true});
const request=d=>new Request("https://internal/tv-inbox",{method:"POST",body:JSON.stringify(d)});
test("inbox persists before acknowledgement and deduplicates after restart",async()=>{
 const s=storage(),d=data(),m=new TrailMonitor({storage:s},env);
 assert.equal((await m.fetch(request(d))).status,202);
 assert.equal((await s.get("tv:"+d.signal_id)).status,"queued");
 assert.equal((await s.list({prefix:"tv-pending:"})).size,1);
 assert.ok(await s.getAlarm());
 const restarted=new TrailMonitor({storage:s},env);
 assert.equal((await (await restarted.fetch(request(d))).json()).duplicate,true);
 assert.equal((await s.list({prefix:"tv-pending:"})).size,1);
});
test("queued exit is processed once",async()=>{
 const s=storage(),d=data(),m=new TrailMonitor({storage:s},env);
 let calls=0;m.broker=async()=>({account:async()=>{calls++;return {accountId:"demo"};}});
 await m.fetch(request(d));await m.processTV();await m.processTV();
 assert.equal(calls,1);assert.equal((await s.get("tv:"+d.signal_id)).status,"completed");
 assert.equal((await s.list({prefix:"tv-pending:"})).size,0);
});
test("interrupted processing is not replayed",async()=>{
 const s=storage(),d=data(),m=new TrailMonitor({storage:s},env);
 await m.fetch(request(d));await s.put("tv:"+d.signal_id,{status:"processing"});
 const restarted=new TrailMonitor({storage:s},env);
 restarted.broker=async()=>{assert.fail("broker must not be called");};
 await restarted.processTV();
 assert.equal((await s.get("tv:"+d.signal_id)).status,"processing");
 assert.equal((await s.list({prefix:"tv-pending:"})).size,0);
});
test("older strategy event cannot override newer event",async()=>{
 const s=storage(),d=data(),client={account:async()=>({accountId:"demo"})};
 assert.equal((await dispatchStrategy(s,client,env,d)).closed,false);
 const result=await dispatchStrategy(s,{account:async()=>assert.fail("broker must not be called")},env,{...d,signal_id:"older",issued_at:d.issued_at-1000});
 assert.equal(result.error,"Out-of-order strategy signal");
});
test("queued signal cannot execute after webhook disabled",async()=>{
 const s=storage(),d=data(),m=new TrailMonitor({storage:s},env);
 await m.fetch(request(d));
 const stopped=new TrailMonitor({storage:s},{...env,TV_WEBHOOK_ENABLED:"false"});
 stopped.broker=async()=>assert.fail("broker must not be called");
 await stopped.processTV();assert.equal((await s.get("tv:"+d.signal_id)).status,"blocked");
});

test("webhooks acknowledge while serialized broker work is blocked",async()=>{
 const s=storage(),m=new TrailMonitor({storage:s},env),d=data();
 let release,started;
 const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
 const busy=m.serial(async()=>{started();await gate;});
 await ready;
 let timer;
 try{
 const responses=await Promise.race([
 Promise.all([m.fetch(request(d)),m.fetch(request({...d,symbol:"J225",signal_id:"inbox-2"}))]),
 new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("Inbox waited for broker")),500);})
 ]);
 assert.deepEqual(responses.map(r=>r.status),[202,202]);
 assert.equal((await s.list({prefix:"tv-pending:"})).size,2);
 assert.ok(await s.getAlarm());
 assert.equal((await (await m.fetch(request(d))).json()).duplicate,true);
 }finally{clearTimeout(timer);release();await busy;}
});
test("serial request re-arms pending inbox after alarm is postponed",async()=>{
 const s=storage(),m=new TrailMonitor({storage:s},env);
 await m.fetch(request(data()));
 await s.setAlarm(Date.now()+86400000);
 await m.fetch(new Request("https://internal/trail-status"));
 assert.ok(await s.getAlarm()<=Date.now()+1000);
});
