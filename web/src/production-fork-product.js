// LOCAL FORK ONLY. The production build does not import this entry point.
import './product.css';
import {Contract,Interface,JsonRpcProvider,toQuantity} from 'ethers';
import {planCandidateTransfer} from './production-transfer.js';

const $=id=>document.getElementById(id);
const sentEvent='event OFTSent(bytes32 indexed guid,uint32 dstEid,address indexed fromAddress,uint256 amountSentLD,uint256 amountReceivedLD)';
const receivedEvent='event OFTReceived(bytes32 indexed guid,uint32 srcEid,address indexed toAddress,uint256 amountReceivedLD)';
const events=new Interface([sentEvent,receivedEvent]);
const state=await(await fetch('/__fork/state',{cache:'no-store'})).json();
const providers=Object.fromEntries(Object.entries(state.networks).map(([side,network])=>[side,new JsonRpcProvider(network.rpc,network.chainId,{batchMaxCount:1})]));
let account=null,side='bsc',plan=null,busy=false,record=null;
const storageKey=()=>`tevumi:fork-record:${state.runId}:${account.toLowerCase()}`;
function saveRecord(){if(record)sessionStorage.setItem(storageKey(),JSON.stringify({...record,amount:record.amount.toString()}));}
async function restoreRecord(){
 record=null;
 const saved=sessionStorage.getItem(storageKey());if(!saved){renderRecord();return;}
 try{
  const previous=JSON.parse(saved),mapping=state.assets[previous.asset];
  if(!mapping||!['bsc','arc'].includes(previous.side)||previous.account.toLowerCase()!==account.toLowerCase()||!/^0x[0-9a-f]{64}$/i.test(previous.hash))throw Error('invalid record');
  const source=mapping[previous.side],destination=mapping[previous.side==='bsc'?'arc':'bsc'];
  const receipt=await providers[previous.side].getTransactionReceipt(previous.hash);
  if(!receipt||receipt.status!==1)throw Error('source receipt missing');
  const event=receipt.logs.filter(log=>log.address.toLowerCase()===source.toLowerCase()).map(log=>{try{return events.parseLog(log);}catch{return null;}}).find(item=>item?.name==='OFTSent');
  if(!event||event.args.guid!==previous.guid||event.args.fromAddress.toLowerCase()!==account.toLowerCase()||event.args.amountSentLD!==BigInt(previous.amount))throw Error('source event mismatch');
  record={asset:previous.asset,side:previous.side,hash:previous.hash,guid:previous.guid,amount:BigInt(previous.amount),account,destination,received:false};
  $('asset-select').value=previous.asset;await renderBalances();renderRecord();message('已按源链回执恢复本地记录；可刷新目标链到账状态。');
 }catch{sessionStorage.removeItem(storageKey());renderRecord();message('本地记录与当前分叉不匹配，已停止恢复。');}
}

document.title='Tevumi · 正式候选双分叉产品测试';
document.querySelector('.advanced').remove();$('review').remove();$('about').remove();
document.querySelector('a[data-view="about"]').remove();
document.querySelector('.lead').textContent='正式候选 · 隔离主网分叉测试（无主网写入）';
document.querySelector('.pilot-pill').textContent='本地分叉';
document.querySelector('.scope-details').remove();
$('asset-select').querySelector('[value="tvpilot"]').remove();$('asset-select').value='binancelife';
$('bridge-amount').value='0.000001';document.querySelector('.amount-label span').textContent='分叉测试：0.000001';
$('amount-help').textContent='两种真实原币在本地分叉上测试；仅使用隔离测试账户。';
$('asset-status').textContent='正式候选合约尚未部署主网。';
$('quote-note').textContent='本地 MockEndpoint 消息费为 0；不代表真实主网费用。';
document.querySelector('.signature-note').textContent='授权与发送各需一次独立钱包确认';
$('prepare-approve').remove();document.querySelector('.product-actions').hidden=false;
$('prepare-send').textContent='授权并跨链 ↗';
$('card-connect').remove();$('connect').disabled=false;$('connect').textContent='连接隔离钱包';
$('flow-review').querySelector('p.hint').textContent='隔离主网分叉交易，不会广播到真实主网。';
$('flow-review').querySelector('details').remove();
$('flow-ack').parentElement.lastChild.textContent='我已核对本地链、合约、数量和费用。';
$('export-operations').remove();document.querySelector('.recovery-help').remove();
for(const p of $('history').querySelectorAll('p.hint'))p.textContent='此页面只用于本次内存分叉验收；关闭后不能作为主网交易记录。';

function selected(){return {asset:$('asset-select').value,side,amount:$('bridge-amount').value,account};}
function networks(){return state.networks;}
function pair(){return state.assets[selected().asset];}
function message(value){$('message').textContent=value;}
function close(){plan=null;$('flow-ack').checked=false;if($('flow-review').open)$('flow-review').close();controls();}
function controls(){
 $('prepare-send').disabled=busy||!account;$('flow-sign').disabled=busy||!plan||!$('flow-ack').checked;
 for(const id of ['choose-bsc','choose-arc','asset-select','bridge-amount','refresh-operations'])$(id).disabled=busy;
}
function show(next){
 plan=next;$('flow-ack').checked=false;$('flow-title').textContent=next.key==='approve'?'确认精确授权':'确认跨链发送';
 $('flow-details').textContent=`${selected().asset==='cat'?'CAT':'币安人生'} · ${selected().amount}\n${side==='bsc'?'BSC → Arc':'Arc → BSC'}\n接收账户：${account}\n调用合约：${next.to}\n消息费：${next.value} 本地原生币`;
 $('flow-review').showModal();controls();
}
async function assertWallet(){
 if(!account)throw Error('请先连接隔离钱包。');
 const [accounts,chain]=await Promise.all([window.ethereum.request({method:'eth_accounts'}),window.ethereum.request({method:'eth_chainId'})]);
 if(accounts?.[0]?.toLowerCase()!==account.toLowerCase()||Number(BigInt(chain))!==networks()[side].chainId)throw Error('钱包账户或网络已变化，请重新连接并预览。');
}
async function prepare(){
 await assertWallet();
 return planCandidateTransfer({providers,networks:networks(),pair:pair(),side,account,amount:selected().amount,extraOptions:'0x'});
}
async function renderBalances(){
 if(!account)return;
 const a=pair(),bsc=new Contract(a.sourceToken,['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)'],providers.bsc),arc=new Contract(a.arc,['function balanceOf(address) view returns(uint256)'],providers.arc);
 const [b,ar,allowance]=await Promise.all([bsc.balanceOf(account),arc.balanceOf(account),bsc.allowance(account,a.bsc)]);
 $('token-balance').textContent=(side==='bsc'?b:ar).toString();$('native-balance').textContent='本地分叉';
 $('balance-note').textContent=`BSC 原币 ${b} · Arc 对应币 ${ar} · 授权 ${allowance}（最小单位）`;
 $('source-label').textContent=side==='bsc'?'BNB Chain 分叉':'Arc 分叉';$('destination-label').textContent=side==='bsc'?'Arc 分叉':'BNB Chain 分叉';
 $('amount-symbol').textContent=selected().asset==='cat'?'CAT':'币安人生';
}
async function work(fn){if(busy)return;busy=true;controls();try{await fn();}catch(error){close();message(error?.message??'本地分叉操作失败。');}finally{busy=false;controls();}}
$('connect').onclick=()=>work(async()=>{
 const accounts=await window.ethereum.request({method:'eth_requestAccounts'});account=accounts[0];
 const chain=Number(BigInt(await window.ethereum.request({method:'eth_chainId'})));
 side=Object.keys(networks()).find(k=>networks()[k].chainId===chain)??'bsc';
 $('connect').textContent=`${account.slice(0,6)}…${account.slice(-4)}`;
 await renderBalances();message('隔离钱包已连接；请选择资产和网络。');await restoreRecord();
});
for(const option of ['bsc','arc'])$('choose-'+option).onclick=()=>work(async()=>{
 close();await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:toQuantity(networks()[option].chainId)}]});side=option;
 await renderBalances();message('已切换本地分叉网络。');
});
for(const id of ['asset-select','bridge-amount'])$(id).addEventListener('input',()=>{close();work(async()=>{await renderBalances();});});
$('prepare-send').onclick=()=>work(async()=>{const next=await prepare();show(next);message('预览就绪，尚未发送交易。');});
$('flow-ack').onchange=controls;$('flow-close').onclick=close;
$('flow-sign').onclick=()=>work(async()=>{
 const old=plan;if(!old)throw Error('预览已失效。');
 const fresh=await prepare();
 if(fresh.key!==old.key||fresh.to!==old.to||fresh.data!==old.data||fresh.value!==old.value)throw Error('链上状态或费用已变化，请重新预览。');
 const hash=await window.ethereum.request({method:'eth_sendTransaction',params:[{from:account,to:fresh.to,data:fresh.data,value:toQuantity(fresh.value)}]});
 const receipt=await providers[side].waitForTransaction(hash,1,30000);
 if(!receipt||receipt.status!==1)throw Error('源链交易尚未成功，先核验原哈希。');
 await assertWallet();
 if(old.key==='approve'){
  const next=await prepare();if(next.key!=='send')throw Error('授权额度未通过复核，请检查原交易。');
  close();show(next);message('授权已确认。请再次核对跨链发送。');
 }else{
  const event=receipt.logs.filter(log=>log.address.toLowerCase()===old.to.toLowerCase()).map(log=>{try{return events.parseLog(log);}catch{return null;}}).find(event=>event?.name==='OFTSent');
  if(!event||event.args.amountSentLD!==old.amountLD)throw Error('发送回执缺少匹配事件，先核验原交易。');
  record={asset:selected().asset,side,hash,guid:event.args.guid,amount:old.amountLD,account,destination:pair()[side==='bsc'?'arc':'bsc'],received:false};
  saveRecord();close();renderRecord();await renderBalances();message('源链已确认；等待本地测试程序投递原消息。');
 }
});
function renderRecord(){
 $('operations').replaceChildren();if(!record)return;
 const row=document.createElement('p');row.textContent=`${record.asset==='cat'?'CAT':'币安人生'} · ${record.side==='bsc'?'BSC → Arc':'Arc → BSC'} · ${record.received?'目标链到账事件已核验':'源链已确认，等待目标到账'} · ${record.hash}`;$('operations').append(row);
}
$('refresh-operations').onclick=()=>work(async()=>{
 if(!record)return;
 const other=record.side==='bsc'?'arc':'bsc';
 const contract=new Contract(record.destination,[receivedEvent],providers[other]);
 const logs=await contract.queryFilter(contract.filters.OFTReceived(record.guid),0,'latest');
 if(logs.some(log=>log.args.amountReceivedLD===record.amount&&log.args.toAddress.toLowerCase()===record.account.toLowerCase())){record.received=true;saveRecord();renderRecord();message('目标链到账事件已核验。');await renderBalances();}
});
$('refresh-balances').onclick=()=>work(renderBalances);
window.addEventListener('hashchange',()=>{$('history').hidden=location.hash!=='#history';document.querySelector('.product-grid').hidden=location.hash==='#history';});
controls();
