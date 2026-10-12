import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,keccak256} from 'ethers';
import {createOrder,createCombinedOrder,validateOrder,assertJournalUpdate,legs,progress} from '../web/source-trade/order.js';
import {TradeEngine} from '../web/source-trade/engine.js';
const address=n=>'0x'+String(n).repeat(40),hash=n=>'0x'+String(n).repeat(64);
export const deployment={id:'isolated-combined-test',quoteSigner:address(4),arcFunding:{address:address(1),codeHash:keccak256('0x6001')},buyAndBridge:{address:address(2),codeHash:keccak256('0x6001')},sellAndFund:{address:address(3),codeHash:keccak256('0x6001')}};

test('combined journals preserve their deployment and cannot reinterpret old orders',()=>{
 const legacy=createOrder('buy',Wallet.createRandom().address,'1','old-order-test');
 const order=createCombinedOrder('buy',legacy.account,'1','new-order-test',deployment);
 assert.deepEqual(legs(legacy),['funding','buy','bridge']);assert.deepEqual(legs(order),['funding','buybridge']);
 assert.equal(progress(order,{0:{},1:{}}),2);assert.equal(progress(legacy,{0:{},1:{}}),2);
 assert.throws(()=>assertJournalUpdate(legacy,{...order,id:legacy.id,createdAt:legacy.createdAt,revision:1}));
 assert.throws(()=>assertJournalUpdate(order,{...order,revision:1,deployment:{...deployment,id:'replaced-deployment'}}));
 const engine=new TradeEngine({providers:{},api:async()=>{},persist:async()=>{}});
 assert.throws(()=>engine.setOrder(order),/original combined execution engine/);
 assert.equal(engine.order,null);
 deployment.arcFunding.address=address(5);assert.equal(order.deployment.arcFunding.address,address(1));deployment.arcFunding.address=address(1);
});

test('combined journals reject missing legs, wrong chains, extra approvals and changed deadlines',()=>{
 const order=createCombinedOrder('buy',Wallet.createRandom().address,'1','two-legs-order',deployment);
 const tx=(leg,kind,chain)=>({leg,kind,chain,targetChain:chain===5042?56:5042,to:address(1),data:'0x1234',value:'0',nonce:leg,hash:hash(leg+1),state:'VERIFIED',deadline:'2000000000'});
 const complete={...order,revision:1,state:'COMPLETED',transactions:[tx(0,'funding',5042),tx(1,'buybridge',56)]};
 validateOrder(complete);
 for(const mutation of [
  {...complete,transactions:complete.transactions.slice(0,1)},
  {...complete,transactions:[tx(0,'funding',56),tx(1,'buybridge',56)]},
  {...order,transactions:[{...tx(0,'funding',5042),kind:'approval'}]},
  {...order,transactions:[tx(2,'bridge',56)]},
 ])assert.throws(()=>validateOrder(mutation));
 assert.throws(()=>assertJournalUpdate({...order,transactions:[tx(0,'funding',5042)]},{...order,revision:1,transactions:[{...tx(0,'funding',5042),deadline:'2000000001'}]}));
});
