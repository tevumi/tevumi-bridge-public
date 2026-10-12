// Disposable unit/browser fixture. No mainnet providers, keys or broadcasts.
import {Interface,Wallet,ZeroAddress,id,keccak256,zeroPadValue} from 'ethers';
import {createCombinedOrder,assertJournalUpdate,stringify,legs} from '../../web/source-trade/order.js';
import {CombinedTradeEngine} from '../../web/source-trade/combined-engine.js';
import {combinedInterface,fundingDomain,fundingTypes} from '../../web/source-trade/combined-abi.js';
import {BUY} from '../../web/preview/buy-plan.js';
import {tokenInterface} from '../../web/source-trade/proofs.js';
import {USDC,ROUTERS,bridgeType} from '../../web/src/funding-validation.js';
import {candidateAppAbi} from '../../web/src/production-transfer.js';
import {wotrRoutes} from '../../web/src/wotr-routes.js';
const copy=v=>JSON.parse(stringify(v)),addr=n=>'0x'+String(n).repeat(40),hash=n=>'0x'+n.toString(16).padStart(64,'0');
const options='0x00030100110100000000000000000000000000030d40';
export async function combinedWalletRig({kind='buy',approved=false,reject=false,unknown=false,failSave=false,pending=false}={}){
 const signer=Wallet.createRandom(),account=Wallet.createRandom().address,code='0x6001';let sends=0,switches=0,chain=5042,allowance=approved?10n**30n:0n,hold=pending;
 const deployment={id:'isolated-wallet-route',quoteSigner:signer.address,...Object.fromEntries(['arcFunding','buyAndBridge','sellAndFund'].map((key,i)=>[key,{address:addr(i+1),codeHash:keccak256(code)}]))};
 let journal=createCombinedOrder(kind,account,'1','isolated-wallet-order',deployment);
 const relay=new Interface(['function startBridgeTokensViaRelayDepository('+bridgeType+',tuple(bytes32 orderId,address depositorAddress)) payable']);
 async function quote(o,leg){
  const deadline=String(Math.floor(Date.now()/1000)+60),at=Date.now();
  if(o.kind==='sell'&&leg===0){
   const amount=BigInt(o.input)*10n**12n,value=300000000000000000n,to=wotrRoutes.current.arc,param=[30102,zeroPadValue(o.account,32),amount,amount,options,'0x','0x'];
   return copy({kind:'bridge',leg,chain:5042,targetChain:56,to,data:new Interface(candidateAppAbi).encodeFunctionData('send',[param,[value,0n],o.account]),amount,value,deadline,at,targetStart:1,estimatedReceive:'2000000'});
  }
  if(o.kind==='buy'&&leg===1){
   const market={route:'curve',routeId:'curve',token:BUY.token,sender:BUY.manager,to:BUY.manager,msgValue:'1000000000000000',out:'101000000000000000000',minOut:'100000000000000000000'},minimumArcAmount=market.minOut,maxMessageFee='100000000000000';
   return {kind:'buybridge',leg,chain:56,targetChain:5042,to:deployment.buyAndBridge.address,amount:market.msgValue,value:'1100000000000000',deadline,at,targetStart:1,estimatedReceive:market.out,quote:{market,minimumArcAmount,maxMessageFee,options},data:combinedInterface.encodeFunctionData('buyAndBridge',[false,BigInt(market.msgValue),BigInt(minimumArcAmount),BigInt(maxMessageFee),BigInt(deadline),options])};
  }
  const source=o.kind==='buy'?5042:56,target=source===5042?56:5042,sender=deployment[source===5042?'arcFunding':'sellAndFund'].address,amount=source===5042?BigInt(o.input):450000000000000n;
  const minimumOutput=source===5042?1900000000000000n:1900000n,toAmount=source===5042?2000000000000000n:2000000n,b=[id('deposit-'+leg),'relaydepository','lifi-api',ZeroAddress,source===5042?USDC:ZeroAddress,o.account,amount,target,false,false];
  const inner=relay.encodeFunctionData('startBridgeTokensViaRelayDepository',[b,[id('relay-order'),sender]]);
  const authorization={user:o.account,amount:String(amount),minimumOutput:String(minimumOutput),nonce:id('tevumi-combined:'+deployment.id+':'+o.id+':'+leg),deadline,dataHash:keccak256(inner)};
  const signature=await signer.signTypedData(fundingDomain(source,sender),fundingTypes,authorization);
  const funding={tool:'relaydepository',action:{fromChainId:source,toChainId:target,fromAddress:sender,toAddress:o.account,fromAmount:String(amount),fromToken:{address:source===5042?USDC:ZeroAddress,decimals:source===5042?6:18},toToken:{address:target===5042?USDC:ZeroAddress,decimals:target===5042?6:18}},estimate:{toAmount:String(toAmount),toAmountMin:String(minimumOutput),approvalAddress:ROUTERS[source]},transactionRequest:{to:ROUTERS[source],from:sender,chainId:source,value:source===5042?'0':String(amount),data:inner}};
  const sale={useDex:false,minimumMarket:'500000000000000',minimumNet:'480000000000000',fundingAmount:String(amount)};
  return copy({kind:source===5042?'funding':'sellfunding',leg,chain:source,targetChain:target,to:sender,amount:source===5042?amount:BigInt(o.input)*10n**12n,value:source===5042?amount*10n**12n:0n,deadline,at,token:BUY.token,spender:sender,quote:{funding,authorization,signature,...(source===56?{sale}:{})},data:source===5042?combinedInterface.encodeFunctionData('fund',[authorization,inner,signature]):combinedInterface.encodeFunctionData('sellAndFund',[false,BigInt(o.input)*10n**12n,BigInt(sale.minimumMarket),authorization,inner,signature]),estimatedReceive:source===5042?'101000000000000000000':String(toAmount)});
 }
 function verify(o){
  const results={},proofs={};let pending=false;
  for(const t of o.transactions){
   if(t.state==='REJECTED')continue;
   if(!t.hash)throw Error('Recover the original transaction hash.');
   if(t.kind!=='approval'&&hold){pending=true;break;}
   const destination={hash:hash(100+t.leg),received:o.kind==='buy'?(t.leg===0?'2000000000000000':'101000000000000000000'):(t.leg===0?String(BigInt(o.input)*10n**12n):'2000000')};
   const proof={hash:t.hash,gas:'1000',...(t.kind!=='approval'?{destination}: {approvedAmount:String(allowance)})};
   proofs[t.hash]={...proof,verified:true};if(t.kind!=='approval')results[t.leg]=proof;
  }
  return {revision:o.revision,results,proofs,pending,complete:legs(o).every((_,leg)=>results[leg])};
 }
 const api=async(path,init)=>{
  const request=init?JSON.parse(init.body):null;if(request?.id!==journal.id)throw Error('Wrong saved order.');
  if(path==='/api/combined/verify')return verify(journal);
  if(path==='/api/combined/quote')return quote(journal,Object.keys(verify(journal).results).length);
  throw Error('Unexpected isolated API '+path);
 };
 const persist=async o=>{if(failSave&&o.transactions.length)throw Object.assign(Error('Isolated save failure'),{code:'SAVE_FAILED'});const next=copy({...o,revision:o.revision+1});assertJournalUpdate(journal,next);o.revision=next.revision;journal=next;};
 const providers=Object.fromEntries([56,5042].map(chain=>[chain,{send:async method=>method==='eth_chainId'?'0x'+chain.toString(16):'0xf4240',getCode:async()=>code,getBalance:async()=>100n*10n**18n,estimateGas:async()=>100000n,getBlock:async()=>({baseFeePerGas:1000000n}),getTransactionCount:async()=>sends,call:async tx=>{let c;try{c=tokenInterface.parseTransaction(tx);}catch{}return c?.name==='allowance'?tokenInterface.encodeFunctionResult('allowance',[allowance]):'0x';}}]));
 const engine=new CombinedTradeEngine({providers,api,persist});engine.setOrder(copy(journal));
 async function walletRequest(req){
  if(req.method==='eth_accounts'||req.method==='eth_requestAccounts')return [account];
  if(req.method==='eth_chainId')return '0x'+chain.toString(16);
  if(req.method==='wallet_switchEthereumChain'){chain=Number(req.params[0].chainId);switches++;return null;}
  if(req.method!=='eth_sendTransaction')throw Error('Unexpected wallet request '+req.method);
  sends++;if(reject||unknown)throw Object.assign(Error('Isolated wallet stop'),{code:reject?4001:-32000});
  let c;try{c=tokenInterface.parseTransaction({data:req.params[0].data});}catch{}
  if(c?.name==='approve')allowance=c.args[1];return hash(sends);
 }
 return {account,deployment,engine,providers,api,quote,verify,wallet:{request:walletRequest},walletRequest,release:()=>hold=false,get journal(){return copy(journal);},setJournal:o=>journal=copy(o),counts:()=>({financialConfirmations:sends,chainSwitches:switches})};
}
