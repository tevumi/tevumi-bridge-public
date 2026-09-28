import {BrowserProvider,Contract,Interface,getAddress,keccak256,zeroPadValue} from 'ethers';
import plan from './limits-plan.json';
import {rpc} from './rpc.js';
import {arcFeeParams} from './arc-fees.js';
import {classifyWalletSendError} from './wallet-result.js';

const $=id=>document.getElementById(id);
const chains={bsc:{chainId:56,eid:30102,admin:'0xB2039D774574d9171E143cA30aAb48bB25b3F8e8'},arc:{chainId:5042,eid:30417,admin:'0x01dba01e9E6f40669d8D3036316967221Bc0081C'}};
const apps={binancelife:{bsc:'0x89F3A44786C97618cc4b45721D433c9a83921ec4',arc:'0x9aF52E914DCC692Af046A136AC1c59f98F7347E7'},cat:{bsc:'0x561750f93BAC5BC237De7FE092b9A40e1cC20b06',arc:'0x503200C60aaA078899B31268833c5F090693E30B'}};
const adminIface=new Interface(['function owner() view returns(address)','function executeBatch(address[] targets,bytes[] payloads)']);
const appIface=new Interface(['function owner() view returns(address)','function guardian() view returns(address)','function peers(uint32) view returns(bytes32)','function outbound() view returns(uint64 single,uint64 burst,uint64 windowCap,uint256 credit,uint256 updatedAt,bool initialized)','function inbound() view returns(uint64 single,uint64 burst,uint64 windowCap,uint256 credit,uint256 updatedAt,bool initialized)','function depositsPaused() view returns(bool)','function sendsPaused() view returns(bool)','function receivesPaused() view returns(bool)','function configureLimit(bool,uint64,uint64,uint64)']);
const providers=Object.fromEntries(Object.entries(chains).map(([side,chain])=>[side,new BrowserProvider({request:({method,params=[]})=>rpc(chain.chainId,method,params)})]));
const key='tevumi-limit-2sd-20260927',records=JSON.parse(localStorage.getItem(key)||'{}');
let account=null,busy=false,status={bsc:'loading',arc:'loading'};
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const ensure=(ok,message)=>{if(!ok)throw Error(message);};
const save=()=>localStorage.setItem(key,JSON.stringify(records));
const note=message=>{$('message').textContent=message;};
const label=side=>side==='bsc'?'BNB Chain':'Arc';
function validate(item){
 ensure(item.chainId===chains[item.side]?.chainId&&same(item.admin,chains[item.side].admin)&&same(item.transaction.to,item.admin)&&same(item.transaction.from,plan.account)&&item.transaction.value==='0'&&keccak256(item.transaction.data)===item.calldataHash,'配置计划身份不匹配。');
 const [targets,payloads]=adminIface.decodeFunctionData('executeBatch',item.transaction.data);
 ensure(targets.length===4&&payloads.length===4,'配置批次不完整。');
 for(let i=0;i<4;i++){
  const asset=i<2?'binancelife':'cat',incoming=i%2===1,args=appIface.decodeFunctionData('configureLimit',payloads[i]);
  ensure(same(targets[i],apps[asset][item.side])&&args[0]===incoming&&args[1]===2n&&args[2]===10n&&args[3]===100n,'配置项不是预期的单笔上限变更。');
 }
}
ensure(plan.releaseId==='tevumi-limit-2sd-20260927'&&same(plan.account,'0x489594537CB76aC256079D710B6E18498E1a5402')&&plan.batches.length===2,'配置计划不匹配。');
for(const item of plan.batches)validate(item);
function render(){
 $('wallet-state').textContent=account?`已连接 ${account}`:'未连接管理钱包';
 for(const side of ['bsc','arc'])$('state-'+side).textContent=`${label(side)}：${({loading:'正在读取…',ready:'待签署',done:'限额 0.000002 已生效',pending:'原交易待确认，禁止重复提交',unknown:'钱包结果不明，按原哈希核验',changed:'链上配置不符合预期，已停止'})[status[side]]}`;
 $('configure').disabled=busy||!account||!same(account,plan.account)||Object.values(status).some(value=>!['ready','done'].includes(value))||Object.values(status).every(value=>value==='done');
 $('refresh').disabled=busy;
 $('recovery').hidden=!Object.values(status).some(value=>value==='unknown'||value==='pending');
}
async function readSide(item){
 const side=item.side,other=side==='bsc'?'arc':'bsc',p=providers[side],chain=chains[side];
 ensure(Number((await p.getNetwork()).chainId)===chain.chainId,'只读 RPC 网络不符。');
 ensure(await p.getCode(item.admin)!=='0x','管理合约代码缺失。');
 const admin=new Contract(item.admin,adminIface,p);
 ensure(same(await admin.owner(),plan.account),'管理合约所属钱包已变化。');
 const singles=[];
 for(const asset of ['binancelife','cat']){
  const address=apps[asset][side];ensure(await p.getCode(address)!=='0x','业务合约代码缺失。');
  const app=new Contract(address,appIface,p);
  const [owner,guardian,peer,outbound,inbound,sendPaused,receivePaused]=await Promise.all([app.owner(),app.guardian(),app.peers(chains[other].eid),app.outbound(),app.inbound(),side==='bsc'?app.depositsPaused():app.sendsPaused(),app.receivesPaused()]);
  ensure(same(owner,item.admin)&&same(guardian,plan.account)&&same(peer,zeroPadValue(apps[asset][other],32))&&!sendPaused&&!receivePaused,'合约身份、通道或暂停状态已变化。');
  for(const policy of [outbound,inbound]){ensure(policy.initialized&&policy.burst===10n&&policy.windowCap===100n,'累计额度已变化，停止配置。');singles.push(policy.single);}
 }
 const record=records[side];
 if(record?.hash){
  const [tx,receipt]=await Promise.all([p.getTransaction(record.hash),p.getTransactionReceipt(record.hash)]);
  if(!tx||!receipt)return 'pending';
  ensure(receipt.status===1&&same(tx.from,plan.account)&&same(tx.to,item.admin)&&keccak256(tx.data)===item.calldataHash,'原交易失败或身份不符。');
  ensure(singles.every(value=>value===2n),'原交易已确认但配置尚未全部生效。');
  return 'done';
 }
 if(record?.unknown)return 'unknown';
 if(singles.every(value=>value===2n))return 'done';
 if(singles.every(value=>value===1n))return 'ready';
 return 'changed';
}
async function refresh(){
 for(const item of plan.batches){try{status[item.side]=await readSide(item);}catch(error){status[item.side]='changed';note(String(error?.shortMessage??error?.message??'链上状态不可用').slice(0,180));}render();}
}
async function switchTo(item){
 const id='0x'+item.chainId.toString(16);
 if(!same(await window.ethereum.request({method:'eth_chainId'}),id))await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:id}]});
 ensure(same(await window.ethereum.request({method:'eth_chainId'}),id),'钱包网络切换失败。');
 const accounts=await window.ethereum.request({method:'eth_accounts'});
 ensure(accounts?.length&&same(accounts[0],plan.account),'管理钱包账户已变化。');
}
async function transaction(item){
 const chainId=item.chainId,tx=item.transaction;
 const [network,gasRaw,priceRaw,nativeRaw]=await Promise.all([
  rpc(chainId,'eth_chainId',[]),rpc(chainId,'eth_estimateGas',[{from:plan.account,to:tx.to,data:tx.data,value:'0x0'}]),rpc(chainId,'eth_gasPrice',[]),rpc(chainId,'eth_getBalance',[plan.account,'latest']),
 ]);
 ensure(BigInt(network)===BigInt(chainId),'只读 RPC 网络不符。');
 const gas=BigInt(gasRaw)*120n/100n+1n,price=BigInt(priceRaw);
 ensure(gas>=21000n&&gas<3000000n&&price>0n,'Gas 报价异常。');
 const request={from:plan.account,to:tx.to,data:tx.data,value:'0x0',gas:'0x'+gas.toString(16),chainId:'0x'+chainId.toString(16)};
 let maxPrice=price;
 if(item.side==='bsc')request.gasPrice='0x'+price.toString(16);
 else{
  const [block,priority]=await Promise.all([rpc(chainId,'eth_getBlockByNumber',['latest',false]),rpc(chainId,'eth_maxPriorityFeePerGas',[])]);
  ensure(typeof block?.baseFeePerGas==='string','Arc 基础费报价不可用。');
  const fees=arcFeeParams(price,block.baseFeePerGas,priority);
  request.maxPriorityFeePerGas=fees.maxPriorityFeePerGas;request.maxFeePerGas=fees.maxFeePerGas;maxPrice=fees.maximumPrice;
 }
 ensure(BigInt(nativeRaw)>gas*maxPrice,'管理钱包余额不足以覆盖最高网络费用。');
 return request;
}
async function configure(){
 ensure(account&&same(account,plan.account),'请连接指定管理钱包。');
 for(const item of plan.batches){
  status[item.side]=await readSide(item);render();
  if(status[item.side]==='done')continue;
  ensure(status[item.side]==='ready',`${label(item.side)} 状态不明确，停止提交。`);
  await switchTo(item);
  const request=await transaction(item);
  ensure((await readSide(item))==='ready','签名前链上限额已变化。');
  await switchTo(item);
  records[item.side]={unknown:true};save();status[item.side]='unknown';render();
  note(`请在钱包确认 ${label(item.side)} 的单笔限额配置。`);
  let hash;
  try{hash=await window.ethereum.request({method:'eth_sendTransaction',params:[request]});}
  catch(error){
   const outcome=classifyWalletSendError(error);
   if(outcome==='rejected'||outcome==='not_submitted'){delete records[item.side];save();status[item.side]='ready';render();throw Error('钱包未提交配置交易。');}
   throw Error('钱包广播结果不明；请按原哈希核验，不要重复提交。');
  }
  ensure(/^0x[0-9a-f]{64}$/i.test(hash),'钱包未返回有效交易哈希；不要重复提交。');
  records[item.side]={hash};save();status[item.side]='pending';render();
  note(`${label(item.side)} 已提交 ${hash}，正在等待回执。`);
  const receipt=await providers[item.side].waitForTransaction(hash,1,180000);
  ensure(receipt,'回执暂未查到；原哈希已保存，不要重复提交。');
  status[item.side]=await readSide(item);render();
  ensure(status[item.side]==='done',`${label(item.side)} 配置回执未通过核验。`);
 }
 note('两条链、两种资产的单笔上限均已核验为 0.000002 枚。');
}
async function recover(){
 const side=$('recovery-side').value,item=plan.batches.find(batch=>batch.side===side),hash=$('recovery-hash').value.trim();
 ensure(/^0x[0-9a-f]{64}$/i.test(hash),'请输入完整原交易哈希。');
 const p=providers[side],[tx,receipt]=await Promise.all([p.getTransaction(hash),p.getTransactionReceipt(hash)]);
 ensure(tx&&receipt?.status===1&&same(tx.from,plan.account)&&same(tx.to,item.admin)&&keccak256(tx.data)===item.calldataHash,'原交易未确认成功或调用不匹配。');
 records[side]={hash};save();status[side]=await readSide(item);render();
 ensure(status[side]==='done','原交易已确认，但配置尚未全部生效。');
 note(`${label(side)} 已按原哈希核验。`);
}
async function run(fn){if(busy)return;busy=true;render();try{await fn();}catch(error){note(String(error?.shortMessage??error?.message??'操作失败').slice(0,220));}finally{busy=false;render();}}
$('connect').onclick=()=>run(async()=>{ensure(window.ethereum,'未找到浏览器钱包。');const accounts=await window.ethereum.request({method:'eth_requestAccounts'});ensure(accounts?.length&&same(accounts[0],plan.account),'请使用指定管理钱包。');account=getAddress(accounts[0]);await refresh();});
$('configure').onclick=()=>run(configure);
$('refresh').onclick=()=>run(refresh);
$('recover').onclick=()=>run(recover);
render();void refresh();
