import {BrowserProvider,Contract,Interface,formatEther,getAddress,id,keccak256,parseEther,zeroPadValue} from 'ethers';
import {rpc} from './rpc.js';
import {arcFeeParams} from './arc-fees.js';
import {classifyWalletSendError} from './wallet-result.js';
import {planCandidateTransfer,candidateAppAbi,candidateTokenAbi} from '../src/production-transfer.js';
import {pickWallet,rememberWalletSession,restoreWalletSession,clearWalletSession} from '../preview/wallet-picker.js';

const $=id=>document.getElementById(id);
const owner='0x489594537CB76aC256079D710B6E18498E1a5402';
let assetId=document.body.dataset.asset==='wotr'?'wotr':document.body.dataset.asset==='cat'?'cat':'binancelife';
const assetNames={binancelife:'币安人生',cat:'CAT',wotr:'WOTR'};
let assetName=assetNames[assetId];
const pairs={
 binancelife:{sourceToken:'0x924fa68a0fc644485b8df8abfa0a41c2e7744444',bsc:'0x89F3A44786C97618cc4b45721D433c9a83921ec4',arc:'0x9aF52E914DCC692Af046A136AC1c59f98F7347E7'},
 cat:{sourceToken:'0x6894cde390a3f51155ea41ed24a33a4827d3063d',bsc:'0x561750f93BAC5BC237De7FE092b9A40e1cC20b06',arc:'0x503200C60aaA078899B31268833c5F090693E30B'},
 wotr:{sourceToken:'0xB97b99cB6DC0EdBB89512e14100B2e9C23132eE5',bsc:'0xAC93aA5DFD4dFF9FC57C470FC6C9172F7a9bfbcf',arc:'0x70Cedd901366ad932203BBB08B22DcD4d4510028'},
};
let pair=pairs[assetId];
const admins={
 legacy:{bsc:'0xB2039D774574d9171E143cA30aAb48bB25b3F8e8',arc:'0x01dba01e9E6f40669d8D3036316967221Bc0081C'},
 wotr:{bsc:'0xD43448999ce7fA1FFE4783aB9D2D623FC9AC32db',arc:'0x95A128fbdc89f20b16b735b06bFBe0DF92AA68Df'},
};
const activeAdmin=()=>admins[assetId==='wotr'?'wotr':'legacy'];
const networks={bsc:{chainId:56,eid:30102,endpoint:'0x1a44076050125825900e736c501f859c50fe728c'},arc:{chainId:5042,eid:30417,endpoint:'0x6f475642a6e85809b1c36fa62763669b1b48dd5b'}};
const options='0x00030100110100000000000000000000000000030d40';
const legacyAmountLD=parseEther('0.000001');
let amount=assetId==='wotr'?'500':'0.000001',limits={bsc:null,arc:null},routeState=null;
const adminAbi=['function owner() view returns(address)','function executeBatch(address[] targets,bytes[] payloads)'];
const appAbi=[...candidateAppAbi,'function owner() view returns(address)','function guardian() view returns(address)','function setPauses(bool,bool)','function pause(bool,bool)',
 'event OFTSent(bytes32 indexed guid,uint32 dstEid,address indexed fromAddress,uint256 amountSentLD,uint256 amountReceivedLD)',
 'event OFTReceived(bytes32 indexed guid,uint32 srcEid,address indexed toAddress,uint256 amountReceivedLD)'];
const adminIface=new Interface(adminAbi),appIface=new Interface(appAbi),tokenIface=new Interface(candidateTokenAbi);
const storageKey=()=>`tevumi-immediate-${assetId}-live-v1`;
const providers=Object.fromEntries(Object.entries(networks).map(([side,network])=>[side,new BrowserProvider({request:({method,params=[]})=>rpc(network.chainId,method,params)})]));
let account=null,busy=false,records={};
let selectedWallet=null, walletEventHandlers=null;
export const selectedWalletProvider=()=>selectedWallet;
let selectedSide='bsc';
const activeTrackers=new Set();
const activeReconciliations=new Set();
export const bridgeView=()=>({account,assetId,selectedSide,amount,limitLD:limits[selectedSide],routeReady:routeState!==null,routePaused:routeState?routeState[selectedSide].sendPaused||routeState[selectedSide==='bsc'?'arc':'bsc'].receivePaused:null,records,busy});
export function amountValidation(value=amount){
 if(!/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)||!Number.isFinite(Number(value)))return '请输入最多 6 位小数的数量。';
 let amountLD;
 try{amountLD=parseEther(value);}catch{return '数量超出可用范围。';}
 if(amountLD<legacyAmountLD)return '最小数量为 0.000001 枚。';
 if(limits[selectedSide]!==null&&amountLD>limits[selectedSide])return `超过当前单笔上限 ${formatEther(limits[selectedSide])} 枚。`;
 return '';
}
export function selectAmount(value){ensure(!busy,'当前操作尚未完成，请等待结果。');amount=value;emitView();}
const recordAmount=record=>BigInt(record.amountLD??legacyAmountLD);
const emitView=()=>window.dispatchEvent(new CustomEvent('tevumi:bridge-view',{detail:{account}}));
const accountKey=()=>storageKey()+':'+account.toLowerCase();
const load=()=>{records={};try{const loaded=JSON.parse(localStorage.getItem(accountKey())||'{}');if(loaded&&typeof loaded==='object'&&!Array.isArray(loaded))records=loaded;}catch{/* keep empty */}renderRecords();};
const save=()=>{localStorage.setItem(accountKey(),JSON.stringify(records));renderRecords();};
async function clearVerifiedLegacyArcAttempt(){
 // One pre-fix attempt from the designated wallet was stored as unknown despite
 // no Arc transaction. Only clear that exact legacy shape if its next nonce is
 // still unused on both the confirmed and pending views.
 const record=records['send-arc'];
 if(assetId!=='binancelife'||!same(account,owner)||!record?.unknown||record.hash||record.nonceBefore!==undefined||!same(record.account,owner)||!same(record.to,pair.arc))return;
 try{
  const [prior,latest,pending]=await Promise.all([
   rpc(networks.arc.chainId,'eth_getTransactionByHash',['0x50a30a722958c8e446d0b54606c4ecf8cc8d5192c3ee0a512edef07f222a2c34']),
   rpc(networks.arc.chainId,'eth_getTransactionCount',[account,'latest']),
   rpc(networks.arc.chainId,'eth_getTransactionCount',[account,'pending']),
  ]);
  if(prior&&same(prior.from,account)&&BigInt(prior.nonce)===46n&&BigInt(latest)===47n&&BigInt(pending)===47n){delete records['send-arc'];save();}
 }catch{/* Keep the guard if verification is unavailable. */}
}
const note=value=>{$('message').textContent=value;};
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const ensure=(ok,message)=>{if(!ok)throw Error(message);};
const sideFor=kind=>kind.endsWith('arc')?'arc':'bsc';
const errorText=error=>String(error?.shortMessage??error?.message??'操作失败').replace(/https?:\/\/\S+/g,'[RPC]').slice(0,220);
async function publishTransfer(side,hash){
 if(document.body.dataset.historyApi!=='true'||!/^0x[0-9a-f]{64}$/i.test(hash))return;
 try{
  const response=await fetch('/api/transfers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chain:networks[side].chainId,hash}),signal:AbortSignal.timeout(8000)});
  if(response.ok)window.dispatchEvent(new Event('tevumi:history-changed'));
 }catch{/* Browser records retain the original hash; history service may be retried later. */}
}
function renderRecords(){
 if($('records'))$('records').textContent=Object.entries(records).map(([kind,item])=>`${kind}: ${item.hash??'广播结果不明'} ${item.guid??''} ${item.deliveredHash??''}`).join('\n')||'暂无记录';
 $('transfer-state').textContent=`BSC 发送：${records['send-bsc']?.hash??'未记录'}；Arc 到账：${records['send-bsc']?.deliveredHash??'未核验'}；Arc 返回：${records['send-arc']?.hash??'未记录'}；BSC 到账：${records['send-arc']?.deliveredHash??'未核验'}`;
 emitView();
}
async function connect(savedChoice=null){
 const choice=savedChoice || await pickWallet(document.documentElement.lang);
 if(!choice)return;
 const nextWallet=choice.provider;
 const list=savedChoice ? [savedChoice.account] : await nextWallet.request({method:'eth_requestAccounts'});
 ensure(list?.[0],'钱包未返回账户。');
 if(selectedWallet&&walletEventHandlers){
  selectedWallet.removeListener?.('accountsChanged',walletEventHandlers.accountsChanged);
  selectedWallet.removeListener?.('disconnect',walletEventHandlers.disconnect);
 }
 selectedWallet=nextWallet;
 const disconnected=()=>{account=null;records={};clearWalletSession();$('wallet-state').textContent='未连接钱包';$('fee-state').textContent='连接钱包后显示所选资产的余额。';note('');renderRecords();};
 walletEventHandlers={accountsChanged:accounts=>{if(!accounts?.length||!same(accounts[0],account))disconnected();},disconnect:disconnected};
 selectedWallet.on?.('accountsChanged',walletEventHandlers.accountsChanged);
 selectedWallet.on?.('disconnect',walletEventHandlers.disconnect);
 account=getAddress(list[0]);rememberWalletSession(choice,account);load();await clearVerifiedLegacyArcAttempt();
 for(const side of ['bsc','arc']){const item=records[`send-${side}`];if(item?.hash&&!item.deliveredHash)trackDelivery(side==='bsc'?'arc':'bsc',item.hash);}
 for(const kind of ['approve-bsc','send-bsc','send-arc'])if(records[kind]?.unknown)trackUnknown(kind);
 $('wallet-state').textContent=`已连接 ${account}`;await refresh(true);
}
async function switchTo(side){
 ensure(account&&selectedWallet,'请先连接钱包。');
 const chainId='0x'+networks[side].chainId.toString(16);
 if(!same(await selectedWallet.request({method:'eth_chainId'}),chainId))await selectedWallet.request({method:'wallet_switchEthereumChain',params:[{chainId}]});
 const accounts=await selectedWallet.request({method:'eth_accounts'});
 ensure(accounts?.length&&same(getAddress(accounts[0]),account),'钱包账户已切换，请重新连接。');
 ensure(same(await selectedWallet.request({method:'eth_chainId'}),chainId),'钱包网络切换失败。');
}
async function state(side){
 const provider=providers[side],app=new Contract(pair[side],appAbi,provider),other=side==='bsc'?'arc':'bsc';
 const [chain,code,appOwner,guardian,peer,sendPaused,receivePaused,outbound,inbound]=await Promise.all([
  provider.getNetwork(),provider.getCode(pair[side]),app.owner(),app.guardian(),app.peers(networks[other].eid),
  side==='bsc'?app.depositsPaused():app.sendsPaused(),app.receivesPaused(),app.outbound(),app.inbound(),
 ]);
 ensure(Number(chain.chainId)===networks[side].chainId&&code!=='0x'&&same(appOwner,activeAdmin()[side])&&same(guardian,owner)&&same(peer,zeroPadValue(pair[other],32)),`${side} 合约身份或 peer 不匹配。`);
 const governor=new Contract(activeAdmin()[side],adminAbi,provider);
 ensure(same(await governor.owner(),owner),`${side} 管理权限不匹配。`);
 return {sendPaused,receivePaused,outboundSingleLD:outbound.single*10n**12n,inboundSingleLD:inbound.single*10n**12n};
}
async function quoteStatus(){
 const target=$('fee-state');if(!target||!account)return;
 const quotedAccount=account;
 const quotedAsset=assetId;
 const quoteSide=selectedSide;
 if(document.body.dataset.balanceOnly==='true'){
  const local=(en,zh)=>document.documentElement.lang==='zh-CN'?zh:en;
  const source=quoteSide==='bsc'?'BNB Chain':'Arc';
  const destination=quoteSide==='bsc'?'Arc':'BNB Chain';
  const gasToken=quoteSide==='bsc'?'BNB':'USDC';
  target.textContent=local('Loading source wallet balances…','正在读取来源链钱包余额…');
  const provider=providers[quoteSide];
  const token=quoteSide==='bsc'?new Contract(pair.sourceToken,candidateTokenAbi,provider):new Contract(pair.arc,appAbi,provider);
  const showDestination=Boolean(records[`send-${quoteSide}`]?.deliveredHash);
  const destinationToken=showDestination?(quoteSide==='bsc'?new Contract(pair.arc,appAbi,providers.arc):new Contract(pair.sourceToken,candidateTokenAbi,providers.bsc)):null;
  const [balance,native,arrival]=await Promise.allSettled([
   token.balanceOf(quotedAccount),provider.getBalance(quotedAccount),
   destinationToken?destinationToken.balanceOf(quotedAccount):Promise.resolve(null),
  ]);
  if(!same(account,quotedAccount)||selectedSide!==quoteSide||assetId!==quotedAsset)return;
  const lines=[
   balance.status==='fulfilled'?local(`${source} available: ${formatEther(balance.value)} ${assetName}`,`${source} 可用余额：${formatEther(balance.value)} ${assetName}`):local(`${source} ${assetName} balance temporarily unavailable.`,`${source} ${assetName} 余额暂不可用。`),
   native.status==='fulfilled'?local(`${source} gas balance: ${formatEther(native.value)} ${gasToken} · also pays the message fee`,`${source} Gas 余额：${formatEther(native.value)} ${gasToken} · 也支付消息费`):local(`${source} gas balance temporarily unavailable.`,`${source} Gas 余额暂不可用。`),
  ];
  if(showDestination)lines.push(arrival.status==='fulfilled'?local(`${destination} current balance: ${formatEther(arrival.value)} ${assetName}`,`${destination} 当前余额：${formatEther(arrival.value)} ${assetName}`):local(`${destination} ${assetName} balance temporarily unavailable.`,`${destination} ${assetName} 余额暂不可用。`));
  target.textContent=lines.join('\n');
  return;
 }
 target.textContent='正在读取双向余额和消息费报价…';
 const result=await Promise.allSettled([quoteSide].map(async side=>{
  const other=side==='bsc'?'arc':'bsc',provider=providers[side];
  const app=new Contract(pair[side],appAbi,provider);
  const token=side==='bsc'?new Contract(pair.sourceToken,candidateTokenAbi,provider):app;
  const params=[networks[other].eid,zeroPadValue(quotedAccount,32),parseEther(amount),parseEther(amount),options,'0x','0x'];
  const [balance,native,fee]=await Promise.all([token.balanceOf(quotedAccount),provider.getBalance(quotedAccount),app.quoteSend(params,false)]);
  ensure(fee.lzTokenFee===0n,'消息费币种异常。');
  return {balance,native,fee:fee.nativeFee};
 }));
 if(!same(account,quotedAccount)||selectedSide!==quoteSide||assetId!==quotedAsset)return;
 target.textContent=result.map((item,index)=>{
  const side=quoteSide==='bsc'?'BNB Chain':'Arc',unit=quoteSide==='bsc'?'BNB':'Arc 原生币';
  if(item.status!=='fulfilled')return `${side}：报价暂不可用。发送前仍会重新核算。`;
  const {balance,native,fee}=item.value;
  const shortage=balance<parseEther(amount)?'；代币不足本次 0.000001 枚':native<=fee?'；原生币不足消息费与 Gas':'';
  return `${side} 钱包：${assetName} ${formatEther(balance)} 枚，${unit} ${formatEther(native)}；消息费报价 ${formatEther(fee)} ${unit} + 链上 Gas${shortage}。`;
 }).join('\n')+'\n报价会变化，钱包确认前按最新数据重新计算。';
}
export async function selectDirection(side){
 ensure(side==='bsc'||side==='arc','不支持的跨链方向。');
 ensure(!busy,'当前操作尚未完成，请等待结果。');
 selectedSide=side;emitView();
 if(account)await quoteStatus();
}
async function refresh(withQuote=false){
 routeState=null;emitView();
 const [b,a]=await Promise.all([state('bsc'),state('arc')]);
 routeState={bsc:b,arc:a};
 limits={bsc:b.outboundSingleLD<a.inboundSingleLD?b.outboundSingleLD:a.inboundSingleLD,arc:a.outboundSingleLD<b.inboundSingleLD?a.outboundSingleLD:b.inboundSingleLD};
 $('chain-state').textContent=`BSC：发送${b.sendPaused?'暂停':'开放'} / 接收${b.receivePaused?'暂停':'开放'}；Arc：发送${a.sendPaused?'暂停':'开放'} / 接收${a.receivePaused?'暂停':'开放'}。`;
 renderRecords();if(withQuote)await quoteStatus();return routeState;
}
async function request(side,to,data,value=0n){
 const chainId=networks[side].chainId;
 const [network,gasEstimate,gasPrice,native]=await Promise.all([
  rpc(chainId,'eth_chainId',[]),rpc(chainId,'eth_estimateGas',[{from:account,to,data,value:'0x'+value.toString(16)}]),
  rpc(chainId,'eth_gasPrice',[]),rpc(chainId,'eth_getBalance',[account,'latest']),
 ]);
 ensure(Number(BigInt(network))===chainId,'只读 RPC 网络不符。');
 const gas=BigInt(gasEstimate)*120n/100n+1n,price=BigInt(gasPrice);
 ensure(gas>=21000n&&gas<3000000n&&price>0n,'Gas 估算或费率异常。');
 const tx={from:account,to,data,value:'0x'+value.toString(16),gas:'0x'+gas.toString(16),chainId:'0x'+chainId.toString(16)};
 let maximumPrice=price;
 if(side==='bsc')tx.gasPrice='0x'+price.toString(16);
 else{
  const [block,priority]=await Promise.all([rpc(chainId,'eth_getBlockByNumber',['latest',false]),rpc(chainId,'eth_maxPriorityFeePerGas',[])]);
  ensure(typeof block?.baseFeePerGas==='string','Arc 基础费报价不可用。');
  const fees=arcFeeParams(price,block.baseFeePerGas,priority);
  maximumPrice=fees.maximumPrice;
  tx.maxPriorityFeePerGas=fees.maxPriorityFeePerGas;tx.maxFeePerGas=fees.maxFeePerGas;
 }
 ensure(BigInt(native)>=value+gas*maximumPrice,'钱包余额不足以覆盖本笔最高网络费用。');
 return tx;
}
async function submit(kind,side,to,data,value=0n,amountLD){
 ensure(!records[kind]?.hash&&!records[kind]?.unknown,`${kind} 已有交易或结果不明；先核验原哈希。`);
 await switchTo(side);
 const tx=await request(side,to,data,value);
 const [sourceStart,targetStart]=await Promise.all([providers[side].getBlockNumber(),kind.startsWith('send-')?providers[side==='bsc'?'arc':'bsc'].getBlockNumber():undefined]);
 const nonceBefore=await rpc(networks[side].chainId,'eth_getTransactionCount',[account,'pending']);
 records[kind]={unknown:true,to,dataHash:keccak256(data),account,side,sourceStart,targetStart,nonceBefore,...(amountLD===undefined?{}:{amountLD:amountLD.toString()})};save();
 note(`${kind} 正在请求钱包确认；请核对网络、合约和费用。`);
 let hash;
 try{hash=await selectedWallet.request({method:'eth_sendTransaction',params:[tx]});}
 catch(error){
  const outcome=classifyWalletSendError(error);
  if(outcome==='rejected'){delete records[kind];save();throw Error('已在钱包拒绝，未提交交易。');}
  if(outcome==='not_submitted'){delete records[kind];save();throw Error(`钱包未提交交易：${errorText(error)}`);}
  trackUnknown(kind);throw Error('正在核对上一笔交易，请勿重复发起。');
 }
 if(!/^0x[0-9a-f]{64}$/i.test(hash)){trackUnknown(kind);throw Error('正在核对上一笔交易，请勿重复发起。');}
 records[kind]={...records[kind],hash,unknown:false};save();
 if(kind.startsWith('send-'))void publishTransfer(side,hash);
 note(`${kind} 已提交 ${hash}；正在等待回执。`);
 try{
  const receipt=await providers[side].waitForTransaction(hash,1,120000);
  ensure(receipt,'回执等待超时。原哈希已保存，请刷新或按哈希恢复。');
  await verifyRecord(kind,hash);await refresh(true);note(`${kind} 回执已核验：${hash}`);
 }finally{
  if(kind.startsWith('send-')){
   void publishTransfer(side,hash);
   // A receipt/RPC failure must not leave a saved source hash without a tracker.
   trackDelivery(side==='bsc'?'arc':'bsc',hash);
  }
 }
}
function trackDelivery(side,hash){
 const trackedAsset=assetId,trackedAccount=account,origin=side==='arc'?'bsc':'arc';
 const key=`${trackedAsset}:${trackedAccount}:${side}:${hash}`;
 if(activeTrackers.has(key))return;
 activeTrackers.add(key);
 const poll=async attempt=>{
  if(assetId!==trackedAsset||!same(account,trackedAccount)||records[`send-${origin}`]?.hash!==hash||records[`send-${origin}`]?.deliveredHash){activeTrackers.delete(key);return;}
  try{await delivered(side);}catch(error){if(attempt===29)note(`自动核验暂不可用：${errorText(error)}。可稍后手动核验。`);}
  if(records[`send-${origin}`]?.deliveredHash||attempt>=29){activeTrackers.delete(key);return;}
  setTimeout(()=>poll(attempt+1),10000);
 };
 setTimeout(()=>poll(0),10000);
}
async function reconcileUnknown(kind){
 const record=records[kind];
 if(!record?.unknown||!record.dataHash||!same(record.account,account))return false;
 const trackedAsset=assetId,trackedAccount=account,trackedPair=pair;
 const stillCurrent=()=>assetId===trackedAsset&&same(account,trackedAccount)&&records[kind]===record;
 const side=sideFor(kind),provider=providers[side],candidates=[];
 if(kind.startsWith('send-')&&document.body.dataset.historyApi==='true'){
  try{
   const response=await fetch(`/api/transfers?account=${encodeURIComponent(account)}&page=0`,{signal:AbortSignal.timeout(8000)});
   if(response.ok){
    const result=await response.json();
    for(const item of result.items??[])if(item.asset===trackedAsset&&item.chain===networks[side].chainId&&/^0x[0-9a-f]{64}$/i.test(item.source_hash))candidates.push(item.source_hash);
   }
  }catch{/* An indexed event scan remains available. */}
 }
 const tryCandidate=async hash=>{
  if(!stillCurrent())return false;
  try{
   const tx=await provider.getTransaction(hash);
   if(!stillCurrent())return false;
   if(!tx||record.nonceBefore!==undefined&&BigInt(tx.nonce)!==BigInt(record.nonceBefore)||!same(tx.from,record.account)||!same(tx.to,record.to)||keccak256(tx.data)!==record.dataHash)return false;
   await verifyRecord(kind,hash);
  }catch{return false;}
  if(!stillCurrent())return false;
  try{await refresh();}catch{/* The verified source record is still retained. */}
  if(kind.startsWith('send-')){
   await publishTransfer(side,hash);
   const destination=side==='bsc'?'arc':'bsc';
   try{await delivered(destination);}catch{/* Keep the source record and continue checking arrival. */}
   if(!records[kind]?.deliveredHash)trackDelivery(destination,hash);
  }
  return true;
 };
 for(const hash of candidates)if(await tryCandidate(hash))return true;
 const head=await provider.getBlockNumber();
 const first=Number.isSafeInteger(record.sourceStart)?Math.max(0,record.sourceStart-1):Math.max(0,head-8192);
 const approval=kind==='approve-bsc';
 const topic=approval?id('Approval(address,address,uint256)'):appIface.getEvent('OFTSent').topicHash;
 const topics=approval?[topic,zeroPadValue(record.account,32),zeroPadValue(trackedPair.bsc,32)]:[topic,null,zeroPadValue(record.account,32)];
 const address=approval?trackedPair.sourceToken:trackedPair[side];
 for(let end=head;end>=first;end-=2000){
  if(!stillCurrent())return false;
  const logs=await provider.getLogs({address,topics,fromBlock:Math.max(first,end-1999),toBlock:end});
  for(const log of logs.reverse())if(await tryCandidate(log.transactionHash))return true;
 }
 return false;
}
function trackUnknown(kind){
 const trackedAsset=assetId,trackedAccount=account,key=`${trackedAsset}:${trackedAccount}:${kind}`;
 if(activeReconciliations.has(key))return;
 activeReconciliations.add(key);
 const poll=async attempt=>{
  if(assetId!==trackedAsset||!same(account,trackedAccount)||!records[kind]?.unknown){activeReconciliations.delete(key);return;}
  try{if(await reconcileUnknown(kind)){activeReconciliations.delete(key);note('上一笔交易已核对，页面状态已更新。');return;}}catch{/* Keep the duplicate-send guard until chain evidence is available. */}
  if(attempt>=29){activeReconciliations.delete(key);return;}
  setTimeout(()=>poll(attempt+1),10000);
 };
 setTimeout(()=>poll(0),0);
}
async function verifyRecord(kind,hash){
 const record=records[kind],observedAsset=assetId,observedAccount=account;ensure(record?.dataHash,'缺少原始调用记录，无法核验交易身份。');
 const side=sideFor(kind),provider=providers[side];
 const [tx,receipt]=await Promise.all([provider.getTransaction(hash),provider.getTransactionReceipt(hash)]);
 ensure(records[kind]===record&&assetId===observedAsset&&same(account,observedAccount),'钱包或资产已切换，请重新加载当前状态。');
 ensure(tx&&receipt&&receipt.status===1&&same(tx.from,record.account)&&same(tx.to,record.to)&&keccak256(tx.data)===record.dataHash,`原交易未确认成功或调用身份不匹配：${kind}`);
 if(kind.startsWith('send-')){
  const event=receipt.logs.filter(log=>same(log.address,pair[side])).map(log=>{try{return appIface.parseLog(log);}catch{return null;}}).find(x=>x?.name==='OFTSent');
  ensure(event&&same(event.args.fromAddress,record.account)&&event.args.amountSentLD===recordAmount(record)&&event.args.amountReceivedLD===recordAmount(record),'未找到匹配的 OFTSent 事件。');
  record.guid=event.args.guid;
 }
 record.hash=hash;record.unknown=false;record.blockNumber=receipt.blockNumber;save();
 return receipt;
}
async function open(side){
 ensure(same(account,owner),'解除暂停仅由指定管理钱包签署。');
 const before=await state(side);ensure(before.sendPaused&&before.receivePaused,`${side} 已非完全暂停，请刷新核对。`);
 const payload=appIface.encodeFunctionData('setPauses',[false,false]);
 await submit(`open-${side}`,side,activeAdmin()[side],adminIface.encodeFunctionData('executeBatch',[[pair[side]],[payload]]));
 const after=await state(side);ensure(!after.sendPaused&&!after.receivePaused,'解除暂停后链上状态不匹配。');
}
async function pause(side){
 ensure(same(account,owner),'暂停仅由指定 guardian 钱包签署。');
 const before=await state(side);ensure(!before.sendPaused||!before.receivePaused,`${side} 已完全暂停。`);
 await submit(`pause-${side}`,side,pair[side],appIface.encodeFunctionData('pause',[true,true]));
 const after=await state(side);ensure(after.sendPaused&&after.receivePaused,'暂停后链上状态不匹配。');
}
async function send(side){
 const invalidAmount=amountValidation();ensure(!invalidAmount,invalidAmount);
 const chosenAmount=amount,chosenAmountLD=parseEther(chosenAmount);
 archiveCompletedTransfer(side);
 const before=await refresh();
 ensure(!before[side].sendPaused&&!before[side==='bsc'?'arc':'bsc'].receivePaused,'发送链或目标链接收仍暂停。');
 const plan=await planCandidateTransfer({providers,networks,pair,side,account,amount:chosenAmount,extraOptions:options});
 if(plan.key==='approve'){
  ensure(side==='bsc'&&plan.amountLD===chosenAmountLD,'授权计划异常。');
  const decoded=tokenIface.decodeFunctionData('approve',plan.data);
  ensure(same(decoded[0],pair.bsc)&&decoded[1]===chosenAmountLD,'精确授权地址或数量不匹配。');
  await submit('approve-bsc','bsc',plan.to,plan.data);
  note('精确授权已核验，正在准备跨链交易，请继续查看钱包。');
  const after=await planCandidateTransfer({providers,networks,pair,side,account,amount:chosenAmount,extraOptions:options});
  ensure(after.key==='send'&&after.amountLD===chosenAmountLD&&after.value>0n,'授权已完成，但发送计划未就绪；请检查状态后重试。');
  await submit('send-bsc','bsc',after.to,after.data,after.value,chosenAmountLD);return;
 }
 ensure(plan.key==='send'&&plan.amountLD===chosenAmountLD&&plan.value>0n,'发送计划异常。');
 await submit(`send-${side}`,side,plan.to,plan.data,plan.value,chosenAmountLD);
}
function archiveCompletedTransfer(side){
 const key=`send-${side}`,record=records[key];
 if(!record?.deliveredHash)return;
 ensure(!record.unknown,'存在广播结果不明的交易，请先核验。');
 const archiveKey=accountKey()+':archive',archive=JSON.parse(localStorage.getItem(archiveKey)||'[]');
 archive.push({completedAt:new Date().toISOString(),asset:assetId,side,record,approval:side==='bsc'?records['approve-bsc']:undefined});
 localStorage.setItem(archiveKey,JSON.stringify(archive));
 delete records[key];if(side==='bsc')delete records['approve-bsc'];save();
}
async function archiveCompletedRound(){
 if(!records['send-bsc']?.hash||!records['send-arc']?.hash)return;
 for(const side of ['arc','bsc']){
  const origin=side==='arc'?'bsc':'arc',record=records[`send-${origin}`];
  if(!record.guid)await verifyRecord(`send-${origin}`,record.hash);
  if(!record.deliveredHash)await delivered(side);
 }
 if(records['send-bsc']?.deliveredHash&&records['send-arc']?.deliveredHash)nextRound();
}
async function delivered(side){
 const origin=side==='arc'?'bsc':'arc',record=records[`send-${origin}`];
 const observedAsset=assetId,observedAccount=account;
 const stillCurrent=()=>records[`send-${origin}`]===record&&assetId===observedAsset&&same(account,observedAccount);
 ensure(record?.hash,'缺少原发送交易哈希，无法核验到账。');
 if(record.deliveredHash)return;
 // Refresh may restore the hash before the source receipt/GUID was saved.
 // For delivery, prove the actual OFT transfer, including wallet-wrapped calls.
 // Exact call matching still governs unknown-broadcast/approval recovery.
 if(!record.guid){
  const [tx,receipt]=await Promise.all([providers[origin].getTransaction(record.hash),providers[origin].getTransactionReceipt(record.hash)]);
  ensure(stillCurrent(),'钱包或资产已切换，请重新加载当前状态。');
  ensure(tx&&receipt?.status===1&&same(tx.from,record.account)&&same(record.account,observedAccount),'原发送交易未确认成功或账户不匹配。');
  const event=receipt.logs.filter(log=>same(log.address,pair[origin])).map(log=>{try{return appIface.parseLog(log);}catch{return null;}}).find(event=>event?.name==='OFTSent'&&Number(event.args.dstEid)===networks[side].eid&&same(event.args.fromAddress,record.account)&&event.args.amountSentLD===recordAmount(record)&&event.args.amountReceivedLD===recordAmount(record));
  ensure(event,'未找到匹配的 OFTSent 事件。');
  record.guid=event.args.guid;record.blockNumber=receipt.blockNumber;record.unknown=false;save();
 }
 ensure(stillCurrent(),'钱包或资产已切换，请重新加载当前状态。');
 ensure(record.guid,'未找到匹配的 OFTSent 事件。');
 const hasTargetStart=Number.isSafeInteger(record.targetStart)&&record.targetStart>=0;
 let destinationHash;
 try {
  const response=await fetch(`https://scan.layerzero-api.com/v1/messages/guid/${record.guid}`,{signal:AbortSignal.timeout(15000)});
  if(response.ok){
   const result=await response.json();
   const message=result.data?.find(item=>same(item.guid,record.guid)&&item.pathway?.srcEid===networks[origin].eid&&item.pathway?.dstEid===networks[side].eid);
   destinationHash=message?.destination?.tx?.txHash;
  }
 } catch {/* The public event query below remains available if Scan is unavailable. */}
 const provider=providers[side],topic=appIface.getEvent('OFTReceived').topicHash;
 if(!destinationHash){
  try {
   const latest=await provider.getBlockNumber();
   // Older browser records may lack this hint. GUID + contract + recipient +
   // amount identify delivery; use a bounded recent scan when the hint is absent.
   const first=hasTargetStart?record.targetStart:Math.max(0,latest-8192);
   for(let start=first;start<=latest;start+=2000){
    const logs=await provider.getLogs({address:pair[side],topics:[topic,record.guid],fromBlock:start,toBlock:Math.min(start+1999,latest)});
    if(logs.length){destinationHash=logs[0].transactionHash;break;}
   }
  } catch {throw Error('到账索引暂不可用；请保留原发送哈希，稍后再点核验，不要重新发送。');}
 }
 if(!destinationHash){note(`${side} 尚未查到匹配 GUID 的到账事件。请稍后重新核验，不要重发。`);return;}
 ensure(/^0x[0-9a-f]{64}$/i.test(destinationHash),'目标链交易哈希格式异常。');
 const receipt=await provider.getTransactionReceipt(destinationHash);
 ensure(stillCurrent(),'钱包或资产已切换，请重新加载当前状态。');
 ensure(receipt?.status===1&&(!hasTargetStart||receipt.blockNumber>=record.targetStart),'目标链到账交易未成功或区块不匹配。');
 const found=receipt.logs.filter(log=>same(log.address,pair[side])&&same(log.topics[0],topic)&&same(log.topics[1],record.guid)).find(log=>{
  const event=appIface.parseLog(log);
  return Number(event.args.srcEid)===networks[origin].eid&&same(event.args.toAddress,record.account)&&event.args.amountReceivedLD===recordAmount(record);
 });
 ensure(found,'目标链回执未找到与原 GUID、账户和数量匹配的到账事件。');
 record.deliveredHash=destinationHash;record.deliveredBlock=receipt.blockNumber;save();
 void publishTransfer(origin,record.hash);
 note(`${side} 到账已核验：${destinationHash}`);
 if(account)void quoteStatus().catch(()=>{});
}
async function recover(){
 const kind=$('recover-kind').value,hash=$('recover-hash').value.trim();ensure(/^0x[0-9a-f]{64}$/i.test(hash),'请输入完整交易哈希。');
 await verifyRecord(kind,hash);await refresh();note(`${kind} 已按原哈希核验。`);
 if(kind.startsWith('send-')){
  const destination=kind==='send-bsc'?'arc':'bsc';
  await publishTransfer(sideFor(kind),hash);
  try{await delivered(destination);}catch(error){note(`来源交易已核验，目标链暂未核验：${errorText(error)}。请稍后点到账核验，不要重新发送。`);}
  if(!records[kind]?.deliveredHash)trackDelivery(destination,hash);
 }
}
function exportRecords(){
 const archive=account?JSON.parse(localStorage.getItem(accountKey()+':archive')||'[]'):[];
 const blob=new Blob([JSON.stringify({version:1,asset:assetId,account,records,archive},null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`tevumi-${assetId}-live-records.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function nextRound(){
 ensure(account,'请先连接钱包。');
 ensure(records['send-bsc']?.deliveredHash&&records['send-arc']?.deliveredHash,'请先核验本轮双向到账。');
 ensure(Object.values(records).every(record=>!record.unknown),'存在广播结果不明的交易，请先核验。');
 const archiveKey=accountKey()+':archive';
 const archive=JSON.parse(localStorage.getItem(archiveKey)||'[]');
 archive.push({completedAt:new Date().toISOString(),records});
 localStorage.setItem(archiveKey,JSON.stringify(archive));
 records={};save();note('上一轮记录已归档到本浏览器。请导出保存。');
}
export async function selectAsset(id){
 ensure(id in pairs,'不支持的跨链资产。');
 ensure(!busy,'当前操作尚未完成，请等待结果。');
 if(id===assetId)return;
 busy=true;for(const button of document.querySelectorAll('button:not(#nav-buy):not(#nav-bridge):not(#nav-swap)'))button.disabled=true;
 try{
 assetId=id;assetName=assetNames[id];pair=pairs[id];amount=id==='wotr'?'500':'0.000001';limits={bsc:null,arc:null};routeState=null;
 records={};
 if(account){load();await clearVerifiedLegacyArcAttempt();for(const side of ['bsc','arc']){const item=records[`send-${side}`];if(item?.hash&&!item.deliveredHash)trackDelivery(side==='bsc'?'arc':'bsc',item.hash);}for(const kind of ['approve-bsc','send-bsc','send-arc'])if(records[kind]?.unknown)trackUnknown(kind);}else renderRecords();
 $('chain-state').textContent='正在读取所选资产的链上状态…';
 $('fee-state').textContent=document.body.dataset.balanceOnly==='true'?(account?'正在读取所选资产余额…':'连接钱包后显示所选资产的余额。'):(account?'正在读取双向余额和消息费报价…':'连接钱包后显示余额和双向消息费报价。');
 note('');
 try{await refresh(Boolean(account));}catch(error){note(errorText(error));}
 }finally{busy=false;for(const button of document.querySelectorAll('button:not(#nav-buy):not(#nav-bridge):not(#nav-swap)'))button.disabled=false;}
}
// Navigation remains usable while wallet restoration and chain reads are pending.
// Transaction controls still use the existing busy and verification guards.
async function run(action){if(busy)return;busy=true;emitView();for(const button of document.querySelectorAll('button:not(#nav-buy):not(#nav-bridge):not(#nav-swap)'))button.disabled=true;try{await action();}catch(error){note(errorText(error));}finally{busy=false;for(const button of document.querySelectorAll('button:not(#nav-buy):not(#nav-bridge):not(#nav-swap)'))button.disabled=false;emitView();}}
for(const side of ['bsc','arc']){
 if($(`open-${side}`))$(`open-${side}`).onclick=()=>run(()=>open(side));
 if($(`pause-${side}`))$(`pause-${side}`).onclick=()=>run(()=>pause(side));
 $(`send-${side}`).onclick=()=>run(()=>send(side));
 $ (`check-${side}`).onclick=()=>run(()=>delivered(side));
}
$('connect').onclick=()=>run(connect);$('refresh').onclick=()=>run(()=>refresh(true));if($('recover'))$('recover').onclick=()=>run(recover);if($('export'))$('export').onclick=exportRecords;$('next-round').onclick=()=>run(nextRound);
window.addEventListener('tevumi:locale-change',()=>{if(account)void quoteStatus().catch(()=>{});});
renderRecords();refresh().catch(error=>note(errorText(error)));
void restoreWalletSession().then(choice=>{if(choice && !account) void run(()=>connect(choice));}).catch(()=>{});
