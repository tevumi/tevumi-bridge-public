import {Contract,Interface,ZeroAddress,parseEther,formatEther,toQuantity} from 'ethers';
import {BUY,quoteNewBuy,assertBuyRefresh,buyCall} from '../preview/buy-plan.js';
import {quoteSell,assertSellRefresh,sellCall} from './sell-plan.js';
import {wotrRoutes} from '../src/wotr-routes.js';
import {planCandidateTransfer,candidateAppAbi} from '../src/production-transfer.js';
import {USDC,validateQuote,same} from '../src/funding-validation.js';
import {arcFeeParams} from '../immediate-deploy/arc-fees.js';
import {legs,progress,stringify,validateOrder} from './order.js';
import {tokenInterface,sourceProof,fundingDestination,bridgeDestination} from './proofs.js';
export const networks={bsc:{chainId:56,eid:30102,endpoint:'0x1a44076050125825900e736c501f859c50fe728c'},arc:{chainId:5042,eid:30417,endpoint:'0x6f475642a6e85809b1c36fa62763669b1b48dd5b'}};
const options='0x00030100110100000000000000000000000000030d40';
const check=(ok,message)=>{if(!ok)throw Error(message);};
const contractAbi=['function allowance(address,address) view returns(uint256)','function balanceOf(address) view returns(uint256)'];
const serialize=v=>JSON.parse(stringify(v));
export class TradeEngine{
 constructor({providers,api,persist,onChange=()=>{}}){Object.assign(this,{providers,api,persist,onChange});this.results={};this.order=null;this.running=false;}
 setOrder(order){this.order=validateOrder(order);this.results={};}
 async save(){await this.persist(this.order);this.onChange();}
 async verify(){
  check(this.order,'No order selected.');validateOrder(this.order);this.results={};
  const o=this.order;
  const remember=async(t,proof,verified=false)=>{
   const saved=serialize(proof),changed=stringify(t.proof)!==stringify(saved)||(verified&&t.state!=='VERIFIED');
   if(changed){t.proof=saved;if(verified)t.state='VERIFIED';await this.save();}
  };
  for(const t of o.transactions){
   if(t.state==='REJECTED')continue;
   check(t.leg===progress(o.kind,this.results),'Order sequence is invalid.');
   const proof=await sourceProof(this.providers[t.chain],t,o.account);
   if(t.kind==='approval'){await remember(t,proof,true);continue;}
   if(!t.proof?.destination)await remember(t,proof);
   let result=proof;
   if(t.kind==='funding'){
    const status=await this.api('/api/lifi/status?'+new URLSearchParams({txHash:t.hash,fromChain:String(t.chain),toChain:String(t.targetChain),bridge:t.quote.tool}));
    result={...proof,destination:await fundingDestination(this.providers,t,o.account,status)};
   }else if(t.kind==='bridge')result={...proof,destination:await bridgeDestination(this.providers,t,o.account,proof,this.api)};
   await remember(t,result,true);
   this.results[t.leg]=result;
  }
  const complete=progress(o.kind,this.results)===3;
  if(complete&&o.state!=='COMPLETED'){o.state='COMPLETED';await this.save();}
  this.onChange();return this.results;
 }
 async fundingQuote(chain,amount,account){
  const targetChain=chain===56?5042:56;
  const params=new URLSearchParams({fromChain:String(chain),toChain:String(targetChain),fromToken:chain===5042?USDC:ZeroAddress,toToken:targetChain===5042?USDC:ZeroAddress,fromAmount:String(amount),fromAddress:account,toAddress:account,slippage:'0.005',allowDestinationCall:'false'});
  for(const tool of ['relaydepository','lifiIntents','across'])params.append('allowBridges',tool);
  const quote=await this.api('/api/lifi/quote?'+params);
  validateQuote(quote,{account,fromChain:chain,toChain:targetChain,amount});
  return {quote,chain,targetChain,amount,at:Date.now(),kind:'funding',to:quote.transactionRequest.to,data:quote.transactionRequest.data,value:BigInt(quote.transactionRequest.value)};
 }
 async buyBudget(received,account){
  // Reserve the message fee and a deliberately conservative source gas budget.
  // This reserve stays in the user's BNB wallet, it is not a platform fee.
  const app=new Contract(wotrRoutes.current.bsc,candidateAppAbi,this.providers[56]);
  const [fee,price]=await Promise.all([app.quoteSend([30417,'0x'+account.slice(2).padStart(64,'0'),parseEther('1'),parseEther('1'),options,'0x','0x'],false),this.providers[56].send('eth_gasPrice',[])]);
  const reserve=fee.nativeFee*125n/100n+BigInt(price)*4000000n;
  check(received>reserve,'Funding is too small after the WOTR message fee and BNB gas reserve.');
  return {budget:received-reserve,reserve};
 }
 async quote(){
  check(this.order,'Create an order first.');
  await this.verify();const o=this.order,index=progress(o.kind,this.results),key=legs(o.kind)[index];
  check(index<3,'This order is complete.');
  if(key==='funding'){
   const chain=o.kind==='buy'?5042:56;
   let amount=BigInt(o.input),reserve=0n;
   if(o.kind==='sell'){
    const price=BigInt(await this.providers[56].send('eth_gasPrice',[]));reserve=price*1000000n;
    amount=BigInt(this.results[1].received)-reserve;
    check(amount>0n,'Sale proceeds are too small after the return-transaction gas reserve.');
   }
   const result=await this.fundingQuote(chain,amount,o.account);
   if(o.kind==='buy'){
    const available=await this.buyBudget(BigInt(result.quote.estimate.toAmountMin),o.account);
    const source=await quoteNewBuy(this.providers[56],available.budget);
    result.preview={source,gasReserve:String(available.reserve),estimatedArcWotr:String(source.out/10n**12n*10n**12n)};
   }
   return {...result,leg:index,reserve};
  }
  if(key==='buy'){
   const received=BigInt(this.results[0].destination.received),available=await this.buyBudget(received,o.account);
   const q=await quoteNewBuy(this.providers[56],available.budget),deadline=BigInt((await this.providers[56].getBlock('latest')).timestamp)+600n;
   return {kind:'buy',leg:index,chain:56,amount:available.budget,quote:q,at:Date.now(),to:q.to,data:buyCall(q,o.account,deadline),value:q.msgValue,reserve:available.reserve,deadline:String(deadline)};
  }
  if(key==='sell'){
   const amount=BigInt(this.results[0].destination.received),q=await quoteSell(this.providers[56],amount),deadline=BigInt((await this.providers[56].getBlock('latest')).timestamp)+600n;
   let preview;
   try{const reserved=BigInt(await this.providers[56].send('eth_gasPrice',[]))*1000000n;if(q.minOut>reserved)preview=(await this.fundingQuote(56,q.minOut-reserved,o.account)).quote;}catch{}
   return {kind:'sell',leg:index,chain:56,amount,quote:q,at:Date.now(),to:q.to,data:sellCall(q,o.account,deadline),value:0n,deadline:String(deadline),preview};
  }
  const side=o.kind==='buy'?'bsc':'arc',chain=side==='bsc'?56:5042,targetChain=chain===56?5042:56;
  const amount=o.kind==='buy'?BigInt(this.results[1].received)/10n**12n*10n**12n:BigInt(o.input)*10n**12n;
  check(amount>0n,'Purchased WOTR is below bridge precision.');
  const p=await planCandidateTransfer({providers:{bsc:this.providers[56],arc:this.providers[5042]},networks,pair:wotrRoutes.current,side,account:o.account,amount:formatEther(amount),extraOptions:options});
  const result={kind:'bridge',leg:index,chain,targetChain,amount,at:Date.now(),to:p.to,data:p.data,value:p.value,key:p.key,token:wotrRoutes.current.sourceToken,spender:wotrRoutes.current.bsc,targetStart:await this.providers[targetChain].getBlockNumber()};
  if(o.kind==='sell'){
   result.preview=await quoteSell(this.providers[56],amount);
   const gasReserve=BigInt(await this.providers[56].send('eth_gasPrice',[]))*4000000n;
   check(result.preview.minOut>gasReserve,'Sale is too small after source gas and funding-return costs. Increase the amount before bridging.');
   result.returnPreview=(await this.fundingQuote(56,result.preview.minOut-gasReserve,o.account)).quote;
  }
  return result;
 }
 async ensureWallet(wallet){
  const values=await wallet.request({method:'eth_accounts'});
  check(same(values[0],this.order.account),'Wallet account changed. Reconnect the original wallet.');
 }
 async transact(wallet,selected){
  check(!this.running,'Another order operation is active.');this.running=true;
  try{
   check(Date.now()-selected.at<60000,'Quote expired. Refresh and review again.');
   const o=this.order;await this.verify();check(selected.leg===progress(o.kind,this.results),'Order progress changed. Refresh again.');
   await this.ensureWallet(wallet);
   if(Number(await wallet.request({method:'eth_chainId'}))!==selected.chain)await wallet.request({method:'wallet_switchEthereumChain',params:[{chainId:toQuantity(selected.chain)}]});
   await this.ensureWallet(wallet);
   check(Number(await wallet.request({method:'eth_chainId'}))===selected.chain,'Wallet network is incorrect.');
   let fresh=await this.quote();
   check(fresh.leg===selected.leg&&fresh.kind===selected.kind,'Order changed. Refresh again.');
   if(fresh.kind==='buy'){assertBuyRefresh(selected.quote,fresh.quote);fresh={...fresh,quote:{...fresh.quote,minOut:BigInt(selected.quote.minOut)},data:buyCall({...fresh.quote,minOut:BigInt(selected.quote.minOut)},o.account,BigInt(fresh.deadline))};}
   if(fresh.kind==='sell'){assertSellRefresh(selected.quote,fresh.quote);fresh.quote={...fresh.quote,minOut:BigInt(selected.quote.minOut),...(fresh.quote.route==='curve'?{minGross:BigInt(selected.quote.minGross)}:{})};fresh.data=sellCall(fresh.quote,o.account,BigInt(fresh.deadline));}
   if(fresh.kind==='funding')check(same(fresh.to,selected.to)&&BigInt(fresh.quote.estimate.toAmount)>=BigInt(selected.quote.estimate.toAmountMin),'Funding route or output changed. Refresh and review again.');
   // Funding calldata belongs to the quote the user reviewed; fresh is only a preflight comparison.
   if(fresh.kind==='funding'){validateQuote(selected.quote,{account:o.account,fromChain:selected.chain,toChain:selected.targetChain,amount:BigInt(selected.amount)});fresh=selected;}
   if(fresh.kind==='bridge')check(fresh.amount===selected.amount&&fresh.value<=selected.value,'Bridge amount or message fee changed. Refresh again.');
   let intent={...fresh};
   if(fresh.kind==='funding'&&fresh.chain===5042||fresh.kind==='sell'){
    const token=fresh.kind==='funding'?USDC:BUY.token,spender=fresh.kind==='funding'?fresh.quote.estimate.approvalAddress:fresh.to;
    const allowance=await new Contract(token,contractAbi,this.providers[fresh.chain]).allowance(o.account,spender);
    if(allowance<fresh.amount)intent={...fresh,kind:'approval',token,spender,to:token,data:tokenInterface.encodeFunctionData('approve',[spender,fresh.amount]),value:0n};
   }
   if(fresh.kind==='bridge'&&fresh.key==='approve')intent={...fresh,kind:'approval'};
   const p=this.providers[intent.chain];check(Number(await p.send('eth_chainId',[]))===intent.chain&&await p.getCode(intent.to)!=='0x','RPC or transaction contract mismatch.');
   const call={from:o.account,to:intent.to,data:intent.data,value:intent.value};
   const gas=await p.estimateGas(call);check(gas>=21000n&&gas<=2000000n,'Unexpected gas estimate.');
   const gasLimit=gas*13n/10n,gasPrice=BigInt(await p.send('eth_gasPrice',[]));let fees={gasPrice:toQuantity(gasPrice)},maxPrice=gasPrice;
   if(intent.chain===5042){const block=await p.getBlock('latest'),f=arcFeeParams(gasPrice,block.baseFeePerGas,BigInt(await p.send('eth_maxPriorityFeePerGas',[])));fees={maxFeePerGas:f.maxFeePerGas,maxPriorityFeePerGas:f.maxPriorityFeePerGas};maxPrice=f.maximumPrice;}
   const principal=intent.kind==='funding'&&intent.chain===5042?intent.amount*10n**12n:intent.value;
   check(await p.getBalance(o.account)>=principal+gasLimit*maxPrice,'Insufficient native balance for the payment and maximum gas.');
   await p.call(call);await this.ensureWallet(wallet);
   check(Date.now()-selected.at<60000,'Quote expired during preflight. Refresh again.');
   const nonce=await p.getTransactionCount(o.account,'pending');
   const record=serialize({...intent,nonce,state:'AWAITING_WALLET',hash:null});
   o.transactions.push(record);await this.save();
   try{
    await this.ensureWallet(wallet);
    check(Number(await wallet.request({method:'eth_chainId'}))===intent.chain,'Wallet network changed. Preserve this reserved attempt and recover before continuing.');
    check(Date.now()-selected.at<60000,'Quote expired after reservation. Preserve this attempt and verify before continuing.');
    record.hash=await wallet.request({method:'eth_sendTransaction',params:[{chainId:toQuantity(intent.chain),from:o.account,to:intent.to,data:intent.data,value:toQuantity(intent.value),gas:toQuantity(gasLimit),nonce:toQuantity(nonce),...fees}]});
    check(/^0x[0-9a-f]{64}$/i.test(record.hash),'Wallet did not return a valid transaction hash.');record.state='SUBMITTED';await this.save();
   }catch(error){
    if(!record.hash)record.state=error?.code===4001||error?.code==='ACTION_REJECTED'?'REJECTED':'UNCERTAIN';
    try{await this.save();}catch{}
    throw error;
   }
   return record;
  }finally{this.running=false;this.onChange();}
 }
}
