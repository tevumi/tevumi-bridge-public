import {AbiCoder,Contract,Interface,ZeroAddress,id,keccak256,toQuantity,verifyTypedData,zeroPadValue} from 'ethers';
import {TradeEngine} from './engine.js';
import {legs,progress,stringify,validateOrder} from './order.js';
import {combinedInterface,fundingDomain,fundingTypes} from './combined-abi.js';
import {tokenInterface} from './proofs.js';
import {arcFeeParams} from '../immediate-deploy/arc-fees.js';
import {BUY} from '../preview/buy-plan.js';
import {USDC,bridgeType,same} from '../src/funding-validation.js';
import {candidateAppAbi} from '../src/production-transfer.js';
import {wotrRoutes} from '../src/wotr-routes.js';
const snapshot=v=>JSON.parse(stringify(v));
const check=(ok,message)=>{if(!ok)throw Error(message);};
const waiting=()=>Object.assign(Error('Original confirmation or arrival is pending.'),{code:'WAITING_PROOF'});
const post=value=>({method:'POST',headers:{'Content-Type':'application/json'},body:stringify(value)});

export function validateCombinedIntent(order,q){
 validateOrder(order);check(order.version===2&&q&&!q.previewOnly&&legs(order)[q.leg]===q.kind,'Combined quote does not match this order.');
 const chain=q.leg===0?5042:56,target=chain===5042?56:5042;
 check(q.chain===chain&&q.targetChain===target&&BigInt(q.value)>=0n&&BigInt(q.amount)>0n&&Number.isFinite(q.at)&&/^\d+$/.test(q.deadline),'Invalid combined quote direction.');
 if(q.kind==='bridge'){
  const call=new Interface(candidateAppAbi).parseTransaction({data:q.data});
  check(same(q.to,wotrRoutes.current.arc)&&call?.name==='send'&&Number(call.args[0].dstEid)===30102&&same(call.args[0].to,zeroPadValue(order.account,32))&&call.args[0].amountLD===BigInt(order.input)*10n**12n&&call.args[0].minAmountLD===call.args[0].amountLD&&call.args[1].nativeFee===BigInt(q.value)&&call.args[1].lzTokenFee===0n&&same(call.args[2],order.account),'Unexpected original WOTR send.');
  return q;
 }
 const entry=order.deployment[q.kind==='funding'?'arcFunding':q.kind==='buybridge'?'buyAndBridge':'sellAndFund'];
 check(same(q.to,entry.address),'Unexpected combined execution contract.');
 const call=combinedInterface.parseTransaction({data:q.data});
 check(call&&combinedInterface.encodeFunctionData(call.name,call.args)===q.data,'Noncanonical combined call.');
 if(q.kind==='buybridge'){
  const a=call.args,m=q.quote;
  check(call.name==='buyAndBridge'&&same(m.market.token,BUY.token)&&['curve','dex'].includes(m.market.route)&&a.useDex===(m.market.route==='dex')&&a.spend===BigInt(q.amount)&&a.spend===BigInt(m.market.msgValue)&&a.minimumArcAmount===BigInt(m.minimumArcAmount)&&a.minimumArcAmount>0n&&a.minimumArcAmount%10n**12n===0n&&a.minimumArcAmount>=BigInt(m.market.minOut)/10n**12n*10n**12n&&a.maxMessageFee===BigInt(m.maxMessageFee)&&a.deadline===BigInt(q.deadline)&&a.options===m.options&&BigInt(q.value)===a.spend+a.maxMessageFee,'Combined purchase protection changed.');
 }else{
  check(call.name===(q.kind==='funding'?'fund':'sellAndFund'),'Unexpected funding function.');
  const a=call.args.q,saved=q.quote.authorization,f=q.quote.funding;
  check(same(a.user,order.account)&&a.nonce===id('tevumi-combined:'+order.deployment.id+':'+order.id+':'+q.leg)&&a.deadline===BigInt(q.deadline)&&a.dataHash===keccak256(call.args.data)&&call.args.data===f.transactionRequest.data,'Funding authorization does not match this order.');
  check(same(verifyTypedData(fundingDomain(chain,q.to),fundingTypes,saved,call.args.signature),order.deployment.quoteSigner)&&q.quote.signature===call.args.signature,'Funding signer mismatch.');
  for(const key of ['user','nonce','dataHash'])check(same(a[key],saved[key]),'Funding authorization identity changed.');
  for(const key of ['amount','minimumOutput','deadline'])check(a[key]===BigInt(saved[key]),'Funding authorization value changed.');
  check(a.minimumOutput===BigInt(f.estimate.toAmountMin)&&a.minimumOutput>0n&&same(f.action.fromAddress,q.to)&&same(f.action.toAddress,order.account)&&BigInt(f.action.fromAmount)===a.amount,'Funding receiver or protected minimum changed.');
  const b=AbiCoder.defaultAbiCoder().decode([bridgeType],'0x'+call.args.data.slice(10))[0];
  check(same(b.receiver,order.account)&&Number(b.destinationChainId)===target&&same(b.sendingAssetId,chain===5042?USDC:ZeroAddress)&&!b.hasDestinationCall&&b.minAmount>0n&&b.minAmount<=a.amount,'Unexpected funding destination.');
  if(q.kind==='funding')check(a.amount===BigInt(order.input)&&BigInt(q.amount)===a.amount&&BigInt(q.value)===a.amount*10n**12n,'Native USDC payment amount changed.');
  else check(call.args.amount===BigInt(order.input)*10n**12n&&BigInt(q.amount)===call.args.amount&&BigInt(q.value)===0n&&call.args.minimumMarket===BigInt(q.quote.sale.minimumMarket)&&call.args.useDex===!!q.quote.sale.useDex&&a.amount<=BigInt(q.quote.sale.minimumNet)&&same(q.token,BUY.token)&&same(q.spender,q.to),'Sale amount or protection changed.');
 }
 return q;
}

export class CombinedTradeEngine extends TradeEngine{
 setOrder(order){validateOrder(order);check(order.version===2,'Combined engine cannot reinterpret a legacy order.');this.order=order;this.results={};}
 async verify(){
  const o=this.order;check(o,'No order selected.');validateOrder(o);
  const report=await this.api('/api/combined/verify',post({id:o.id}));
  check(report.revision===o.revision&&report.results&&report.proofs,'Order changed during server verification.');
  this.results=report.results;let changed=false;
  for(const t of o.transactions){
   const proof=t.hash?report.proofs[t.hash]:null;if(!proof)continue;
   check(same(proof.hash,t.hash),'Server returned a different transaction proof.');
   const saved=snapshot(proof);delete saved.verified;
   if(stringify(t.proof)!==stringify(saved)){t.proof=saved;changed=true;}
   if(proof.verified&&t.state!=='VERIFIED'){t.state='VERIFIED';changed=true;}
  }
  if(report.complete){check(progress(o,this.results)===2,'Server completion proof is incomplete.');if(o.state!=='COMPLETED'){o.state='COMPLETED';changed=true;}}
  if(changed)await this.save();this.onChange();
  if(report.pending)throw waiting();return this.results;
 }
 async quote(){
  await this.verify();const o=this.order,index=progress(o,this.results);check(index<2,'Order is already complete.');
  const q=await this.api('/api/combined/quote',post({id:o.id}));validateCombinedIntent(o,q);check(q.leg===index,'Order progress changed while quoting.');return q;
 }
 async transact(wallet,selected){
  check(!this.running,'Another order operation is active.');this.running=true;
  try{
   const o=this.order;validateCombinedIntent(o,selected);
   check(Date.now()-selected.at<60000,'Quote expired. Review a fresh quote.');
   await this.verify();check(selected.leg===progress(o,this.results),'Order progress changed.');
   await this.ensureWallet(wallet);
   if(Number(await wallet.request({method:'eth_chainId'}))!==selected.chain)await wallet.request({method:'wallet_switchEthereumChain',params:[{chainId:toQuantity(selected.chain)}]});
   await this.ensureWallet(wallet);check(Number(await wallet.request({method:'eth_chainId'}))===selected.chain,'Wallet network is incorrect.');
   const fresh=await this.quote();validateCombinedIntent(o,fresh);
   check(fresh.kind===selected.kind&&fresh.leg===selected.leg,'Order changed while reviewing.');
   if(fresh.kind==='bridge')check(BigInt(fresh.amount)===BigInt(selected.amount)&&BigInt(fresh.value)<=BigInt(selected.value),'Bridge fees changed. Review again.');
   else if(fresh.kind==='buybridge')check(fresh.quote.market.routeId===selected.quote.market.routeId&&BigInt(fresh.quote.minimumArcAmount)>=BigInt(selected.quote.minimumArcAmount),'Purchase price or route changed. Review again.');
   else{
    check(BigInt(fresh.quote.authorization.minimumOutput)>=BigInt(selected.quote.authorization.minimumOutput),'Funding output changed. Review again.');
    if(fresh.kind==='sellfunding')check(fresh.quote.sale.useDex===selected.quote.sale.useDex&&BigInt(fresh.quote.sale.minimumMarket)>=BigInt(selected.quote.sale.minimumMarket),'Sale price or route changed. Review again.');
   }
   if(fresh.kind==='buybridge')check(BigInt(fresh.value)<=BigInt(this.results[0].destination.received),'Purchase exceeds this order funding.');
   let intent={...fresh},approval=false;
   if(fresh.kind==='sellfunding'){
    check(BigInt(fresh.amount)===BigInt(this.results[0].destination.received),'Sale exceeds the actual WOTR arrival.');
    const allowance=await new Contract(BUY.token,tokenInterface,this.providers[56]).allowance(o.account,fresh.to);
    if(allowance<BigInt(fresh.amount)){
     approval=true;intent={...fresh,kind:'approval',to:BUY.token,token:BUY.token,spender:fresh.to,data:tokenInterface.encodeFunctionData('approve',[fresh.to,BigInt(fresh.amount)]),value:'0'};
    }
   }
   const p=this.providers[intent.chain];check(Number(await p.send('eth_chainId',[]))===intent.chain,'RPC network is incorrect.');
   if(intent.kind==='bridge'||approval)check(await p.getCode(intent.to)!=='0x','Transaction contract is unavailable.');
   else{
    const entry=o.deployment[intent.kind==='funding'?'arcFunding':intent.kind==='buybridge'?'buyAndBridge':'sellAndFund'];
    check(same(keccak256(await p.getCode(intent.to)),entry.codeHash),'Transaction deployment changed.');
   }
   const call={from:o.account,to:intent.to,data:intent.data,value:BigInt(intent.value)},gas=await p.estimateGas(call);
   check(gas>=21000n&&gas<=2000000n,'Unexpected gas estimate.');
   const gasLimit=gas*13n/10n,price=BigInt(await p.send('eth_gasPrice',[]));let maxPrice=price,fees={gasPrice:toQuantity(price)};
   if(intent.chain===5042){const block=await p.getBlock('latest'),f=arcFeeParams(price,block.baseFeePerGas,BigInt(await p.send('eth_maxPriorityFeePerGas',[])));maxPrice=f.maximumPrice;fees={maxFeePerGas:f.maxFeePerGas,maxPriorityFeePerGas:f.maxPriorityFeePerGas};}
   check(await p.getBalance(o.account)>=BigInt(intent.value)+gasLimit*maxPrice,'Insufficient native balance for payment and gas.');
   await p.call(call);await this.ensureWallet(wallet);
   check(Date.now()-fresh.at<60000&&BigInt(fresh.deadline)>BigInt(Math.floor(Date.now()/1000)),'Quote expired during preflight.');
   const nonce=await p.getTransactionCount(o.account,'pending'),record=snapshot({...intent,nonce,state:'AWAITING_WALLET',hash:null});
   o.transactions.push(record);await this.save();let requested=false;
   try{
    await this.ensureWallet(wallet);check(Number(await wallet.request({method:'eth_chainId'}))===intent.chain,'Wallet network changed.');
    check(Date.now()-fresh.at<60000&&BigInt(fresh.deadline)>BigInt(Math.floor(Date.now()/1000)),'Quote expired after reservation.');
    requested=true;record.hash=await wallet.request({method:'eth_sendTransaction',params:[{chainId:toQuantity(intent.chain),from:o.account,to:intent.to,data:intent.data,value:toQuantity(intent.value),gas:toQuantity(gasLimit),nonce:toQuantity(nonce),...fees}]});
    check(/^0x[0-9a-f]{64}$/i.test(record.hash),'Wallet returned no valid transaction hash.');record.state='SUBMITTED';await this.save();
   }catch(error){
    if(!record.hash)record.state=!requested||error?.code===4001||error?.code==='ACTION_REJECTED'?'REJECTED':'UNCERTAIN';
    if((error?.code===4001||error?.code==='ACTION_REJECTED')&&o.transactions.every(t=>t.state==='REJECTED'&&!t.hash))o.state='CANCELLED';
    try{await this.save();}catch{}throw error;
   }
   return record;
  }finally{this.running=false;this.onChange();}
 }
}
