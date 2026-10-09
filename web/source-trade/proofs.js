import {Interface,ZeroAddress,id,zeroPadValue} from 'ethers';
import {BUY,verifyBuyReceipt,buyCall} from '../preview/buy-plan.js';
import {sellManagerAbi,sellCall} from './sell-plan.js';
import {candidateAppAbi} from '../src/production-transfer.js';
import {wotrRoutes} from '../src/wotr-routes.js';
import {USDC,ROUTERS,validateQuote,bridgeType,same} from '../src/funding-validation.js';
export const tokenInterface=new Interface(['function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)','event Approval(address indexed owner,address indexed spender,uint256 value)','event Transfer(address indexed from,address indexed to,uint256 value)']);
export const oftInterface=new Interface(['event OFTSent(bytes32 indexed guid,uint32 dstEid,address indexed fromAddress,uint256 amountSentLD,uint256 amountReceivedLD)','event OFTReceived(bytes32 indexed guid,uint32 srcEid,address indexed toAddress,uint256 amountReceivedLD)']);
const started=new Interface(['event LiFiTransferStarted('+bridgeType+' bridgeData)']);
const sale=new Interface(sellManagerAbi),zero='0x'+'0'.repeat(40);
const check=(ok,message)=>{if(!ok)throw Error(message);};
// Official MetaMask Delegation Framework v1.3.0 deployment addresses:
// https://github.com/MetaMask/delegation-framework/releases/tag/v1.3.0
export const walletManager='0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3';
export const walletDelegator='0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B';
export const walletInterface=new Interface(['function redeemDelegations(bytes[] permissionContexts,bytes32[] modes,bytes[] executionCallDatas)']);
async function matchesWalletBridge(provider,tx,receipt,record,account){
 if(record.kind!=='bridge'||record.chain!==56||!same(tx.to,walletManager)||tx.value!==0n)return false;
 let decoded;try{decoded=walletInterface.parseTransaction({data:tx.data});}catch{return false;}
 if(!decoded||decoded.args.permissionContexts.length!==1||decoded.args.modes.length!==1||decoded.args.executionCallDatas.length!==1||decoded.args.modes[0]!=='0x'+'0'.repeat(64))return false;
 // A single packed CALL only; do not accept batches, arbitrary wrappers or changed intents.
 const packed=decoded.args.executionCallDatas[0];
 if(packed.length<106||!same('0x'+packed.slice(2,42),record.to)||BigInt('0x'+packed.slice(42,106))!==BigInt(record.value)||'0x'+packed.slice(106)!==record.data)return false;
 if(walletInterface.encodeFunctionData('redeemDelegations',decoded.args)!==tx.data)return false;
 if(!same(await provider.getCode(account,receipt.blockNumber),'0xef0100'+walletDelegator.slice(2)))return false;
 // The entire wallet native debit, excluding its actual gas, must equal this message fee.
 check(await nativeReceiptDelta(provider,receipt,account)===-BigInt(record.value),'Wrapped bridge payment differs from its intended message fee.');
 return true;
}
export const hashValid=v=>/^0x[0-9a-f]{64}$/i.test(v||'');
function events(receipt,address,iface,name){return receipt.logs.filter(l=>same(l.address,address)).flatMap(l=>{try{const e=iface.parseLog(l);return e?.name===name?[e]:[]}catch{return []}});}
export function transferred(receipt,token,from,to){return events(receipt,token,tokenInterface,'Transfer').filter(e=>same(e.args.from,from)&&same(e.args.to,to)).reduce((n,e)=>n+e.args.value,0n);}
export async function nativeReceiptDelta(provider,receipt,account){
 const block=await provider.getBlock(receipt.blockNumber,true);
 check(block,'Historical block is unavailable. Keep the original hash.');
 // More than one wallet-origin transaction would make an aggregate balance proof ambiguous.
 const transactions=block.prefetchedTransactions;
 check(transactions.filter(t=>same(t.from,account)).length<=1,'Multiple wallet transactions in this block need manual verification.');
 const [before,after]=await Promise.all([provider.getBalance(account,receipt.blockNumber-1),provider.getBalance(account,receipt.blockNumber)]);
 const self=transactions.find(t=>same(t.hash,receipt.hash)&&same(t.from,account));
 return after-before+(self?receipt.gasUsed*receipt.gasPrice:0n);
}
export async function sourceProof(provider,record,account){
 check(hashValid(record.hash),'Recover the original transaction hash first.');
 const [tx,receipt]=await Promise.all([provider.getTransaction(record.hash),provider.getTransactionReceipt(record.hash)]);
 check(tx&&receipt,'Transaction is not confirmed yet. Check the original hash again later.');
 check(receipt.status===1,'Transaction reverted. Keep this receipt and check gas before starting a new order.');
 check(same(tx.from,account)&&tx.nonce===record.nonce,'Original sender or nonce does not match this order.');
 const direct=same(tx.to,record.to)&&tx.data===record.data&&tx.value===BigInt(record.value);
 check(direct||await matchesWalletBridge(provider,tx,receipt,record,account),'Original transaction does not match this order.');
 let result={hash:record.hash,block:receipt.blockNumber,gas:String(receipt.gasUsed*receipt.gasPrice)};
 if(!direct)result.walletWrapper=walletManager;
 if(record.kind==='approval'){
  const call=tokenInterface.parseTransaction({data:record.data});
  check(call?.name==='approve'&&same(record.to,record.token)&&same(call.args[0],record.spender)&&call.args[1]===BigInt(record.amount),'Unexpected approval.');
  check(same(record.token,USDC)?record.chain===5042&&same(record.spender,ROUTERS[5042]):record.chain===56&&same(record.token,BUY.token)&&[BUY.manager,BUY.router,wotrRoutes.current.bsc].some(a=>same(a,record.spender)),'Approval token or spender is outside this route.');
  check(events(receipt,record.token,tokenInterface,'Approval').some(e=>same(e.args.owner,account)&&same(e.args.spender,record.spender)&&e.args.value===BigInt(record.amount)),'Exact approval event is missing.');
 }else if(record.kind==='funding'){
  const b=validateQuote(record.quote,{account,fromChain:record.chain,toChain:record.targetChain,amount:BigInt(record.amount)});
  check(record.data===record.quote.transactionRequest.data&&same(record.to,record.quote.transactionRequest.to)&&BigInt(record.value)===BigInt(record.quote.transactionRequest.value),'Saved funding call differs from its quote.');
  check(events(receipt,record.to,started,'LiFiTransferStarted').some(e=>same(e.args[0].transactionId,b.transactionId)&&same(e.args[0].receiver,account)&&Number(e.args[0].destinationChainId)===record.targetChain),'Funding event does not match this order.');
  if(record.chain===5042){
   const debit=events(receipt,USDC,tokenInterface,'Transfer').filter(e=>same(e.args.from,account)).reduce((n,e)=>n+e.args.value,0n);
   check(debit===BigInt(record.amount),'Actual USDC debit does not match funding input.');
  }
 }else if(record.kind==='buy'){
  check(same(record.quote.token,BUY.token),'Wrong purchase token.');
  check(record.chain===56&&same(record.to,record.quote.route==='curve'?BUY.manager:BUY.router)&&record.data===buyCall(record.quote,account,BigInt(record.deadline))&&BigInt(record.value)===BigInt(record.quote.msgValue),'Purchase call differs from its reviewed source quote.');
  result.received=String(verifyBuyReceipt(receipt,account,record.quote));
 }else if(record.kind==='sell'){
  const q=record.quote,amount=BigInt(record.amount);
  check(same(q.token,BUY.token)&&same(record.to,q.to),'Wrong sale token or route.');
  check(record.chain===56&&same(record.to,q.route==='curve'?BUY.manager:BUY.router)&&record.data===sellCall(q,account,BigInt(record.deadline))&&BigInt(record.value)===0n,'Sale call differs from its reviewed source quote.');
  check(transferred(receipt,BUY.token,account,q.sender)===amount,'Sale token debit does not match.');
  const received=await nativeReceiptDelta(provider,receipt,account);
  check(received>0n,'Sale did not deliver BNB.');
  if(q.route==='curve'){
   const matched=events(receipt,BUY.manager,sale,'TokenSale').filter(e=>same(e.args.token,BUY.token)&&same(e.args.account,account));
   check(matched.length===1&&matched[0].args.amount===amount&&matched[0].args.cost>=BigInt(q.minGross)&&matched[0].args.cost-matched[0].args.fee===received,'Curve sale event or actual net receipt does not match.');
  }else check(received>=BigInt(q.minOut),'DEX sale received less than its minimum.');
  result.received=String(received);
 }else if(record.kind==='bridge'){
  const route=wotrRoutes.current,from=record.chain===56?route.bsc:route.arc;
  const decoded=new Interface(candidateAppAbi).parseTransaction({data:record.data});
  check(decoded?.name==='send'&&Number(decoded.args[0].dstEid)===(record.chain===56?30417:30102)&&same(decoded.args[0].to,zeroPadValue(account,32))&&decoded.args[0].amountLD===BigInt(record.amount)&&decoded.args[0].minAmountLD===BigInt(record.amount)&&same(decoded.args[2],account)&&decoded.args[1].nativeFee===BigInt(record.value),'Bridge calldata does not match this order.');
  const found=events(receipt,from,oftInterface,'OFTSent').filter(e=>same(e.args.fromAddress,account)&&Number(e.args.dstEid)===(record.chain===56?30417:30102)&&e.args.amountSentLD===BigInt(record.amount)&&e.args.amountReceivedLD===BigInt(record.amount));
  check(same(record.to,from)&&found.length===1,'Bridge event does not match this token, route or amount.');
  check(transferred(receipt,record.chain===56?route.sourceToken:route.arc,account,record.chain===56?route.bsc:zero)===BigInt(record.amount),'Bridge lock or burn is missing.');
  result.guid=found[0].args.guid;
 }else throw Error('Unknown order transaction kind.');
 return result;
}
export async function fundingDestination(providers,record,account,status){
 check(status.status==='DONE'&&status.substatus==='COMPLETED','Funding is not fully completed. Keep checking this original order.');
 check(same(status.sending?.txHash,record.hash)&&Number(status.receiving?.chainId)===record.targetChain&&same(status.receiving?.token?.address,record.targetChain===5042?USDC:ZeroAddress),'Provider destination identity mismatch.');
 const hash=status.receiving?.txHash;check(hashValid(hash),'Destination hash is unavailable.');
 const provider=providers[record.targetChain],receipt=await provider.getTransactionReceipt(hash);
 check(receipt?.status===1,'Destination has not confirmed.');
 const received=BigInt(status.receiving.amount),scale=record.targetChain===5042?10n**12n:1n;
 check(received>=BigInt(record.quote.estimate.toAmountMin)&&received>0n,'Destination amount is below the quoted minimum.');
 check(await nativeReceiptDelta(provider,receipt,account)===received*scale,'Actual destination balance change does not match.');
 if(record.targetChain===5042){
  const credits=events(receipt,USDC,tokenInterface,'Transfer').filter(e=>same(e.args.to,account)).reduce((n,e)=>n+e.args.value,0n);
  const tx=await provider.getTransaction(hash);
  check(credits===received||(same(tx?.to,account)&&tx.value===received*scale),'Destination USDC transfer does not match.');
 }
 return {hash,block:receipt.blockNumber,received:String(received)};
}
export async function bridgeDestination(providers,record,account,proof,api){
 const route=wotrRoutes.current,chain=record.targetChain,address=chain===56?route.bsc:route.arc,p=providers[chain];
 let targetHash=record.destinationHash||record.proof?.destination?.hash;
 if(!targetHash){
  try{const data=await api('/api/lz/'+proof.guid);targetHash=data.data?.find(m=>same(m.guid,proof.guid)&&m.pathway?.srcEid===(record.chain===56?30102:30417)&&m.pathway?.dstEid===(chain===56?30102:30417))?.destination?.tx?.txHash;}catch{}
 }
 if(!targetHash){
  const head=await p.getBlockNumber(),start=Number(record.targetStart);
  check(Number.isSafeInteger(start)&&start>=0&&head-start<=2000,'Arrival lookup needs the destination hash; recover it from LayerZero Scan.');
  for(let from=start;from<=head;from+=50){
   const logs=await p.getLogs({address,fromBlock:from,toBlock:Math.min(head,from+49),topics:[id('OFTReceived(bytes32,uint32,address,uint256)'),proof.guid,zeroPadValue(account,32)]});
   if(logs.length){targetHash=logs[0].transactionHash;break;}
  }
 }
 check(hashValid(targetHash),'Bridge arrival is pending. Do not send again.');
 const receipt=await p.getTransactionReceipt(targetHash);
 check(receipt?.status===1,'Bridge destination is not confirmed.');
 const matches=events(receipt,address,oftInterface,'OFTReceived').filter(e=>same(e.args.guid,proof.guid)&&same(e.args.toAddress,account)&&Number(e.args.srcEid)===(record.chain===56?30102:30417)&&e.args.amountReceivedLD===BigInt(record.amount));
 check(matches.length===1&&transferred(receipt,chain===56?route.sourceToken:route.arc,chain===56?route.bsc:zero,account)===BigInt(record.amount),'Bridge destination mint or release does not match.');
 return {hash:targetHash,block:receipt.blockNumber,received:record.amount};
}
