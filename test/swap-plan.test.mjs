import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {AbiCoder,Interface,ZeroAddress} from 'ethers';
import {buildSwapPlan,verifySwapReceipt,POOL_KEY,POOL_ID,MANAGER,ROUTER,WOTR,ROUTER_ABI} from '../web/preview/swap-plan.js';
const {V4Planner,Actions,URVersion}=createRequire(import.meta.url)('@uniswap/v4-sdk');
const owner='0x'+'1'.repeat(40);
for(const reverse of [false,true]) {
  test(`swap ${reverse ? 'USDC → WOTR' : 'WOTR → USDC'} matches V4 SDK and requires exact wallet proof`,()=>{
    const planner=new V4Planner();
    planner.addSwapAction(Actions.SWAP_EXACT_IN_SINGLE,[{poolKey:POOL_KEY,zeroForOne:reverse,amountIn:'100',amountOutMinimum:'90',hookData:'0x'}],URVersion.V2_0);
    if (reverse) planner.addAction(Actions.SETTLE,[ZeroAddress,'100',true]);
    else planner.addAction(Actions.SETTLE_ALL,[WOTR,'100']);
    planner.addAction(Actions.TAKE_ALL,[reverse ? WOTR : ZeroAddress,'90']);
    const plan=buildSwapPlan(reverse,100n,90n,123n);
    assert.equal(plan.data,new Interface(ROUTER_ABI).encodeFunctionData('execute',['0x10',[planner.finalize()],123n]));
    assert.equal(plan.value,reverse ? 100n : 0n);
    const pool=new Interface(['event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)']);
    const token=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
    const event=pool.encodeEventLog('Swap',[POOL_ID,ROUTER,reverse ? -100n : 95n,reverse ? 95n : -100n,1n,1n,0,3000]);
    const move=token.encodeEventLog('Transfer',[reverse ? MANAGER : owner,reverse ? owner : MANAGER,reverse ? 95n : 100n]);
    const receipt={logs:[{address:MANAGER,...event},{address:WOTR,...move}]};
    assert.equal(verifySwapReceipt(receipt,owner,reverse,100n,90n),95n);
    assert.throws(()=>verifySwapReceipt(receipt,owner,!reverse,100n,90n));
    assert.throws(()=>verifySwapReceipt(receipt,'0x'+'2'.repeat(40),reverse,100n,90n));
    assert.throws(()=>verifySwapReceipt(receipt,owner,reverse,100n,96n));
    assert.throws(()=>verifySwapReceipt({logs:[...receipt.logs,receipt.logs[0]]},owner,reverse,100n,90n));
    assert.throws(()=>buildSwapPlan(reverse,0n,90n,123n));
  });
}
