import test from 'node:test';
import assert from 'node:assert/strict';
import {continueTrade,waitingForProof} from '../web/source-trade/workflow.js';

test('one Start advances approvals and three legs only after real proof is ready',async()=>{
 let clock=1000,step=0,pending=0,approved=false;const sends=[],status=[],quoted=[];
 const engine={order:{state:'OPEN'},async verify(){if(pending){pending--;throw Object.assign(Error('await arrival'),{code:'WAITING_PROOF'});}if(step===3)this.order.state='COMPLETED';},async quote(){quoted.push(step);return {leg:step,at:clock};},async transact(wallet,q){sends.push(q.leg);pending=2;if(!approved){approved=true;}else{approved=false;step++;}}};
 await continueTrade({engine,wallet:{},firstQuote:{leg:0,at:clock},signal:new AbortController().signal,now:()=>clock,wait:async ms=>{clock+=ms;},onStatus:s=>status.push(s)});
 assert.deepEqual(sends,[0,0,1,1,2,2]);assert.equal(engine.order.state,'COMPLETED');assert.equal(status.at(-1),'completed');assert.equal(quoted.length,5);
});
for(const code of [4001,'UNCERTAIN','SAVE_FAILED'])test(`wallet or journal error ${code} stops the sequence without retry`,async()=>{
 let sends=0;const engine={order:{state:'OPEN'},async verify(){},async transact(){sends++;throw Object.assign(Error('stop'),{code});}};
 await assert.rejects(continueTrade({engine,firstQuote:{at:Date.now()},signal:new AbortController().signal}));assert.equal(sends,1);
});
test('pause during a pending arrival prevents the next wallet prompt',async()=>{
 const control=new AbortController();let sends=0,status;
 const engine={order:{state:'OPEN'},async verify(){throw Object.assign(Error('pending'),{code:'WAITING_PROOF'});},async transact(){sends++;}};
 await continueTrade({engine,signal:control.signal,wait:async()=>control.abort(),onStatus:s=>status=s});assert.equal(sends,0);assert.equal(status,'paused');
});
test('refund, partial completion and mismatched proof never advance',async()=>{
 for(const reason of ['REFUNDED','PARTIAL','PROOF_MISMATCH']){
  let sends=0;const engine={order:{state:'OPEN'},async verify(){throw Error(reason);},async transact(){sends++;}};
  await assert.rejects(continueTrade({engine,signal:new AbortController().signal}),new RegExp(reason));assert.equal(sends,0);
 }
 assert.equal(waitingForProof(Error('pending but untrusted')),false);
});
test('expired preview refreshes before signing; pause during quote prevents signing',async()=>{
 const controller=new AbortController();let quotes=0,sends=0;
 const engine={order:{state:'OPEN'},async verify(){},async quote(){quotes++;controller.abort();return {at:100000};},async transact(){sends++;}};
 await continueTrade({engine,firstQuote:{at:0},signal:controller.signal,now:()=>100000});assert.equal(quotes,1);assert.equal(sends,0);
});
test('waiting timeout ends without resending a transfer',async()=>{
 let clock=0,sends=0,last;const engine={order:{state:'OPEN'},async verify(){throw Object.assign(Error('pending'),{code:'WAITING_PROOF'});},async transact(){sends++;}};
 await continueTrade({engine,signal:new AbortController().signal,now:()=>clock,timeout:8000,wait:async ms=>clock+=ms,onStatus:s=>last=s});assert.equal(last,'timeout');assert.equal(sends,0);
});
