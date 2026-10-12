import test from 'node:test';
import assert from 'node:assert/strict';
import {combinedWalletRig} from './helpers/combined-wallet-rig.mjs';
import {continueTrade} from '../web/source-trade/workflow.js';
import {validateCombinedIntent,CombinedTradeEngine} from '../web/source-trade/combined-engine.js';
import {createOrder} from '../web/source-trade/order.js';
async function start(r){await continueTrade({engine:r.engine,wallet:r.wallet,signal:new AbortController().signal,wait:async()=>r.release()});}

for(const [kind,approved,expected] of [['buy',false,2],['sell',false,3],['sell',true,2]])test(`one Start completes ${kind}, existing allowance ${approved}, with ${expected} financial confirmations`,async()=>{
 const r=await combinedWalletRig({kind,approved});await start(r);
 assert.equal(r.counts().financialConfirmations,expected);assert.equal(r.journal.state,'COMPLETED');assert.equal(r.journal.transactions.filter(t=>t.kind!=='approval').length,2);
 assert(r.journal.transactions.every(t=>t.state==='VERIFIED'));assert.equal(r.counts().chainSwitches,1);
});

test('pending arrival blocks the next request; refreshing only verifies and never sends',async()=>{
 const r=await combinedWalletRig({pending:true}),q=await r.engine.quote();await r.engine.transact(r.wallet,q);assert.equal(r.counts().financialConfirmations,1);
 const restored=new CombinedTradeEngine({providers:r.providers,api:r.api,persist:async()=>{}});restored.setOrder(r.journal);
 await assert.rejects(restored.verify(),e=>e.code==='WAITING_PROOF');assert.equal(r.counts().financialConfirmations,1);
 r.release();await restored.verify();await restored.quote();assert.equal(r.counts().financialConfirmations,1);
 await start(r);assert.equal(r.counts().financialConfirmations,2);
});

for(const mode of ['reject','unknown','failSave'])test(`${mode} stops the workflow without retrying a wallet request`,async()=>{
 const r=await combinedWalletRig({[mode]:true});await assert.rejects(start(r));
 assert.equal(r.counts().financialConfirmations,mode==='failSave'?0:1);
 if(mode==='unknown'){await assert.rejects(r.engine.verify(),/Recover the original/);await assert.rejects(start(r));assert.equal(r.counts().financialConfirmations,1);}
 if(mode==='reject')assert.equal(r.journal.transactions.at(-1).state,'REJECTED');
});

test('wrong executor, receiver, signature and stale quote never reach the wallet',async()=>{
 for(const mode of ['executor','signature','receiver','stale']){
  const r=await combinedWalletRig(),q=await r.engine.quote();
  if(mode==='executor')q.to='0x'+'8'.repeat(40);
  if(mode==='signature')q.quote.signature='0x'+'8'.repeat(130);
  if(mode==='receiver')q.quote.authorization.user='0x'+'8'.repeat(40);
  if(mode==='stale')q.at=Date.now()-60001;
  await assert.rejects(r.engine.transact(r.wallet,q));assert.equal(r.counts().financialConfirmations,0);
 }
});

test('combined engine rejects legacy journals and preview data cannot be transacted',async()=>{
 const r=await combinedWalletRig();assert.throws(()=>r.engine.setOrder(createOrder('buy',r.account,'1','legacy-wallet-order')));
 assert.throws(()=>validateCombinedIntent(r.journal,{previewOnly:true}));
});
