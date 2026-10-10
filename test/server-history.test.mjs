import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historyWrite} from '../web/preview/server-history.js';
test('storage retries the identical payload and stops after three failures',async()=>{
 const bodies=[];const result=await historyWrite('/api/operation-results',{id:'one'},{fetcher:async(path,init)=>{bodies.push(init.body);assert.ok(init.signal);throw Error('Unavailable');}});
 assert.equal(result,false);assert.equal(bodies.length,3);assert.equal(new Set(bodies).size,1);
});
test('transient storage failure retries; success ends the loop',async()=>{
 let count=0;assert.equal(await historyWrite('/api/operation-results',{id:'one'},{fetcher:async()=>++count===1?{ok:false,status:503}:{ok:true,json:async()=>({saved:true})}}),true);assert.equal(count,2);
});
test('validation and authorization errors do not retry',async()=>{
 let count=0;assert.equal(await historyWrite('/api/operation-results',{}, {fetcher:async()=>{count++;return {ok:false,status:400};}}),false);assert.equal(count,1);
});
