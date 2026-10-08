import test from 'node:test';
import assert from 'node:assert/strict';
import {AbiCoder,id} from 'ethers';
import {quoteFailure} from '../web/preview/quote-error.js';
test('quote errors classify direct and wrapped insufficient liquidity without guessing unknown errors',()=>{
 const direct=id('NotEnoughLiquidity(bytes32)').slice(0,10)+'00'.repeat(32);
 const wrapped=id('UnexpectedRevertBytes(bytes)').slice(0,10)+AbiCoder.defaultAbiCoder().encode(['bytes'],[direct]).slice(2);
 assert.equal(quoteFailure({data:direct}),'liquidity');
 assert.equal(quoteFailure({info:{error:{data:wrapped}}}),'liquidity');
 for(const data of ['0x','0x6190b2b0','0x7a5ed734',null])assert.equal(quoteFailure({data}),'unavailable');
 assert.equal(quoteFailure({message:'NotEnoughLiquidity'}),'unavailable');
});
