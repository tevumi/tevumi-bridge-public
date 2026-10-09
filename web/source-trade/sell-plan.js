import {Contract,Interface,ZeroAddress} from 'ethers';
import {BUY,helperAbi,dexAbi} from '../preview/buy-plan.js';
export const sellHelperAbi=[...helperAbi,'function trySell(address,uint256) view returns(address,address,uint256,uint256)'];
export const sellManagerAbi=['function sellToken(uint256,address,uint256,uint256,uint256,address)','event TokenSale(address token,address account,uint256 price,uint256 amount,uint256 cost,uint256 fee,uint256 offers,uint256 funds)'];
export const sellDexAbi=[...dexAbi,'function swapExactTokensForETH(uint256,uint256,address[],address,uint256) returns(uint256[])'];
const poolAbi=['function token0() view returns(address)','function token1() view returns(address)','function getReserves() view returns(uint112,uint112,uint32)'];
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const check=(ok,message)=>{if(!ok)throw Error(message);};
export async function quoteSell(reader,amount){
 check(amount>0n&&amount%10n**12n===0n,'Use a positive amount with at most 6 decimal places.');
 check((await reader.getNetwork()).chainId===56n,'Sell requires BNB Chain.');
 const block=await reader.getBlock('latest'),at={blockTag:block.number};
 const helper=new Contract(BUY.helper,sellHelperAbi,reader),info=await helper.getTokenInfo(BUY.token,at);
 check(info[0]===2n&&same(info[1],BUY.manager)&&same(info[2],ZeroAddress),'Unexpected Four.meme token configuration.');
 let quote;
 if(!info[11]){
  check(info[7]>0n&&info[9]<info[10]&&BigInt(block.timestamp)>=info[6],'Liquidity migration or trading pause. Refresh later.');
  const q=await helper.trySell(BUY.token,amount,at);
  check(same(q[0],BUY.manager)&&same(q[1],ZeroAddress)&&q[2]>0n&&q[3]>=0n,'Invalid Four.meme sale quote.');
  const minGross=(q[2]+q[3])*99n/100n;
  const estimatedFee=minGross*info[4]/10000n>info[5]?minGross*info[4]/10000n:info[5];
  check(minGross>estimatedFee,'Sale is too small after the protocol fee.');
  // Four.meme enforces gross curve funds. Net is an estimate, never a net guarantee.
  quote={route:'curve',routeId:'curve',to:BUY.manager,sender:BUY.manager,amount,out:q[2],fee:q[3],minGross,minOut:minGross-estimatedFee};
 }else{
  const router=new Contract(BUY.router,sellDexAbi,reader),factory=new Contract(BUY.factory,['function getPair(address,address) view returns(address)'],reader);
  const [actualFactory,weth,pair]=await Promise.all([router.factory(at),router.WETH(at),factory.getPair(BUY.token,BUY.wbnb,at)]);
  check(same(actualFactory,BUY.factory)&&same(weth,BUY.wbnb)&&!same(pair,ZeroAddress)&&await reader.getCode(pair,block.number)!=='0x','Liquidity migration or unexpected DEX route.');
  const pool=new Contract(pair,poolAbi,reader);
  const [t0,t1,reserves,amounts]=await Promise.all([pool.token0(at),pool.token1(at),pool.getReserves(at),router.getAmountsOut(amount,[BUY.token,BUY.wbnb],at)]);
  check((same(t0,BUY.token)&&same(t1,BUY.wbnb))||(same(t0,BUY.wbnb)&&same(t1,BUY.token)),'Unexpected DEX pair.');
  const rb=same(t0,BUY.wbnb)?reserves[0]:reserves[1];
  check(reserves[0]>0n&&reserves[1]>0n&&amounts[1]>0n&&amounts[1]<rb,'Insufficient DEX liquidity.');
  quote={route:'dex',routeId:'dex:'+pair.toLowerCase(),to:BUY.router,sender:pair,amount,out:amounts[1],minOut:amounts[1]*99n/100n};
 }
 check(quote.minOut>0n,'Sale is too small.');return {...quote,token:BUY.token,block:block.number,at:Date.now()};
}
export function sellCall(q,account,deadline){
 return q.route==='curve'?new Interface(sellManagerAbi).encodeFunctionData('sellToken',[0n,BUY.token,q.amount,q.minGross,0n,ZeroAddress]):new Interface(sellDexAbi).encodeFunctionData('swapExactTokensForETH',[q.amount,q.minOut,[BUY.token,BUY.wbnb],account,deadline]);
}
export function assertSellRefresh(old,fresh){check(old.routeId===fresh.routeId&&fresh.out>=BigInt(old.minOut),'Sale route or price changed. Refresh and review again.');}
