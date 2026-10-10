import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AbiCoder,Interface,ZeroAddress,parseEther,zeroPadValue} from 'ethers';
import {createOrder,assertJournalUpdate,validateOrder,stringify} from '../web/source-trade/order.js';
import {TradeEngine,networks} from '../web/source-trade/engine.js';
import {BUY,helperAbi,managerAbi,dexAbi} from '../web/preview/buy-plan.js';
import {sellHelperAbi,sellManagerAbi,sellDexAbi,sellCall,quoteSell} from '../web/source-trade/sell-plan.js';
import {candidateAppAbi} from '../web/src/production-transfer.js';
import {tokenInterface,oftInterface,sourceProof,walletManager,walletDelegator,walletInterface} from '../web/source-trade/proofs.js';
import {wotrRoutes} from '../web/src/wotr-routes.js';
import {USDC,ROUTERS,bridgeType} from '../web/src/funding-validation.js';
const user='0x'+'1'.repeat(40),pair='0x'+'2'.repeat(40),out=parseEther('10000'),guid='0x'+'a'.repeat(64);
const info=[2n,BUY.manager,ZeroAddress,4000000000n,100n,0n,0n,parseEther('800000000'),parseEther('800000000'),0n,parseEther('13.9'),false];
const iface=new Interface([...sellHelperAbi,...candidateAppAbi,...sellDexAbi,'function decimals() view returns(uint8)','function eid() view returns(uint32)','function allowance(address,address) view returns(uint256)','function owner() view returns(address)','function getPair(address,address) view returns(address)','function token0() view returns(address)','function token1() view returns(address)','function getReserves() view returns(uint112,uint112,uint32)']);
const started=new Interface(['event LiFiTransferStarted('+bridgeType+' bridgeData)']);
const log=(contract,address,event,args)=>({address,...contract.encodeEventLog(event,args)});
const clone=value=>JSON.parse(stringify(value));
function rig({reject=false,uncertain=false,wrongTarget=false,partial=false,graduate=false,failSave=false,approvalDelta=0n}={}){
 const txs=new Map(),receipts=new Map(),blocks=new Map(),deltas=new Map(),allowances=new Map(),quotes=new Map();let serial=1,walletChain=5042,writes=0,journal=null;
 const native=amount=>'0x'+amount.toString(16);
 const providers=Object.fromEntries([56,5042].map(chain=>[chain,{
  getNetwork:async()=>({chainId:BigInt(chain)}),getCode:async()=> '0x6000',getBlockNumber:async()=>100,
  getBlock:async n=>blocks.get(chain+':'+n)||{number:100,timestamp:1791510000,baseFeePerGas:1000000n,prefetchedTransactions:[]},
  getBalance:async(account,block)=>block===undefined?parseEther('100'):deltas.get(chain+':'+block)||parseEther('1'),
  send:async(method)=>method==='eth_chainId'?native(BigInt(chain)):method==='eth_maxPriorityFeePerGas'?'0x1':'0xf4240',
  getTransactionCount:async()=>serial,
  estimateGas:async()=>100000n,
  getTransaction:async hash=>txs.get(hash)||null,getTransactionReceipt:async hash=>receipts.get(hash)||null,
  getLogs:async()=>[],
  call:async tx=>{
   let decoded;try{decoded=iface.parseTransaction({data:tx.data})}catch{}if(!decoded)return'0x';
   const name=decoded.name;let values;
   if(name==='getTokenInfo')values=[...info.slice(0,11),graduate];
   else if(name==='tryBuy'){const budget=decoded.args[2];values=[BUY.manager,ZeroAddress,out,budget*100n/101n,budget/101n,budget,0n,budget];}
   else if(name==='trySell')values=[BUY.manager,ZeroAddress,parseEther('0.002'),parseEther('0.00002')];
   else if(name==='factory')values=[BUY.factory];else if(name==='WETH')values=[BUY.wbnb];
   else if(name==='getPair')values=[pair];else if(name==='token0')values=[BUY.wbnb];else if(name==='token1')values=[BUY.token];else if(name==='getReserves')values=[parseEther('10'),parseEther('100000000'),0];else if(name==='getAmountsOut')values=[[decoded.args[0],decoded.args[1][0].toLowerCase()===BUY.token.toLowerCase()?parseEther('0.002'):out]];
   else if(name==='token'||name==='sourceToken')values=[BUY.token];
   else if(name==='endpoint')values=[networks[chain===56?'bsc':'arc'].endpoint];
   else if(name==='eid')values=[chain===56?30102:30417];
   else if(name==='peers')values=[zeroPadValue(wotrRoutes.current[chain===56?'arc':'bsc'],32)];
   else if(name==='depositsPaused'||name==='sendsPaused'||name==='receivesPaused')values=[false];
   else if(name==='outbound'||name==='inbound')values=[1000000000000000n,18446744073709551614n,18446744073709551615n,0n,0n,true];
   else if(name==='availableOutboundSD'||name==='availableInboundSD')values=[18446744073709551614n];
   else if(name==='principalLD')values=[0n];else if(name==='capacityLD')values=[parseEther('1000000000')];
   else if(name==='decimals')values=[18];else if(name==='balanceOf')values=[parseEther('1000000')];
   else if(name==='allowance')values=[allowances.get(tx.to.toLowerCase()+':'+decoded.args[1].toLowerCase())||0n];
   else if(name==='quoteSend')values=[[parseEther(chain===56?'0.00034':'0.27'),0n]];
   else if(['approve','send','swapExactTokensForETH','swapExactETHForTokens'].includes(name))return '0x';
   else throw Error('Unexpected test call '+name);
   return iface.encodeFunctionResult(name,values);
  },
 }]));
 const api=async path=>{
  if(path.startsWith('/api/lifi/quote')){
   const params=new URL(path,'http://local').searchParams,chain=Number(params.get('fromChain')),targetChain=Number(params.get('toChain')),amount=BigInt(params.get('fromAmount'));
   const b=['0x'+serial.toString(16).padStart(64,'0'), 'relaydepository','',ZeroAddress,chain===5042?USDC:ZeroAddress,user,amount,targetChain,false,false];
   const q={action:{fromChainId:chain,toChainId:targetChain,fromAddress:user,toAddress:user,fromAmount:String(amount),fromToken:{address:chain===5042?USDC:ZeroAddress,decimals:chain===5042?6:18},toToken:{address:targetChain===5042?USDC:ZeroAddress,decimals:targetChain===5042?6:18}},tool:'relaydepository',estimate:{toAmount:chain===5042?String(parseEther('0.0013')):'1400000',toAmountMin:chain===5042?String(parseEther('0.00129')):'1390000',approvalAddress:ROUTERS[chain],feeCosts:[],gasCosts:[]},transactionRequest:{to:ROUTERS[chain],from:user,chainId:chain,value:chain===56?String(amount):'0',data:'0x12345678'+AbiCoder.defaultAbiCoder().encode([bridgeType],[b]).slice(2)}};
   quotes.set(q.transactionRequest.data,q);return q;
  }
  if(path.startsWith('/api/lifi/status')){
   const hash=new URL(path,'http://local').searchParams.get('txHash'),tx=txs.get(hash),q=quotes.get(tx.data),targetHash=tx.targetHash;
   return {status:'DONE',substatus:partial?'PARTIAL':'COMPLETED',sending:{txHash:hash},receiving:{txHash:targetHash,chainId:q.action.toChainId,token:q.action.toToken,amount:q.estimate.toAmount}};
  }
  if(path.startsWith('/api/lz/'))return {data:[{guid,pathway:{srcEid:txs.get('bridge').to.toLowerCase()===wotrRoutes.current.bsc.toLowerCase()?30102:30417,dstEid:txs.get('bridge').to.toLowerCase()===wotrRoutes.current.bsc.toLowerCase()?30417:30102},destination:{tx:{txHash:txs.get('bridge').targetHash}}}]};
  throw Error('Unexpected API '+path);
 };
 const engine=new TradeEngine({providers,api,persist:async o=>{if(failSave)throw Error('Disk failure');if(journal)o.revision++;assertJournalUpdate(journal,o);journal=clone(o);}});
 const originalSet=engine.setOrder.bind(engine);engine.setOrder=o=>{if(!journal)journal=clone(o);originalSet(o);};
 function destination(chain,received,logs=[]){
  const hash='0x'+(++serial).toString(16).padStart(64,'0'),block=200+serial;
  const tx={hash,from:ROUTERS[chain],to:user,value:received,data:'0x',nonce:0};txs.set(hash,tx);
  receipts.set(hash,{hash,status:1,blockNumber:block,gasUsed:100000n,gasPrice:1000000n,logs});
  blocks.set(chain+':'+block,{prefetchedTransactions:[tx]});deltas.set(chain+':'+(block-1),parseEther('1'));deltas.set(chain+':'+block,parseEther('1')+received);return hash;
 }
 const wallet={request:async({method,params})=>{
  if(method==='eth_accounts')return[user];if(method==='eth_chainId')return native(BigInt(walletChain));if(method==='wallet_switchEthereumChain'){walletChain=Number(BigInt(params[0].chainId));return null;}
  assert.equal(method,'eth_sendTransaction');writes++;
  if(reject||uncertain)throw Object.assign(Error('Wallet error'),{code:reject?4001:-32000});
  const t=engine.order.transactions.at(-1),hash='0x'+(++serial).toString(16).padStart(64,'0'),block=100+serial;
  const tx={hash,from:user,to:t.to,data:t.data,value:BigInt(t.value),nonce:t.nonce};txs.set(hash,tx);let logs=[];
  if(t.kind==='approval'){const actual=BigInt(t.amount)+approvalDelta;tx.data=tokenInterface.encodeFunctionData('approve',[t.spender,actual]);logs=[log(tokenInterface,t.token,'Approval',[user,t.spender,actual])];allowances.set(t.token.toLowerCase()+':'+t.spender.toLowerCase(),actual);}
  else if(t.kind==='funding'){
   const b=AbiCoder.defaultAbiCoder().decode([bridgeType],'0x'+t.data.slice(10))[0];logs=[log(started,t.to,'LiFiTransferStarted',[b])];
   if(t.chain===5042)logs.push(log(tokenInterface,USDC,'Transfer',[user,t.to,BigInt(t.amount)]));
   const received=BigInt(t.quote.estimate.toAmount),credits=t.targetChain===5042?[log(tokenInterface,USDC,'Transfer',[ROUTERS[t.targetChain],user,received])]:[];
   tx.targetHash=destination(t.targetChain,received*(t.targetChain===5042?10n**12n:1n),credits);
  }else if(t.kind==='buy')logs=[log(tokenInterface,BUY.token,'Transfer',[t.quote.sender,user,out]),...(t.quote.route==='curve'?[log(new Interface(managerAbi),BUY.manager,'TokenPurchase',[BUY.token,user,1n,out,1n,1n,1n,1n])]:[])];
  else if(t.kind==='bridge'){
   const amount=BigInt(t.amount),target=wotrRoutes.current[t.targetChain===56?'bsc':'arc'];
   logs=[log(oftInterface,t.to,'OFTSent',[guid,t.targetChain===56?30102:30417,user,amount,amount]),log(tokenInterface,t.chain===56?BUY.token:wotrRoutes.current.arc,'Transfer',[user,t.chain===56?t.to:ZeroAddress,amount])];
   tx.targetHash=destination(t.targetChain,0n,[log(oftInterface,target,'OFTReceived',[guid,t.chain===56?30102:30417,user,wrongTarget?amount-1n:amount]),log(tokenInterface,t.targetChain===56?BUY.token:wotrRoutes.current.arc,'Transfer',[t.targetChain===56?target:ZeroAddress,user,amount])]);txs.set('bridge',tx);
  }else if(t.kind==='sell'){
   const q=t.quote,net=BigInt(q.out),fee=BigInt(q.fee||0);logs=[log(tokenInterface,BUY.token,'Transfer',[user,q.sender,BigInt(t.amount)]),...(q.route==='curve'?[log(new Interface(sellManagerAbi),BUY.manager,'TokenSale',[BUY.token,user,1n,BigInt(t.amount),net+fee,fee,1n,1n])]:[])];
   deltas.set(56+':'+(block-1),parseEther('1'));deltas.set(56+':'+block,parseEther('1')+net-100000n*1000000n);
  }
  receipts.set(hash,{hash,status:1,blockNumber:block,gasUsed:100000n,gasPrice:1000000n,logs});blocks.set(t.chain+':'+block,{prefetchedTransactions:[tx]});return hash;
 }};
 return {engine,wallet,providers,writes:()=>writes,journal:()=>journal,receipts,txs};
}
async function complete(r,kind){r.engine.setOrder(createOrder(kind,user,kind==='buy'?'1':'1000','synthetic-order-1'));for(let i=0;i<8;i++){const q=await r.engine.quote();await r.engine.transact(r.wallet,q);await r.engine.verify();if(r.engine.order.state==='COMPLETED')return;}throw Error('Order did not complete');}
test('Arc buy and sell finish only after actual source receipts and both independent arrivals',async()=>{for(const kind of ['buy','sell']){const r=rig();await complete(r,kind);assert.equal(r.engine.order.state,'COMPLETED');assert.equal(r.writes(),kind==='buy'?5:4);assert.equal(Object.keys(r.engine.results).length,3);assert(r.journal().transactions.every(t=>t.state==='VERIFIED'&&t.proof?.gas));assert(r.journal().transactions.at(-1).proof.destination.hash);const restored=clone(r.journal());r.engine.setOrder(restored);await r.engine.verify();r.receipts.get(restored.transactions.at(-1).proof.destination.hash).status=0;await assert.rejects(r.engine.verify(),/reverted/);}});
test('unknown wallet result survives restart and never repeats the first payment',async()=>{const r=rig({uncertain:true});r.engine.setOrder(createOrder('sell',user,'1000','synthetic-order-1'));const q=await r.engine.quote();await assert.rejects(r.engine.transact(r.wallet,q));const restored=clone(r.journal());r.engine.setOrder(restored);await assert.rejects(r.engine.quote(),/original transaction hash/);assert.equal(r.writes(),1);});
test('explicit rejection permits review again; journal failure prevents any wallet send',async()=>{const r=rig({reject:true});r.engine.setOrder(createOrder('sell',user,'1000','synthetic-order-1'));await assert.rejects(r.engine.transact(r.wallet,await r.engine.quote()));assert.equal(r.engine.order.transactions[0].state,'REJECTED');await r.engine.quote();const blocked=rig({failSave:true});blocked.engine.setOrder(createOrder('sell',user,'1000','synthetic-order-1'));await assert.rejects(blocked.engine.transact(blocked.wallet,await blocked.engine.quote()),/Disk/);assert.equal(blocked.writes(),0);});
test('wrong WOTR arrival and partial funding cannot unlock a source trade',async()=>{for(const options of [{wrongTarget:true},{partial:true}]){const r=rig(options),kind=options.partial?'buy':'sell';r.engine.setOrder(createOrder(kind,user,kind==='buy'?'1':'1000','synthetic-order-1'));for(let i=0;i<2;i++){const q=await r.engine.quote();await r.engine.transact(r.wallet,q);try{await r.engine.verify()}catch{break;}}await assert.rejects(r.engine.quote());assert.equal(r.engine.results[0],undefined);}});
test('stale quotes, changed wallets, tampered assets, changed call intent and stale journal revisions fail closed',async()=>{const r=rig();r.engine.setOrder(createOrder('sell',user,'1000','synthetic-order-1'));const q=await r.engine.quote();await assert.rejects(r.engine.transact(r.wallet,{...q,at:0}),/expired/);await assert.rejects(r.engine.transact({request:async()=>['0x'+'2'.repeat(40)]},q),/account changed/);const bad=clone(r.engine.order);bad.asset.arc=ZeroAddress;assert.throws(()=>validateOrder(bad));assert.equal(r.writes(),0);await r.engine.transact(r.wallet,q);const a=clone(r.journal()),b=clone(a);assert.throws(()=>assertJournalUpdate(a,b),/another tab/);b.revision++;b.transactions[0].data='0x1234';assert.throws(()=>assertJournalUpdate(a,b),/intent/);});
test('curve sale encodes a gross minimum with zero router fee, and its estimated net is separate',async()=>{const r=rig(),q=await quoteSell(r.providers[56],parseEther('1000'));const decoded=new Interface(sellManagerAbi).parseTransaction({data:sellCall(q,user,1n)});assert.equal(decoded.args[3],(q.out+q.fee)*99n/100n);assert.equal(decoded.args[4],0n);assert(q.minOut<q.minGross);});


test('graduated source routes complete using the validated PancakeSwap pair in both directions',async()=>{for(const kind of ['buy','sell']){const r=rig({graduate:true});await complete(r,kind);assert.equal(r.engine.order.transactions.find(t=>t.kind===(kind==='buy'?'buy':'sell')).quote.route,'dex');assert.equal(r.engine.order.state,'COMPLETED');}});


test('MetaMask single-call bridge wrapper matches the original intent and actual wallet payment; mutations fail',async()=>{
 const r=rig();await complete(r,'buy');
 const record=r.engine.order.transactions.at(-1),tx=r.txs.get(record.hash),receipt=r.receipts.get(record.hash),p=r.providers[56];
 const original={...tx},balance=p.getBalance;
 const packed=record.to.toLowerCase()+BigInt(record.value).toString(16).padStart(64,'0')+record.data.slice(2);
 const args=[['0x1234'],['0x'+'0'.repeat(64)],[packed]];
 tx.to=walletManager;tx.value=0n;tx.data=walletInterface.encodeFunctionData('redeemDelegations',args);
 p.getCode=async()=> '0xef0100'+walletDelegator.slice(2);
 p.getBalance=async(a,b)=>b===receipt.blockNumber?parseEther('1')-BigInt(record.value)-receipt.gasUsed*receipt.gasPrice:b===receipt.blockNumber-1?parseEther('1'):balance(a,b);
 assert.equal((await sourceProof(p,record,user)).walletWrapper,walletManager);
 await r.engine.verify();assert.equal(Object.keys(r.engine.results).length,3);
 const valid={...tx};
 for(const changed of [{to:ZeroAddress},{from:ZeroAddress},{nonce:tx.nonce+1},{value:1n},{data:walletInterface.encodeFunctionData('redeemDelegations',[args[0],args[1],[packed.slice(0,-2)+'01']])},{data:walletInterface.encodeFunctionData('redeemDelegations',[args[0],['0x01'+'0'.repeat(62)],args[2]])},{data:walletInterface.encodeFunctionData('redeemDelegations',[['0x1234','0x1234'],[args[1][0],args[1][0]],[packed,packed]])}]){
  Object.assign(tx,valid,changed);await assert.rejects(sourceProof(p,record,user));
 }
 Object.assign(tx,valid);p.getCode=async()=> '0x6000';await assert.rejects(sourceProof(p,record,user));
 p.getCode=async()=> '0xef0100'+walletDelegator.slice(2);p.getBalance=async(a,b)=>b===receipt.blockNumber?parseEther('1')-BigInt(record.value)*2n-receipt.gasUsed*receipt.gasPrice:b===receipt.blockNumber-1?parseEther('1'):balance(a,b);await assert.rejects(sourceProof(p,record,user),/payment differs/);
 Object.assign(tx,original);
});


test('wallet-raised approvals complete both directions without repeated approval and keep original journal intent',async()=>{for(const kind of ['buy','sell']){const baseline=rig();await complete(baseline,kind);const r=rig({approvalDelta:parseEther('1')});await complete(r,kind);assert.equal(r.engine.order.state,'COMPLETED');assert.equal(r.writes(),baseline.writes());for(const t of r.engine.order.transactions.filter(t=>t.kind==='approval')){assert.equal(BigInt(t.proof.approvedAmount),BigInt(t.amount)+parseEther('1'));assert.equal(t.proof.requestedAmount,t.amount);assert.equal(tokenInterface.parseTransaction({data:t.data}).args[1],BigInt(t.amount));}}});
