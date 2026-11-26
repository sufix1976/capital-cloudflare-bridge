import test from "node:test";
import assert from "node:assert/strict";
import {reconcileClosedOrders} from "../src/order-reconcile.js";
import {pruneOrders,RETENTION_MS} from "../src/order-retention.js";
function fixture(){
 const map=new Map();
 const s={get:async k=>map.get(k),put:async(k,v)=>map.set(k,structuredClone(v)),delete:async k=>map.delete(k),transaction:async fn=>fn(s),list:async({prefix,limit,startAfter})=>new Map([...map].filter(([k])=>k.startsWith(prefix)&&(!startAfter||k>startAfter)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit))};
 return s;
}
test("reconciliation only closes absent confirmed deals of same account",async()=>{
 const s=fixture();
 for(const [id,accountId,status] of [["open","A","confirmed"],["closed","A","confirmed"],["other","B","confirmed"],["unknown","A","uncertain"],["legacy",undefined,"confirmed"]])await s.put("order:"+id,{dealId:id,accountId,status});
 const now=Date.now();
 assert.equal(await reconcileClosedOrders(s,{positions:[{position:{dealId:"open"}}]},"A",now),1);
 assert.equal((await s.get("order:closed")).finishedAt,now);
 for(const id of ["open","other","legacy"])assert.equal((await s.get("order:"+id)).status,"confirmed");
 assert.equal((await s.get("order:unknown")).status,"uncertain");
 assert.equal(await pruneOrders(s,now+RETENTION_MS-1),0);
 assert.equal(await pruneOrders(s,now+RETENTION_MS),1);
});
test("invalid snapshot or missing account cannot close orders",async()=>{
 const s=fixture();await s.put("order:x",{status:"confirmed",accountId:"A",dealId:"x"});
 for(const snapshot of [null,{}, {positions:[{}]}])await assert.rejects(reconcileClosedOrders(s,snapshot,"A"));
 await assert.rejects(reconcileClosedOrders(s,{positions:[]},""));
 assert.equal((await s.get("order:x")).status,"confirmed");
});
test("empty valid snapshot closes same-account orders only",async()=>{
 const s=fixture();await s.put("order:x",{status:"confirmed",accountId:"A",dealId:"x"});
 assert.equal(await reconcileClosedOrders(s,{positions:[]},"B"),0);
 assert.equal(await reconcileClosedOrders(s,{positions:[]},"A"),1);
});
