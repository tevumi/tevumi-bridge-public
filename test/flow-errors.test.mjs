import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyFlowError} from '../web/src/flow-errors.js';
test('classifies nested rejection and RPC throttling before generic call failure',()=>{
 assert.equal(classifyFlowError({code:'UNKNOWN_ERROR',info:{error:{code:4001}}}),'USER_REJECTED');
 assert.equal(classifyFlowError({code:'CALL_EXCEPTION',info:{error:{code:-32005}}}),'RATE_LIMIT');
 assert.equal(classifyFlowError({code:'SERVER_ERROR',info:{responseStatus:429}}),'RATE_LIMIT');
 assert.equal(classifyFlowError({code:'CALL_EXCEPTION',data:'0x'}),'CALL_FAILED');
 assert.equal(classifyFlowError({code:'CALL_EXCEPTION',data:'0x12345678'}),'CONTRACT_REVERT');
 assert.equal(classifyFlowError({code:'BAD_DATA'}),'INVALID_RESPONSE');
 assert.equal(classifyFlowError(null),'VALIDATION');
});
test('timed contract calls identify methods without retaining request or error secrets',async()=>{
 const saved=new Map();globalThis.localStorage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};
 const {beginTiming,timedProvider,endTiming}=await import('../web/src/flow-timing.js');
 const error=Object.assign(new Error('https://secret.example/private-key'),{code:'CALL_EXCEPTION',data:'0x'});
 const provider=timedProvider({call:async()=>{throw error;}},5042);
 const trace=beginTiming('test','cat',56);
 await assert.rejects(provider.call({to:'0x'+'a'.repeat(40),data:'0x70a08231'+'0'.repeat(64)}),e=>e===error);
 endTiming(trace,'error');
 const report=saved.get('tevumi-flow-timing-v1'),read=JSON.parse(report)[0].reads[0];
 assert.equal(read.label,'5042:call:balanceOf');assert.equal(read.errorCode,'CALL_FAILED');
 assert.ok(!report.includes('secret'));assert.ok(!report.includes('0x'));assert.equal(read.status,'error');
 delete globalThis.localStorage;
});
