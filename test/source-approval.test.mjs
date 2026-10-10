import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceProof,tokenInterface} from '../web/source-trade/proofs.js';
import {BUY} from '../web/preview/buy-plan.js';
import {wotrRoutes} from '../web/src/wotr-routes.js';
import {USDC,ROUTERS} from '../web/src/funding-validation.js';
const account='0x'+'1'.repeat(40),other='0x'+'2'.repeat(40),hash='0x'+'a'.repeat(64);
function rig({chain=56,token=BUY.token,spender=wotrRoutes.current.bsc,actualAmount=150n}={}){
 const record={kind:'approval',chain,hash,nonce:10,to:token,token,spender,amount:'100',value:'0',data:tokenInterface.encodeFunctionData('approve',[spender,100n])};
 const tx={from:account,to:token,hash,nonce:10,value:0n,data:tokenInterface.encodeFunctionData('approve',[spender,actualAmount])};
 const event=(owner=account,address=token,to=spender,amount=actualAmount)=>({address,...tokenInterface.encodeEventLog('Approval',[owner,to,amount])});
 const receipt={hash,status:1,blockNumber:99,gasUsed:21000n,gasPrice:1n,logs:[event()]};
 return {record,tx,receipt,event,provider:{getTransaction:async()=>tx,getTransactionReceipt:async()=>receipt}};
}
test('wallet-edited approval amounts verify from the exact receipt without mutating saved intent',async()=>{
 for(const actualAmount of [0n,50n,100n,150n,2n**256n-1n]){
 const r=rig({actualAmount}),before=JSON.stringify(r.record),proof=await sourceProof(r.provider,r.record,account);
 assert.equal(proof.approvedAmount,String(actualAmount));assert.equal(proof.requestedAmount,'100');assert.equal(JSON.stringify(r.record),before);assert.equal(proof.walletWrapper,undefined);
 }
});
test('Arc USDC approval amount may change only for the allowed funding spender',async()=>{const r=rig({chain:5042,token:USDC,spender:ROUTERS[5042]});assert.equal((await sourceProof(r.provider,r.record,account)).approvedAmount,'150');});
for(const [name,change] of [
 ['sender',r=>r.tx.from=other],['nonce',r=>r.tx.nonce++],['token',r=>r.tx.to=other],['spender',r=>r.tx.data=tokenInterface.encodeFunctionData('approve',[other,150n])],['value',r=>r.tx.value=1n],['reverted',r=>r.receipt.status=0],['wrong event amount',r=>r.receipt.logs=[r.event(account,BUY.token,r.record.spender,151n)]],['wrong event owner',r=>r.receipt.logs=[r.event(other)]],['duplicate event',r=>r.receipt.logs.push(r.event())],['missing event',r=>r.receipt.logs=[]],['trailing data',r=>r.tx.data+='00'],['saved noncanonical data',r=>r.record.data+='00'],['wrong chain',r=>r.record.chain=5042],['other call',r=>r.tx.data=tokenInterface.encodeFunctionData('allowance',[account,r.record.spender])],['saved amount',r=>r.record.amount='101']])test('approval rejects changed '+name,async()=>{const r=rig();change(r);await assert.rejects(sourceProof(r.provider,r.record,account));});
test('changed transfer calldata remains rejected',async()=>{const r=rig();r.record.kind='buy';await assert.rejects(sourceProof(r.provider,r.record,account),/Original transaction/);});
