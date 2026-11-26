import test from "node:test";
import assert from "node:assert/strict";
import {trailingCandidate as trail} from "../src/trailing.js";
const base={bid:3580,offer:3580.5,distance:7,tick:0.01};
test("long improves only",()=>{assert.equal(trail({...base,direction:"BUY",oldStop:3570}).stopLevel,3573);assert.equal(trail({...base,direction:"BUY",oldStop:3575}).update,false);});
test("short improves only using offer",()=>{assert.equal(trail({...base,direction:"SELL",oldStop:3590}).stopLevel,3587.5);assert.equal(trail({...base,direction:"SELL",oldStop:3585}).update,false);});
test("minimum distance and invalid inputs",()=>{assert.equal(trail({...base,direction:"BUY",oldStop:3500,minDistance:10}).stopLevel,3570);assert.throws(()=>trail({...base,direction:"BUY",oldStop:null}));assert.throws(()=>trail({...base,direction:"SELL",oldStop:3590,distance:0}));});
