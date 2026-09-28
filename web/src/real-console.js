import {formatEther,JsonRpcProvider,FetchRequest} from 'ethers';
import {walletSession as session} from './main.js';
import {chains,assertContext,transactionRecord} from './pilot.js';
import {realAssets,realKinds,tester,realDeployment,checkRealEnvironment,verifyRealDeployment,checkSourceMetadata} from './real-deployment.js';

const $=id=>document.getElementById(id),key='tevumi-real-deployments-v1';
const host=document.createElement('section');host.className='panel real-admin';
host.innerHTML=`<h2>真实资产 · 受限部署</h2><p class="hint">每个币分别部署 BSC 锁仓与 Arc 对应币。仅指定测试钱包；单笔 0.000001，累计 0.000010 枚，部署后不可修改。管理员仍可修改跨链配置，尚未完成安全审计。</p>
<label>资产<select id="real-asset"><option value="binancelife">币安人生</option><option value="cat">CAT</option></select></label>
<label>部署目标<select id="real-kind"><option value="RestrictedAssetAdapter">BSC · 锁仓合约</option><option value="RestrictedAssetOFTV2">Arc · 保留原币名称（新版）</option><option value="RestrictedAssetOFT">Arc · 旧版记录恢复</option></select></label>
<p class="hint" id="real-identity"></p><div class="flow-actions"><button id="real-prepare" class="button secondary">检查部署费用</button><button id="real-refresh" class="button secondary">核验当前网络记录</button><button id="real-export" class="text-button">导出真实资产部署记录 ↓</button></div>
<p id="real-message" class="message" role="status">新版 Arc 保留原币名称和符号。旧测试合约记录保留；新合约部署后仍需源码验证和切换通道。</p><div id="real-records"></div>
<details><summary>恢复已有部署交易</summary><p class="hint">换浏览器或记录丢失时，先选择正确资产与部署目标，再填写部署交易哈希核验，避免重复部署。</p><input id="real-hash" aria-label="已有部署交易哈希" placeholder="0x…"><button id="real-recover" class="button secondary">从链上恢复</button></details>`;
document.querySelector('.advanced>summary').after(host);
const dialog=document.createElement('dialog');dialog.id='real-review';
dialog.innerHTML=`<div class="modal-top"><span class="eyebrow">REAL ASSET DEPLOYMENT</span><button id="real-close" class="text-button" aria-label="关闭真实资产部署预览">✕</button></div><h2>确认真实资产合约部署</h2><p class="hint">费用按当前 Gas 报价估算；若钱包修改 Gas，实际费用可能超过本页估算。</p><dl id="real-details" class="review-details"></dl><details><summary>完整部署数据</summary><pre id="real-data"></pre></details><label class="ack"><input type="checkbox" id="real-ack">我已核对资产、网络、地址及费用，确认消耗主网手续费。</label><button id="real-sign" class="button dark" disabled>在钱包中确认部署 ↗</button>`;
document.body.append(dialog);
let records=[],plan,revision=0,storageError=false;
const verified=new Set();
try {const stored=JSON.parse(localStorage.getItem(key)||'[]');if(!Array.isArray(stored))throw Error();records=stored;}catch{storageError=true;}
const selected=()=>({assetId:$('real-asset').value,kind:$('real-kind').value});
const own=()=>records.filter(r=>r?.account===session.state().account);
const existing=(p)=>own().find(r=>r.assetId===p.assetId&&r.kind===p.kind&&r.status!=='failed');
function message(text,error=false){$('real-message').textContent=text;$('real-message').classList.toggle('error',error);}
function save(){if(storageError)throw Error('真实资产记录无法读取，请先保留浏览器数据及导出文件，暂不部署。');localStorage.setItem(key,JSON.stringify(records));}
function reset(){revision++;plan=undefined;$('real-ack').checked=false;$('real-sign').disabled=true;if(dialog.open)dialog.close();}
function render(){
 const {account,busy}=session.state(),chosen=selected();
 $('real-identity').textContent=`原币：${realAssets.find(a=>a.id===chosen.assetId).sourceToken} · 测试钱包：${tester}`;
 for(const id of ['real-asset','real-kind','real-hash'])$(id).disabled=busy;
 for(const id of ['real-prepare','real-refresh','real-recover'])$(id).disabled=busy||account!==tester||storageError;
 $('real-prepare').disabled||=!!existing(chosen)||chosen.kind==='RestrictedAssetOFT';
 $('real-export').disabled=!own().length;
 $('real-sign').disabled=busy||!plan||!$('real-ack').checked;
 $('real-records').replaceChildren();
 for(const r of own()){
  const line=document.createElement('p');line.className='hint';
  const confirmed=verified.has(r.txHash)&&r.status==='confirmed';
  line.textContent=`${r.assetId} · ${chains[r.chainId]?.name??r.chainId} · ${confirmed?'部署已核验（跨链尚未启用）':r.status==='failed'?'交易失败':'已记录，需链上核验'} · `;
  if(/^0x[0-9a-f]{64}$/i.test(r.txHash)&&chains[r.chainId]){const a=document.createElement('a');a.href=chains[r.chainId].explorer+'/tx/'+r.txHash;a.textContent=r.address||r.txHash;a.target='_blank';a.rel='noopener noreferrer';line.append(a);}
  $('real-records').append(line);
 }
}
const run=fn=>session.action(async()=>{try{await fn();}catch(e){message(e.code==='ACTION_REJECTED'||e.code===4001?'已取消钱包操作。':e.code?'操作未完成，请检查钱包网络和交易状态。':String(e.message).slice(0,180),true);}});
async function checkMetadata(p){if(p.kind!=='RestrictedAssetOFTV2')return;const req=new FetchRequest(chains[56].rpc);req.timeout=15000;const rpc=new JsonRpcProvider(req);try{await checkSourceMetadata(p,rpc);}finally{rpc.destroy();}}
async function verify(r){const updated=await verifyRealDeployment(r,session.state().provider);if(updated.status==='confirmed')verified.add(r.txHash);return updated;}
for(const id of ['real-asset','real-kind'])$(id).onchange=()=>{reset();render();};
$('real-close').onclick=reset;dialog.addEventListener('cancel',reset);
$('real-ack').onchange=render;
window.addEventListener('pilot-invalidate',reset);window.addEventListener('pilot-render',render);
window.addEventListener('storage',e=>{if(e.key===key){reset();storageError=true;message('另一页面修改了部署记录，请刷新本页后重新核验。',true);render();}});
$('real-prepare').onclick=()=>run(async()=>{
 if(selected().kind==='RestrictedAssetOFT')throw Error('旧版仅用于核验与恢复，请选择保留原币名称的新版。');
 reset();const seq=revision,p=await realDeployment(selected().assetId,selected().kind),c=await session.context();assertContext(p,c.account,c.chainId);
 if(existing(p))throw Error('已有部署记录，请先核验，不要重复部署。');save();
 const rpc=session.state().provider;await checkRealEnvironment(p,rpc);await checkMetadata(p);
 const gas=await rpc.estimateGas({from:p.account,data:p.data,value:0n}),fee=await rpc.getFeeData(),price=fee.maxFeePerGas??fee.gasPrice;
 if(!price)throw Error('未取得有效手续费报价。');const limit=(gas*120n+99n)/100n,cap=limit*price;
 if(await rpc.getBalance(p.account)<cap)throw Error('当前网络手续费余额不足。');
 const current=await session.context();assertContext(p,current.account,current.chainId);if(seq!==revision)throw Error('预览已失效，请重新检查。');
 plan={...p,gasLimit:String(limit),gasPrice:String(price),priority:String(fee.maxPriorityFeePerGas??0n),eip1559:fee.maxFeePerGas!=null,createdAt:Date.now()};
 $('real-details').replaceChildren();
 for(const [k,v] of [['资产',realAssets.find(a=>a.id===p.assetId).name],['代币名称',p.kind==='RestrictedAssetOFTV2'?p.args[0]:'见部署数据'],['代币符号',p.kind==='RestrictedAssetOFTV2'?p.args[1]:'见部署数据'],['部署',p.kind],['网络',chains[p.chainId].name],['BSC 原币',p.sourceToken],['管理员 / 测试钱包',p.account],['额度','单笔 0.000001 / 累计 0.000010 枚'],['转入原生币','0，仅支付部署手续费'],['按当前报价的费用上限',`${formatEther(cap)} ${chains[p.chainId].symbol}`]]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=v;$('real-details').append(dt,dd);}
 $('real-data').textContent=JSON.stringify(plan,null,2);dialog.showModal();message('部署预览已准备，尚未发送交易。');
});
$('real-sign').onclick=()=>run(async()=>{
 if(!plan||!$('real-ack').checked)throw Error('请重新预览并核对。');const approved=plan,seq=revision;
 if(Date.now()-approved.createdAt>120000){reset();throw Error('费用预览已过期，请重新检查。');}
 const c=await session.context();assertContext(approved,c.account,c.chainId);
 if(existing(approved))throw Error('已有交易，请先核验。');
 const rebuilt=await realDeployment(approved.assetId,approved.kind);await checkMetadata(rebuilt);if(rebuilt.dataHash!==approved.dataHash)throw Error('构建已变化。');
 save();const signer=await session.state().provider.getSigner(approved.account),now=await session.context();assertContext(approved,now.account,now.chainId);
 if(seq!==revision)throw Error('预览状态已变化，请重新检查。');
 reset();message('等待你在钱包中确认…');
 const tx={chainId:approved.chainId,from:approved.account,data:approved.data,value:0n,gasLimit:BigInt(approved.gasLimit)};
 if(approved.eip1559){tx.maxFeePerGas=BigInt(approved.gasPrice);tx.maxPriorityFeePerGas=BigInt(approved.priority);}else tx.gasPrice=BigInt(approved.gasPrice);
 const sent=await signer.sendTransaction(tx);records.push(transactionRecord(sent,approved));
 try{save();}catch{message(`已广播但记录保存失败，请立即导出并保存哈希，勿重复部署：${sent.hash}`,true);return;}
 message(`已提交：${sent.hash}。点击核验当前网络记录检查回执。`);
});
$('real-refresh').onclick=()=>run(async()=>{for(const r of own().filter(r=>r.chainId===session.state().chainId)){const updated=await verify(r);records[records.indexOf(r)]=updated;}save();message('已读取当前网络回执；只有成功匹配的部署标记为已核验。');});
$('real-recover').onclick=()=>run(async()=>{
 const hash=$('real-hash').value.trim();if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('请输入完整部署交易哈希。');
 const p=await realDeployment(selected().assetId,selected().kind),c=await session.context();assertContext(p,c.account,c.chainId);
 const updated=await verify({...p,txHash:hash});if(updated.status!=='confirmed')throw Error('未发现成功且匹配的部署。');
 if(!records.some(r=>r.txHash===hash&&r.chainId===p.chainId))records.push(updated);save();message('已从链上恢复此资产的部署记录。');
});
$('real-export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({project:'Tevumi',version:1,deployments:own()},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='tevumi-real-deployments.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
render();if(storageError)message('已有记录无法读取，请保留浏览器数据并检查备份，暂不部署。',true);
