import {test} from 'node:test';import assert from 'node:assert/strict';
import {publicReadProvider} from '../web/src/read-provider.js';
test('public read retry is bounded and does not retry signing or contract reverts',async()=>{
 let calls=0;const limited=()=>Object.assign(Error('limited'),{code:'CALL_EXCEPTION',info:{error:{code:-32005}}});
 const rpc=publicReadProvider({call:async()=>{if(++calls<2)throw limited();return 'ok';}},{spacing:0});
 assert.equal(await rpc.call(),'ok');assert.equal(calls,2);
 calls=0;await assert.rejects(publicReadProvider({call:async()=>{calls++;throw limited();}},{spacing:0,retries:1}).call());assert.equal(calls,2);
 calls=0;await assert.rejects(publicReadProvider({call:async()=>{calls++;throw Object.assign(Error('revert'),{code:'CALL_EXCEPTION'});}},{spacing:0}).call());assert.equal(calls,1);
 calls=0;await assert.rejects(publicReadProvider({sendTransaction:async()=>{calls++;throw limited();}}).sendTransaction());assert.equal(calls,1);
});
test('public reads limit in-flight requests',async()=>{
 let active=0,max=0;const p=publicReadProvider({call:async()=>{active++;max=Math.max(active,max);await new Promise(r=>setTimeout(r,10));active--;return 1;}},{spacing:0});
 assert.equal((await Promise.all(Array.from({length:20},()=>p.call()))).length,20);assert.ok(max<=4);
});
