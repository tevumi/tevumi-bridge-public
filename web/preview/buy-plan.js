import {Contract, Interface, ZeroAddress, getAddress} from 'ethers';

export const BUY = Object.freeze({
  token:getAddress('0xe2a0ce4be658ee9b09e461f5283c718a20984444'),
  helper:getAddress('0xF251F83e40a78868FcfA3FA4599Dad6494E46034'),
  manager:getAddress('0x5c952063c7fc8610FFDB798152D69F0B9550762b'),
  router:getAddress('0x10ED43C718714eb63d5aA57B78B54704E256024E'),
  factory:getAddress('0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73'),
  wbnb:getAddress('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'),
});
export const helperAbi=['function getTokenInfo(address) view returns(uint256,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool)','function tryBuy(address,uint256,uint256) view returns(address,address,uint256,uint256,uint256,uint256,uint256,uint256)'];
export const managerAbi=['function buyTokenAMAP(address,uint256,uint256) payable','event TokenPurchase(address token,address account,uint256 price,uint256 amount,uint256 cost,uint256 fee,uint256 offers,uint256 funds)'];
export const dexAbi=['function factory() view returns(address)','function WETH() view returns(address)','function getAmountsOut(uint256,address[]) view returns(uint256[])','function swapExactETHForTokens(uint256,address[],address,uint256) payable returns(uint256[])'];
const pairAbi=['function token0() view returns(address)','function token1() view returns(address)','function getReserves() view returns(uint112,uint112,uint32)'];
const transferAbi=['event Transfer(address indexed from,address indexed to,uint256 value)'];
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const requireThat=(ok,message)=>{if(!ok)throw Error(message);};

export function curveQuote(info,q,budget){
  requireThat(info[0]===2n && same(info[1],BUY.manager) && same(info[2],ZeroAddress),'Unexpected Four.meme token configuration.');
  requireThat(!info[11] && info[7]>0n && info[9]<info[10],'Liquidity migration is in progress. Refresh shortly.');
  requireThat(same(q[0],BUY.manager) && same(q[1],ZeroAddress),'Unexpected Four.meme quote route.');
  requireThat(q[2]>0n && q[2]<=info[7] && q[5]>0n && q[5]<=budget && q[7]===budget && q[6]===0n && q[3]+q[4]<=q[5],'The curve cannot quote this full budget. Reduce the amount and refresh.');
  const executionPrice=q[3]*10n**18n/q[2];
  const impactBps=info[3]>0n && executionPrice>info[3] ? Number((executionPrice-info[3])*10000n/executionPrice):0;
  return {route:'curve',routeId:'curve',to:BUY.manager,sender:BUY.manager,token:BUY.token,value:budget,msgValue:q[5],funds:q[7],out:q[2],minOut:q[2]*99n/100n,fee:q[4],impactBps};
}

export async function quoteNewBuy(reader,budget){
  const block=await reader.getBlock('latest'), at={blockTag:block.number};
  requireThat((await reader.getNetwork()).chainId===56n,'Buy requires BNB Chain.');
  const helper=new Contract(BUY.helper,helperAbi,reader);
  const info=await helper.getTokenInfo(BUY.token,at);
  requireThat(info[0]===2n && same(info[1],BUY.manager) && same(info[2],ZeroAddress),'Unexpected Four.meme token configuration.');
  let result;
  if(!info[11]){
    requireThat(info[7]>0n && info[9]<info[10],'Liquidity migration is in progress. Refresh shortly.');
    requireThat(BigInt(block.timestamp)>=info[6],'Token trading has not started.');
    const q=await helper.tryBuy(BUY.token,0n,budget,at);
    result=curveQuote(info,q,budget);
  }else{
    const router=new Contract(BUY.router,dexAbi,reader);
    const factory=new Contract(BUY.factory,['function getPair(address,address) view returns(address)'],reader);
    const [actualFactory,weth,pair]=await Promise.all([router.factory(at),router.WETH(at),factory.getPair(BUY.wbnb,BUY.token,at)]);
    requireThat(same(actualFactory,BUY.factory) && same(weth,BUY.wbnb),'Unexpected PancakeSwap router.');
    requireThat(!same(pair,ZeroAddress) && await reader.getCode(pair,block.number)!=='0x','Liquidity migration is in progress. Refresh shortly.');
    const pool=new Contract(pair,pairAbi,reader);
    const [t0,t1,reserves,amounts]=await Promise.all([pool.token0(at),pool.token1(at),pool.getReserves(at),router.getAmountsOut(budget,[BUY.wbnb,BUY.token],at)]);
    requireThat((same(t0,BUY.wbnb)&&same(t1,BUY.token))||(same(t1,BUY.wbnb)&&same(t0,BUY.token)),'Unexpected PancakeSwap pair.');
    const rb=same(t0,BUY.wbnb)?reserves[0]:reserves[1], rt=same(t0,BUY.token)?reserves[0]:reserves[1];
    requireThat(rb>0n && rt>0n && amounts[1]>0n && amounts[1]<rt,'PancakeSwap liquidity is not ready.');
    result={route:'dex',routeId:'dex:'+pair.toLowerCase(),to:BUY.router,sender:pair,token:BUY.token,value:budget,msgValue:budget,out:amounts[1],minOut:amounts[1]*99n/100n,fee:null,impactBps:Number(budget*10000n/(rb+budget))};
  }
  requireThat(result.minOut>0n,'Amount is too small for a protected quote.');
  return {...result,block:block.number,at:Date.now()};
}

export function assertBuyRefresh(old,fresh){
  requireThat(old.routeId===fresh.routeId,'Trading route changed. Review the new quote before signing.');
  requireThat(fresh.out>=old.minOut && fresh.msgValue<=old.msgValue,'Price or fees changed. Review the new quote before signing.');
}
export function buyCall(quote,recipient,deadline){
  return quote.route==='curve'
    ? new Interface(managerAbi).encodeFunctionData('buyTokenAMAP',[BUY.token,quote.funds,quote.minOut])
    : new Interface(dexAbi).encodeFunctionData('swapExactETHForTokens',[quote.minOut,[BUY.wbnb,BUY.token],recipient,deadline]);
}
export function verifyBuyReceipt(receipt,recipient,quote){
  const token=quote.token || BUY.token, sender=quote.sender;
  requireThat(sender,'Saved buy route is unavailable.');
  let received=0n;
  const transfers=new Interface(transferAbi);
  for(const log of receipt.logs){if(!same(log.address,token))continue;try{const e=transfers.parseLog(log);if(same(e.args.from,sender)&&same(e.args.to,recipient))received+=e.args.value;}catch{}}
  requireThat(received>0n && received>=BigInt(quote.minOut),'Buy receipt has no matching minimum WOTR delivery.');
  if(quote.route==='curve'){
    const manager=new Interface(managerAbi);let purchases=[];
    for(const log of receipt.logs){if(!same(log.address,BUY.manager))continue;try{const e=manager.parseLog(log);if(e?.name==='TokenPurchase'&&same(e.args.token,BUY.token)&&same(e.args.account,recipient))purchases.push(e);}catch{}}
    requireThat(purchases.length===1 && purchases[0].args.amount===received,'Four.meme purchase event does not match wallet delivery.');
  }
  return received;
}
