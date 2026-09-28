import {BrowserProvider,getAddress,getCreateAddress,keccak256} from 'ethers';

const $=id=>document.getElementById(id),storageKey='tevumi-public-beta-deploy-v1';
let plan,provider,account,records={},busy=false,autoRunning=false,storageBroken=false;
const sides=[['bsc','BNB Chain'],['arc','Arc']];
const readRpc={56:'https://bsc-rpc.publicnode.com',5042:'https://rpc.mainnet.arc.io'};
const maxDeploymentGas=8000000n;
async function rpc(chainId,method,params){
 const response=await fetch(readRpc[chainId],{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error(`独立 RPC 查询失败：${method}。请稍后重试。`);
 const body=await response.json();
 if(body.error||body.result==null)throw Error(`独立 RPC 无法完成 ${method}；部署尚未提交。`);
 return body.result;
}
async function transactionWithFee(item){
 const tx=item.transaction,chainId=tx.chainId;
 const [network,nonce,estimated,price,balance]=await Promise.all([
  rpc(chainId,'eth_chainId',[]),
  rpc(chainId,'eth_getTransactionCount',[tx.from,'pending']),
  rpc(chainId,'eth_estimateGas',[{from:tx.from,data:tx.data,value:'0x0',nonce:'0x'+tx.nonce.toString(16),chainId:'0x'+chainId.toString(16)}]),
  rpc(chainId,'eth_gasPrice',[]),
  rpc(chainId,'eth_getBalance',[tx.from,'latest']),
 ]);
 if(BigInt(network)!==BigInt(chainId)||BigInt(nonce)!==BigInt(tx.nonce))throw Error('独立 RPC 的网络或 pending nonce 与部署计划不一致，停止签名。');
 const gas=BigInt(estimated)*120n/100n+1n,gasPrice=BigInt(price);
 if(gas<21000n||gas>maxDeploymentGas||gasPrice<=0n)throw Error('Gas 报价未通过独立核验，停止签名。');
 const request={from:tx.from,data:tx.data,value:'0x0',nonce:'0x'+tx.nonce.toString(16),chainId:'0x'+chainId.toString(16),gas:'0x'+gas.toString(16)};
 let maximumPrice=gasPrice;
 if(chainId===56)request.gasPrice='0x'+gasPrice.toString(16);
 else{
  const [block,priority]=await Promise.all([rpc(chainId,'eth_getBlockByNumber',['latest',false]),rpc(chainId,'eth_maxPriorityFeePerGas',[])]);
  if(typeof block.baseFeePerGas!=='string')throw Error('Arc 基础费报价不可用，停止签名。');
  const tip=BigInt(priority);
  maximumPrice=BigInt(block.baseFeePerGas)*2n+tip;
  if(tip<=0n||maximumPrice<gasPrice)throw Error('Arc 费用报价异常，停止签名。');
  request.maxPriorityFeePerGas='0x'+tip.toString(16);
  request.maxFeePerGas='0x'+maximumPrice.toString(16);
 }
 if(BigInt(balance)<gas*maximumPrice)throw Error('钱包余额不足以覆盖本笔最高网络费用。');
 return request;
}
function note(value){$('message').textContent=value;}
function store(){if(storageBroken)throw Error('浏览器记录不可写，停止部署。');localStorage.setItem(storageKey,JSON.stringify(records));}
function load(){try{records=JSON.parse(localStorage.getItem(storageKey)||'{}');if(!records||typeof records!=='object'||Array.isArray(records))throw Error();}catch{storageBroken=true;records={};note('本地部署记录无法读取，请先保存旧数据并排查，当前禁止签名。');}}
function setBusy(value){busy=value;render();}
function expectItem(item){const tx=item.transaction;if(getAddress(tx.from)!==getAddress(plan.account)||getCreateAddress({from:tx.from,nonce:tx.nonce})!==getAddress(item.predictedAddress)||keccak256(tx.data)!==item.creationDataHash||tx.value!=='0')throw Error('发布计划校验失败。');}
function selected(){if(!provider||!account)throw Error('请先连接部署钱包。');if(getAddress(account)!==getAddress(plan.account))throw Error('连接账户与指定部署账户不符。');return provider;}
async function onChain(item){
 const p=selected(),chain=Number((await p.getNetwork()).chainId);
 if(chain!==item.transaction.chainId)throw Error(`请在钱包切换到 Chain ID ${item.transaction.chainId}。`);
 const tx=item.transaction,code=await p.getCode(item.predictedAddress);
 const record=records[item.id];
 if(record?.hash){
  const [receipt,sent]=await Promise.all([p.getTransactionReceipt(record.hash),p.getTransaction(record.hash)]);
  if(!receipt||!sent)return {state:'pending',label:'原哈希待确认或 RPC 尚未收录。'};
  if(sent.to!==null||getAddress(sent.from)!==getAddress(tx.from)||sent.nonce!==tx.nonce||keccak256(sent.data)!==item.creationDataHash||receipt.status!==1||getAddress(receipt.contractAddress||'0x0000000000000000000000000000000000000000')!==getAddress(item.predictedAddress)||code==='0x')return {state:'conflict',label:'原哈希与本计划不匹配或交易失败，停止操作并复核。'};
  return {state:'confirmed',label:`部署已核验：${record.hash}`};
 }
 const nonce=await p.getTransactionCount(tx.from,'pending');
 if(code!=='0x'||nonce!==tx.nonce||record?.unknown)return {state:'conflict',label:`当前 pending nonce ${nonce}，计划为 ${tx.nonce}；需恢复原哈希或重新生成计划。`};
 const side=tx.chainId===56?'bsc':'arc',preceding=plan.chains[side].deployments.filter(x=>x.transaction.nonce<tx.nonce);
 for(const previous of preceding)if((await p.getCode(previous.predictedAddress))==='0x')return {state:'pending',label:`请先等待并核验 ${previous.id} 部署成功。`};
 return {state:'ready',label:`待签名 · nonce ${tx.nonce}`};
}
async function inspect(item){setBusy(true);try{const state=await onChain(item);$('state-'+item.id).textContent=state.label;$('state-'+item.id).classList.toggle('ok',state.state==='confirmed');return state;}catch(error){$('state-'+item.id).textContent=error.message;return {state:'error'};}finally{setBusy(false);}}
function render(){
 $('wallet-state').textContent=account?`已连接：${account}`:'尚未连接钱包。';
 for(const button of document.querySelectorAll('.sign,.verify,.recover'))button.disabled=busy||autoRunning||storageBroken||!account;
 $('refresh').disabled=busy||autoRunning||!account;
 $('deploy-all').disabled=busy||autoRunning||storageBroken||!account;
}
async function connect(){
 if(!window.ethereum)throw Error('未找到浏览器钱包扩展。');
 const accounts=await window.ethereum.request({method:'eth_requestAccounts'});account=getAddress(accounts[0]);provider=new BrowserProvider(window.ethereum,undefined,{cacheTimeout:0});
 if(account!==getAddress(plan.account)){account=undefined;provider=undefined;render();throw Error('请使用指定的部署钱包连接。');}
 render();note('已连接。点击“开始 / 继续部署”，随后在钱包逐笔确认。');
}
async function switchTo(item){const target='0x'+item.transaction.chainId.toString(16);if((await window.ethereum.request({method:'eth_chainId'})).toLowerCase()!==target)await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:target}]});provider=new BrowserProvider(window.ethereum,undefined,{cacheTimeout:0});}
async function sign(item){
 selected();expectItem(item);setBusy(true);
 try{
  await switchTo(item);
  const state=await onChain(item);if(state.state!=='ready')throw Error(state.label);
  const tx=item.transaction,request=await transactionWithFee(item);
  // Persist the uncertain state before asking the wallet, so a lost response cannot allow a duplicate request.
  records[item.id]={unknown:true,chainId:tx.chainId,nonce:tx.nonce,creationDataHash:item.creationDataHash};store();
  note(`正在请求钱包签署 ${item.id}。若结果不明，先按原哈希恢复。`);
  let hash;
  try{hash=await window.ethereum.request({method:'eth_sendTransaction',params:[request]});}
  catch(error){if(error?.code===4001){delete records[item.id];store();throw Error('已在钱包拒绝；未记录广播。');}throw Error('钱包请求结果不明。请先查钱包活动记录，按原哈希恢复；不要重复签名。');}
  if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('钱包未返回有效哈希，请按未知广播处理。');
  records[item.id]={hash,chainId:tx.chainId,nonce:tx.nonce,creationDataHash:item.creationDataHash};store();
  $('state-'+item.id).textContent=`已提交 ${hash}，请等待回执后点击核验。`;
  note(`请保存交易哈希：${hash}`);
  return hash;
 }finally{setBusy(false);}
}
async function deployAll(){
 selected();autoRunning=true;render();
 try{
  for(const item of [...plan.chains.bsc.deployments,...plan.chains.arc.deployments]){
   await switchTo(item);
   let state=await onChain(item);
   if(state.state==='confirmed'){note(`${item.id} 已核验，继续下一笔。`);continue;}
   if(state.state==='ready')await sign(item);
   else if(state.state!=='pending'||!records[item.id]?.hash)throw Error(`${item.id}：${state.label}`);
   note(`正在等待 ${item.id} 的主网回执…`);
   const receipt=await provider.waitForTransaction(records[item.id].hash,1,180000);
   if(!receipt)throw Error(`${item.id} 回执等待超时。已保存原哈希，请稍后点击“继续部署”，不要重发。`);
   state=await onChain(item);
   if(state.state!=='confirmed')throw Error(`${item.id}：${state.label}`);
   $('state-'+item.id).textContent=state.label;
   $('state-'+item.id).classList.add('ok');
   note(`${item.id} 已完成链上核验。`);
  }
  note('6 笔部署均已链上核验。合约仍暂停，跨链交易尚未开放。');
 }finally{autoRunning=false;render();}
}
async function recover(item){
 selected();await switchTo(item);
 const input=$('hash-'+item.id),hash=input.value.trim();if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('请输入完整的 0x 交易哈希。');
 const [sent,receipt]=await Promise.all([provider.getTransaction(hash),provider.getTransactionReceipt(hash)]);
 if(!sent||!receipt)throw Error('链上尚未找到交易及回执，请稍后重试。');
 const tx=item.transaction;
 if(sent.to!==null||getAddress(sent.from)!==getAddress(tx.from)||sent.nonce!==tx.nonce||keccak256(sent.data)!==item.creationDataHash)throw Error('哈希对应的交易与本部署计划不匹配。');
 records[item.id]={hash,chainId:tx.chainId,nonce:tx.nonce,creationDataHash:item.creationDataHash};store();
 const state=await onChain(item);$('state-'+item.id).textContent=state.label;if(state.state!=='confirmed')throw Error(state.label);
 note('原交易已恢复并核验。');
}
function draw(){
 $('summary').innerHTML=`<dt>发布 ID</dt><dd>${plan.releaseId}</dd><dt>指定账户</dt><dd class="mono">${plan.account}</dd><dt>每笔 / 总锁仓</dt><dd>${plan.limits.perSend} / ${plan.limits.capacity} 枚（每资产）</dd><dt>初始状态</dt><dd>所有业务合约暂停；不开放发送或接收</dd>`;
 for(const [side,name] of sides){
  const heading=document.createElement('h2');heading.textContent=`${name} · Chain ID ${plan.chains[side].chainId}`;$('steps').append(heading);
  for(const item of plan.chains[side].deployments){expectItem(item);const el=document.createElement('article');el.className='step';
   const title=document.createElement('h3');title.textContent=`${item.id} · ${item.contract}`;el.append(title);
   for(const value of [`预测地址：${item.predictedAddress}`,`创建数据 Keccak-256：${item.creationDataHash}`,`nonce：${item.transaction.nonce}`]){const line=document.createElement('p');line.className='mono';line.textContent=value;el.append(line);}
   const state=document.createElement('p');state.id='state-'+item.id;state.textContent='尚未核验';el.append(state);
   const verify=document.createElement('button');verify.className='verify secondary';verify.textContent='核验';verify.onclick=()=>inspect(item);el.append(verify);
   const signButton=document.createElement('button');signButton.className='sign';signButton.textContent='在钱包签署此笔部署';signButton.onclick=()=>run(()=>sign(item));el.append(signButton);
   const input=document.createElement('input');input.id='hash-'+item.id;input.placeholder='已有交易哈希 0x…';input.setAttribute('aria-label',item.id+' 已有交易哈希');el.append(input);
   const recovery=document.createElement('button');recovery.className='recover secondary';recovery.textContent='按哈希恢复';recovery.onclick=()=>run(()=>recover(item));el.append(recovery);
   $('steps').append(el);
  }
 }
 render();
}
async function run(task){try{await task();}catch(error){note(error?.message||'操作未完成。');}}
async function start(){load();const response=await fetch('./plan.json',{cache:'no-store'});if(!response.ok)throw Error('部署计划加载失败。');plan=await response.json();if(plan.chains.bsc.deployments.length!==3||plan.chains.arc.deployments.length!==3)throw Error('部署计划不完整。');draw();}
$('connect').onclick=()=>run(connect);
$('deploy-all').onclick=()=>run(deployAll);
$('refresh').onclick=()=>run(async()=>{for(const item of [...plan.chains.bsc.deployments,...plan.chains.arc.deployments])if(item.transaction.chainId===Number((await provider.getNetwork()).chainId))await inspect(item);});
$('export').onclick=()=>{const blob=new Blob([JSON.stringify({releaseId:plan.releaseId,account:plan.account,records},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='tevumi-public-beta-deploy-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
window.ethereum?.on?.('accountsChanged',()=>{account=undefined;provider=undefined;render();note('钱包账户已变化，请重新连接并核验。');});
window.ethereum?.on?.('chainChanged',()=>{if(account)provider=new BrowserProvider(window.ethereum,undefined,{cacheTimeout:0});render();});
start().catch(error=>note(error.message));
