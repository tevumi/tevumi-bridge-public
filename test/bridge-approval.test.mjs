import test from 'node:test';import assert from 'node:assert/strict';import {Interface,id,zeroPadValue} from 'ethers';import {verifyBridgeApproval} from '../web/src/production-transfer.js';import {wotrRoutes} from '../web/src/wotr-routes.js';
const pair=wotrRoutes.current,account='0x'+'1'.repeat(40),hash='0x'+'2'.repeat(64),abi=new Interface(['function approve(address,uint256)']);
const record={side:'bsc',nonceBefore:'0x1',to:pair.sourceToken,account},tx={hash,from:account,to:pair.sourceToken,nonce:1,value:0n,data:abi.encodeFunctionData('approve',[pair.bsc,101n])};
const receipt={status:1,logs:[{address:pair.sourceToken,topics:[id('Approval(address,address,uint256)'),zeroPadValue(account,32),zeroPadValue(pair.bsc,32)],data:'0x'+(101n).toString(16).padStart(64,'0')}]};
test('accepts actual wallet-edited bridge approval with matching event',()=>assert.equal(verifyBridgeApproval(record,tx,receipt,pair,hash),101n));
for(const [name,patch]of Object.entries({nonce:{nonce:2},sender:{from:pair.bsc},token:{to:pair.arc},value:{value:1n},spender:{data:abi.encodeFunctionData('approve',[pair.arc,101n])},method:{data:'0x'},trailing:{data:tx.data+'00'}}))test('rejects changed '+name,()=>assert.throws(()=>verifyBridgeApproval(record,{...tx,...patch},receipt,pair,hash)));
test('rejects failed receipt',()=>assert.throws(()=>verifyBridgeApproval(record,tx,{...receipt,status:0},pair,hash)));
test('rejects mismatching approval event',()=>assert.throws(()=>verifyBridgeApproval(record,tx,{...receipt,logs:[{...receipt.logs[0],data:'0x'+(100n).toString(16).padStart(64,'0')}]},pair,hash)));
