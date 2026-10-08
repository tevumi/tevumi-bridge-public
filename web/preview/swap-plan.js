import {AbiCoder, Interface, ZeroAddress} from 'ethers';

export const WOTR = '0x70Cedd901366ad932203BBB08B22DcD4d4510028';
export const ROUTER = '0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1';
export const MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951';
export const POOL_ID = '0x0b98404b6f6df1c01ecb4a44b8c7e0c11b722585f91c5bc77dc9e7d294d278b4';
export const POOL_KEY = {currency0:ZeroAddress,currency1:WOTR,fee:3000,tickSpacing:60,hooks:ZeroAddress};
export const ROUTER_ABI = ['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable'];
const poolInterface = new Interface(['event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)']);
const transfers = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const same = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
export function swapAssets(reverse) { return reverse ? {input:'USDC',output:'WOTR'} : {input:'WOTR',output:'USDC'}; }
export function buildSwapPlan(reverse, amountIn, minOut, deadline) {
  if (typeof reverse !== 'boolean' || amountIn <= 0n || amountIn >= 2n**128n || minOut <= 0n || minOut >= 2n**128n) throw Error('Invalid swap amount or direction.');
  const abi = AbiCoder.defaultAbiCoder();
  const swap = abi.encode(['tuple(tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)'],[{poolKey:POOL_KEY,zeroForOne:reverse,amountIn,amountOutMinimum:minOut,hookData:'0x'}]);
  const settle = abi.encode(['address','uint256'],[reverse ? ZeroAddress : WOTR,amountIn]);
  const take = abi.encode(['address','uint256'],[reverse ? WOTR : ZeroAddress,minOut]);
  const payload = abi.encode(['bytes','bytes[]'],['0x060c0f',[swap,settle,take]]);
  return {data:new Interface(ROUTER_ABI).encodeFunctionData('execute',['0x10',[payload],deadline]),value:reverse ? amountIn : 0n};
}

// Pool deltas identify this swap's actual output without conflating other
// transactions in the same block with the wallet's native-USDC balance.
export function verifySwapReceipt(receipt, owner, reverse, amountIn, minOut) {
  const swaps = [], tokenMoves = [];
  for (const log of receipt.logs) {
    try {
      if (same(log.address,MANAGER)) { const event=poolInterface.parseLog(log); if(event?.name==='Swap' && same(event.args.id,POOL_ID) && same(event.args.sender,ROUTER)) swaps.push(event.args); }
      if (same(log.address,WOTR)) { const event=transfers.parseLog(log); if(event?.name==='Transfer') tokenMoves.push(event.args); }
    } catch { /* unrelated event */ }
  }
  if (swaps.length !== 1) throw Error('Swap receipt has no unique matching pool event.');
  const event=swaps[0], spent=reverse ? -event.amount0 : -event.amount1, received=reverse ? event.amount1 : event.amount0;
  const moved=tokenMoves.filter(event=>reverse ? same(event.from,MANAGER)&&same(event.to,owner) : same(event.from,owner)&&same(event.to,MANAGER)).reduce((sum,event)=>sum+event.value,0n);
  if (spent!==amountIn || received<minOut || received<=0n || moved!==(reverse ? received : spent)) throw Error('Swap receipt amounts or wallet transfer do not match the plan.');
  return received;
}
