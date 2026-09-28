import {JsonRpcProvider,FetchRequest,formatEther} from 'ethers';
import {walletSession as session} from './main.js';
import {chains,assertContext} from './pilot.js';
import {tester} from './real-deployment.js';
import {routes} from './routes.js';
import {pairFor,inspectRealPair,assertRealConfigRecord,verifyRealConfig} from './real-route.js';

const $=id=>document.getElementById(id),host=document.createElement('section');host.className='panel real-admin';
host.innerHTML=`<h2>真实资产 · 通道配置</h2><p class="hint">四份合约已部署并通过 Sourcify 源码完全匹配验证；这不等于安全审计。每个币单独设置可信合约、消息库与两家验证服务。每次只发送一笔配置交易，不转移代币。</p><label>配置资产<select id="config-asset"><option value="binancelife">币安人生</option><option value="cat">CAT</option></select></label><p id="config-network" class="hint"></p><div class="flow-actions"><button id="config-bsc" class="button secondary">切换到 BSC</button><button id="config-arc" class="button secondary">切换到 Arc</button></div><div class="flow-actions"><button id="config-check" class="button secondary">核验该币两侧配置</button><button id="config-prepare" class="button secondary">预览当前链下一项配置</button><button id="config-export" class="text-button">导出配置记录 ↓</button></div><p id="config-message" role="status" class="message">尚未核验；配置完成后仍需小额往返测试。</p><div id="config-states" class="route-details"></div><div id="config-records"></div>`;
document.querySelector('.real-admin').after(host);
const dialog=document.createElement('dialog');dialog.id='config-review';dialog.innerHTML=`<div class="modal-top"><span class="eyebrow">REAL ASSET CONFIGURATION</span><button id="config-close" class="text-button" aria-label="关闭配置预览">✕</button></div><h2 id="config-title"></h2><dl id="config-details" class="review-details"></dl><details><summary>完整配置数据</summary><pre id="config-data"></pre></details><p class="hint">两家验证服务 Canary 与 P2P 必须共同验证；管理员仍可修改配置。本次不转移代币。钱包修改 Gas 后实际费用可能超过本页估算。</p><label class="ack"><input id="config-ack" type="checkbox">我已核对币种、两侧合约、网络和费用。</label><button id="config-sign" class="button dark" disabled>在钱包中确认配置 ↗</button>`;document.body.append(dialog);
const key='tevumi-real-configurations-v1',providers={},checked=new Set();let records=[],storageError=false,plan,revision=0;
try{records=JSON.parse(localStorage.getItem(key)||'[]');if(!Array.isArray(records))throw Error();}catch{records=[];storageError=true;}
const selected=()=>$('config-asset').value;
const own=()=>records.filter(r=>r?.account===session.state().account);
const save=()=>{if(storageError)throw Error('配置记录无法读取，请保留备份并刷新后核查。');localStorage.setItem(key,JSON.stringify(records));};
function message(text,error=false){$('config-message').textContent=text;$('config-message').classList.toggle('error',error);}
function cancel(){revision++;plan=undefined;$('config-ack').checked=false;$('config-sign').disabled=true;if(dialog.open)dialog.close();}
function rpc(id){if(session.state().chainId===id)return session.state().provider;if(!providers[id]){const r=new FetchRequest(chains[id].rpc);r.timeout=15000;providers[id]=new JsonRpcProvider(r,undefined,{cacheTimeout:-1});}return providers[id];}
function render(){const s=session.state();for(const id of ['config-check','config-prepare','config-bsc','config-arc'])$(id).disabled=s.busy||s.account!==tester||storageError;$('config-asset').disabled=s.busy;$('config-sign').disabled=s.busy||!plan||!$('config-ack').checked;$('config-export').disabled=!own().length;$('config-network').textContent=`当前钱包网络：${chains[s.chainId]?.name??'未连接'}。部署与配置是不同操作，请勿重复部署。`;
 $('config-records').replaceChildren();for(const r of own().filter(r=>r.assetId===selected())){const row=document.createElement('p');row.className='hint';row.textContent=`${chains[r.chainId]?.name} · ${r.label} · ${checked.has(r.txHash)?r.status==='confirmed'?'交易已核验':r.status==='failed'?'交易失败':'等待确认':'需重新核验'} · `;if(chains[r.chainId]&&/^0x[0-9a-f]{64}$/i.test(r.txHash)){const a=document.createElement('a');a.href=chains[r.chainId].explorer+'/tx/'+r.txHash;a.textContent=r.txHash.slice(0,12)+'…';a.target='_blank';a.rel='noopener noreferrer';row.append(a);}$('config-records').append(row);}}
const run=fn=>session.action(async()=>{try{await fn();}catch(e){message(e.code===4001||e.code==='ACTION_REJECTED'?'已取消钱包操作。':e.code?'链上读取或钱包操作未完成，请重试核验；不要重复发送。':String(e.message).slice(0,180),true);}});
async function refreshRecords(assetId){for(const r of own().filter(r=>r.assetId===assetId)){const u=await verifyRealConfig(r,rpc(r.chainId));records[records.indexOf(r)]=u;checked.add(r.txHash);}save();}
function showStates(assetId,snapshots){$('config-states').replaceChildren();const pair=pairFor(assetId);for(const id of [56,5042]){const div=document.createElement('div'),title=document.createElement('h3');title.textContent=chains[id].name;div.append(title);const addr=document.createElement('p');addr.className='hint';addr.textContent=pair[id].address;div.append(addr);for(const step of snapshots[id].steps){const p=document.createElement('p');p.textContent=(snapshots[id].matches[step.key]?'✓ ':'待配置 · ')+step.label;div.append(p);}$('config-states').append(div);}}
async function inspect(){const assetId=selected(),seq=revision,c=await session.context();if(c.account!==tester)throw Error('请连接指定测试钱包。');await refreshRecords(assetId);const snapshots=await inspectRealPair(assetId,rpc);if(seq!==revision||assetId!==selected())throw Error('状态已变化，请重新核验。');showStates(assetId,snapshots);return snapshots;}
$('config-asset').onchange=()=>{cancel();$('config-states').replaceChildren();message('已切换币种，请重新核验两侧配置。');render();};
for(const side of ['bsc','arc'])$(`config-${side}`).onclick=()=>$(`switch-${side}`).click();
$('config-close').onclick=cancel;dialog.addEventListener('cancel',cancel);$('config-ack').onchange=render;
window.addEventListener('pilot-render',render);window.addEventListener('pilot-invalidate',()=>{cancel();checked.clear();$('config-states').replaceChildren();});
window.addEventListener('storage',e=>{if(e.key===key){cancel();storageError=true;message('另一页面修改了配置记录，请刷新本页再核验。',true);render();}});
$('config-check').onclick=()=>run(async()=>{cancel();message('正在读取两侧链上配置…');const s=await inspect();message(Object.values(s).every(v=>v.ready)?'该币两侧配置已匹配；尚未完成真实币往返测试。':'已核验，按待配置项目逐笔预览并在钱包确认。');});
$('config-prepare').onclick=()=>run(async()=>{
 cancel();const seq=revision,assetId=selected(),c=await session.context();if(!chains[c.chainId])throw Error('请选择 BSC 或 Arc。');message('正在核验两侧合约及待配置项目…');
 const snapshots=await inspect(),step=snapshots[c.chainId].steps.find(s=>!snapshots[c.chainId].matches[s.key]);
 if(!step){message('当前链配置已匹配，请切换另一条链并核验。');return;}
 if(own().some(r=>r.assetId===assetId&&r.chainId===c.chainId&&r.status==='pending'))throw Error('当前链仍有配置交易等待确认，请先核验记录。');
 const pair=pairFor(assetId),provider=rpc(c.chainId),gas=await provider.estimateGas({from:tester,to:step.to,data:step.data,value:0n}),fee=await provider.getFeeData(),price=fee.maxFeePerGas??fee.gasPrice;
 if(!price)throw Error('未取得有效手续费报价。');const limit=(gas*120n+99n)/100n,cap=limit*price;if(await provider.getBalance(tester)<cap)throw Error('手续费余额不足。');
 const current=await session.context();if(current.account!==tester||current.chainId!==c.chainId||seq!==revision)throw Error('钱包状态已变化，请重新预览。');
 plan={...step,assetId,account:tester,sourceToken:pair[c.chainId].sourceToken,gasLimit:String(limit),gasPrice:String(price),priority:String(fee.maxPriorityFeePerGas??0n),eip1559:fee.maxFeePerGas!=null,createdAt:Date.now()};assertRealConfigRecord(plan);
 $('config-title').textContent=step.label;$('config-details').replaceChildren();for(const [k,v] of [['资产',assetId==='cat'?'CAT':'币安人生'],['网络',chains[c.chainId].name],['当前链桥合约',pair[c.chainId].address],['对端桥合约',pair[c.chainId===56?5042:56].address],['调用合约',step.to],['原生币转入','0'],['按当前报价的费用上限',formatEther(cap)+' '+chains[c.chainId].symbol]]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=v;$('config-details').append(dt,dd);}
 $('config-data').textContent=JSON.stringify({...plan,policy:routes[c.chainId]},null,2);dialog.showModal();message('预览已生成，尚未广播交易。');
});
$('config-sign').onclick=()=>run(async()=>{
 if(!plan||!$('config-ack').checked)throw Error('请重新预览并确认。');const approved=plan,seq=revision;
 if(Date.now()-approved.createdAt>120000){cancel();throw Error('预览已过期，请重新检查。');}assertRealConfigRecord(approved);const c=await session.context();assertContext(approved,c.account,c.chainId);
 const s=await inspect();if(s[approved.chainId].matches[approved.key]){cancel();throw Error('该项目已配置，无需重复发送。');}
 if(own().some(r=>r.assetId===approved.assetId&&r.chainId===approved.chainId&&r.status==='pending'))throw Error('已有配置交易等待确认。');
 const signer=await session.state().provider.getSigner(tester),current=await session.context();assertContext(approved,current.account,current.chainId);
 if(seq!==revision||Date.now()-approved.createdAt>120000)throw Error('预览已失效，请重新检查。');save();cancel();message('等待钱包确认这笔配置…');
 const tx={chainId:approved.chainId,from:tester,to:approved.to,data:approved.data,value:0n,gasLimit:BigInt(approved.gasLimit)};
 if(approved.eip1559){tx.maxFeePerGas=BigInt(approved.gasPrice);tx.maxPriorityFeePerGas=BigInt(approved.priority);}else tx.gasPrice=BigInt(approved.gasPrice);
 const sent=await signer.sendTransaction(tx);records.push({...approved,txHash:sent.hash,status:'pending'});try{save();}catch{message('已广播但保存失败，请导出记录并保存哈希：'+sent.hash,true);return;}message('交易已提交，请点击“核验该币两侧配置”：'+sent.hash);
});
$('config-export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,configurations:own()},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='tevumi-real-configurations.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
render();if(storageError)message('配置记录无法读取，请保留备份，暂不签名。',true);
