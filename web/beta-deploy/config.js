import {AbiCoder,BrowserProvider,Contract,Interface,getAddress,keccak256} from 'ethers';

const $=id=>document.getElementById(id),storageKey='tevumi-public-beta-config-v1';
const readRpc={56:'https://bsc-rpc.publicnode.com',5042:'https://rpc.mainnet.arc.io'};
const abi=['function scheduleBatch(address[] targets,uint256[] values,bytes[] payloads,bytes32 predecessor,bytes32 salt,uint256 delay)','function getTimestamp(bytes32) view returns(uint256)'];
const iface=new Interface(abi);
let plan,provider,account,records={},busy=false;
function note(value){$('message').textContent=value;}
function save(){localStorage.setItem(storageKey,JSON.stringify(records));}
function render(){
 $('wallet-state').textContent=account?`已连接：${account}`:'尚未连接钱包。';
 $('schedule-all').disabled=busy||!account;
 $('refresh').disabled=busy||!account;
 for(const button of document.querySelectorAll('.recover'))button.disabled=busy||!account;
}
async function rpc(chainId,method,params){
 const response=await fetch(readRpc[chainId],{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error(`独立 RPC 查询失败：${method}`);
 const body=await response.json();if(body.error||body.result==null)throw Error(`独立 RPC 无法完成 ${method}`);
 return body.result;
}
function validate(item){
 const tx=item.transaction;
 if(getAddress(tx.to)!==getAddress(item.timelock)||getAddress(item.account)!==getAddress(plan.account)||tx.value!=='0'||keccak256(tx.data)!==item.calldataHash||!readRpc[item.chainId])throw Error('配置计划校验失败。');
 const decoded=iface.decodeFunctionData('scheduleBatch',tx.data);
 const id=keccak256(AbiCoder.defaultAbiCoder().encode(['address[]','uint256[]','bytes[]','bytes32','bytes32'],decoded.slice(0,5)));
 if(id!==item.operationId||decoded[0].length!==item.stepCount||decoded[5]!==BigInt(plan.minDelaySeconds))throw Error('Timelock 配置内容校验失败。');
}
function selected(){if(!provider||!account||getAddress(account)!==getAddress(plan.account))throw Error('请连接指定部署钱包。');return provider;}
async function switchTo(item){
 const target='0x'+item.chainId.toString(16);
 if((await window.ethereum.request({method:'eth_chainId'})).toLowerCase()!==target)await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:target}]});
 provider=new BrowserProvider(window.ethereum,undefined,{cacheTimeout:0});
}
async function onChain(item){
 const p=selected();if(Number((await p.getNetwork()).chainId)!==item.chainId)throw Error('钱包网络与本笔配置不符。');
 if((await p.getCode(item.timelock))==='0x')throw Error('Timelock 合约不存在。');
 const timelock=new Contract(item.timelock,abi,p),timestamp=await timelock.getTimestamp(item.operationId);
 if(timestamp>0n)return {state:'scheduled',label:`已安排；链上执行时间：${new Date(Number(timestamp)*1000).toLocaleString('zh-CN')}`};
 if(records[item.side]?.unknown)return {state:'unknown',label:'原请求结果不明。先按原哈希恢复，不要重复提交。'};
 return {state:'ready',label:'尚未安排 · 等待钱包签名'};
}
async function quote(item){
 const tx=item.transaction,chainId=item.chainId;
 const [network,nonce,estimated,price,balance]=await Promise.all([
  rpc(chainId,'eth_chainId',[]),rpc(chainId,'eth_getTransactionCount',[item.account,'pending']),
  rpc(chainId,'eth_estimateGas',[{from:item.account,to:tx.to,data:tx.data,value:'0x0'}]),
  rpc(chainId,'eth_gasPrice',[]),rpc(chainId,'eth_getBalance',[item.account,'latest']),
 ]);
 const walletNonce=await selected().getTransactionCount(item.account,'pending');
 if(BigInt(network)!==BigInt(chainId)||BigInt(nonce)!==BigInt(walletNonce))throw Error('网络或 pending nonce 在两个 RPC 间不一致，停止签名。');
 const gas=BigInt(estimated)*120n/100n+1n,gasPrice=BigInt(price);
 if(gas<21000n||gas>1000000n||gasPrice<=0n)throw Error('配置 Gas 报价异常，停止签名。');
 let maximumPrice=gasPrice;
 const request={from:item.account,to:tx.to,data:tx.data,value:'0x0',nonce:'0x'+BigInt(nonce).toString(16),chainId:'0x'+chainId.toString(16),gas:'0x'+gas.toString(16)};
 if(chainId===56)request.gasPrice='0x'+gasPrice.toString(16);
 else{
  const [block,priority]=await Promise.all([rpc(chainId,'eth_getBlockByNumber',['latest',false]),rpc(chainId,'eth_maxPriorityFeePerGas',[])]);
  if(typeof block.baseFeePerGas!=='string')throw Error('Arc 基础费报价不可用。');
  const tip=BigInt(priority);maximumPrice=BigInt(block.baseFeePerGas)*2n+tip;
  if(tip<=0n||maximumPrice<gasPrice)throw Error('Arc 费用报价异常。');
  request.maxPriorityFeePerGas='0x'+tip.toString(16);request.maxFeePerGas='0x'+maximumPrice.toString(16);
 }
 if(BigInt(balance)<gas*maximumPrice)throw Error('余额不足以覆盖本笔最高网络费用。');
 return request;
}
async function schedule(item){
 validate(item);await switchTo(item);
 const status=await onChain(item);if(status.state!=='ready')return status;
 const request=await quote(item);
 const active=await window.ethereum.request({method:'eth_accounts'});
 if(!active?.length||getAddress(active[0])!==getAddress(plan.account))throw Error('签名前钱包账户已变化，停止操作。');
 records[item.side]={unknown:true};save();
 note(`正在请求钱包安排 ${item.side.toUpperCase()} 配置…`);
 let hash;
 try{hash=await window.ethereum.request({method:'eth_sendTransaction',params:[request]});}
 catch(error){if(error?.code===4001){delete records[item.side];save();throw Error('已在钱包拒绝；未提交配置。');}throw Error('钱包请求结果不明。请按原哈希恢复，不要重复提交。');}
 if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('钱包未返回有效哈希。请按未知广播处理。');
 records[item.side]={hash};save();
 note(`正在等待 ${item.side.toUpperCase()} 配置安排回执…`);
 const receipt=await provider.waitForTransaction(hash,1,180000);
 if(!receipt)throw Error('回执等待超时。原哈希已保存，请稍后继续核验。');
 const sent=await provider.getTransaction(hash);
 if(receipt.status!==1||getAddress(sent.from)!==getAddress(item.account)||getAddress(sent.to)!==getAddress(item.timelock)||keccak256(sent.data)!==item.calldataHash)throw Error('原交易与配置计划不匹配，停止后续操作。');
 const final=await onChain(item);if(final.state!=='scheduled')throw Error('回执成功但链上未显示安排，停止后续操作。');
 $('state-'+item.side).textContent=`${final.label} · 交易 ${hash}`;
 note(`${item.side.toUpperCase()} 已安排并核验。`);
 return final;
}
async function begin(){selected();busy=true;render();try{
 for(const item of plan.schedules){await switchTo(item);const state=await onChain(item);if(state.state==='scheduled'){$('state-'+item.side).textContent=state.label;continue;}if(state.state!=='ready')throw Error(`${item.side}：${state.label}`);await schedule(item);}
 note('两条链的配置已安排并核验。至少等待 24 小时；业务合约仍暂停。');
}finally{busy=false;render();}}
async function recover(item){
 selected();await switchTo(item);const hash=$('hash-'+item.side).value.trim();if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('请输入完整交易哈希。');
 const [sent,receipt]=await Promise.all([provider.getTransaction(hash),provider.getTransactionReceipt(hash)]);
 if(!sent||!receipt)throw Error('原交易尚未查到回执。');
 if(receipt.status!==1||getAddress(sent.from)!==getAddress(item.account)||getAddress(sent.to)!==getAddress(item.timelock)||keccak256(sent.data)!==item.calldataHash)throw Error('原交易与配置计划不匹配。');
 records[item.side]={hash};save();const state=await onChain(item);if(state.state!=='scheduled')throw Error('链上尚未显示安排。');$('state-'+item.side).textContent=state.label;note(`${item.side.toUpperCase()} 已按原哈希恢复。`);
}
async function connect(){
 if(!window.ethereum)throw Error('未找到浏览器钱包扩展。');
 const accounts=await window.ethereum.request({method:'eth_requestAccounts'});account=getAddress(accounts[0]);
 if(account!==getAddress(plan.account)){account=undefined;render();throw Error('请使用指定的部署钱包。');}
 provider=new BrowserProvider(window.ethereum,undefined,{cacheTimeout:0});render();note('已连接。点击“开始 / 继续安排配置”。');
}
function draw(){
 $('summary').innerHTML=`<dt>发布 ID</dt><dd>${plan.releaseId}</dd><dt>指定账户</dt><dd class="mono">${plan.account}</dd><dt>配置规模</dt><dd>每链 12 项，2 笔安排交易</dd><dt>最短延时</dt><dd>24 小时；安排后仍需另行执行</dd>`;
 for(const item of plan.schedules){validate(item);const section=document.createElement('article');section.className='step';
  const title=document.createElement('h3');title.textContent=`${item.side==='bsc'?'BNB Chain':'Arc'} · Chain ID ${item.chainId}`;section.append(title);
  for(const value of [`Timelock：${item.timelock}`,`操作 ID：${item.operationId}`,`配置项：${item.stepCount}`]){const p=document.createElement('p');p.textContent=value;section.append(p);}
  const status=document.createElement('p');status.id='state-'+item.side;status.textContent='尚未核验';section.append(status);
  const input=document.createElement('input');input.id='hash-'+item.side;input.placeholder='已有交易哈希 0x…';input.setAttribute('aria-label',item.side+' 原交易哈希');section.append(input);
  const button=document.createElement('button');button.className='recover secondary';button.textContent='按原哈希恢复';button.onclick=()=>run(()=>recover(item));section.append(button);$('steps').append(section);
 }
 render();
}
async function run(action){try{await action();}catch(error){note(error?.message||'操作未完成。');}}
async function start(){
 try{records=JSON.parse(localStorage.getItem(storageKey)||'{}');if(!records||typeof records!=='object'||Array.isArray(records))throw Error();}catch{throw Error('浏览器交易记录不可读，停止签名。');}
 const response=await fetch('./config-plan.json',{cache:'no-store'});if(!response.ok)throw Error('配置计划加载失败。');
 plan=await response.json();if(plan.state!=='DEPLOYED_PAUSED_UNSIGNED_SCHEDULE'||plan.schedules.length!==2)throw Error('配置计划不完整。');draw();
}
$('connect').onclick=()=>run(connect);
$('schedule-all').onclick=()=>run(begin);
$('refresh').onclick=()=>run(async()=>{busy=true;render();try{for(const item of plan.schedules){await switchTo(item);$('state-'+item.side).textContent=(await onChain(item)).label;}note('双链状态已重新核验。');}finally{busy=false;render();}});
start().catch(error=>note(error.message));
