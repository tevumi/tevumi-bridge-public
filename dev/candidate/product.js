import {mountCandidate} from './app.js';
import '../../web/src/product.css';
import {createCandidateWallet} from './wallet.js';
const $=id=>document.getElementById(id);
const walletMode=new URLSearchParams(location.search).get('wallet')==='1';let ui;
const timeoutParam=new URLSearchParams(location.search).get('walletTimeout');
const wallet=walletMode?createCandidateWallet(window.ethereum,{timeoutMs:timeoutParam===null?0:Math.max(50,Number(timeoutParam)||50),onChange:()=>{ui?.invalidate();$('message').textContent='钱包状态已变化，请重新预览；已提交操作可刷新记录核验。';}}):undefined;
// Same product document, separate local-only backend. Never load wallet/mainnet code.
document.title='Tevumi · 产品流程本地测试';
document.querySelector('.advanced').remove();$('review').remove();$('about').remove();
document.querySelector('a[data-view="about"]').remove();
document.querySelector('.lead').textContent='本地模拟环境 · 不连接真实钱包或主网';
document.querySelector('.pilot-pill').textContent='本地测试';
document.querySelector('.scope-details').remove();
$('asset-select').querySelector('[value="tvpilot"]').remove();$('asset-select').value='binancelife';
$('bridge-amount').value='1';document.querySelector('.amount-label span').textContent='本地单笔上限 10';
$('amount-help').textContent='模拟代币没有价值；同一测试账户接收。';
$('asset-status').textContent='候选合约本地模拟测试';
$('quote-note').textContent='本地 Endpoint 消息费为 0；不代表主网费用。';
document.querySelector('.signature-note').textContent='连续准备授权与发送 · 每一步独立模拟确认';
$('card-connect').remove();$('connect').textContent='本地模拟账户';
$('prepare-approve').remove();document.querySelector('.product-actions').hidden=false;
$('prepare-send').textContent='授权并跨链 ↗';
$('flow-sign').textContent='模拟确认';
$('flow-review').querySelector('p.hint').textContent='本地候选合约模拟确认，不会打开钱包。';
$('flow-ack').parentElement.lastChild.textContent='我已核对本地账户、方向、数量与费用。';
$('flow-review').querySelector('details').remove();
$('flow-details').style.whiteSpace='pre-wrap';$('flow-details').style.overflowWrap='anywhere';
$('export-operations').remove();document.querySelector('.recovery-help').remove();
for(const p of $('history').querySelectorAll('p.hint'))p.textContent='本地记录会保存；服务重启后核验恢复。重建环境会归档旧记录并创建新模拟链。';
const panel=document.createElement('section');panel.className='panel';panel.id='local-controls';
panel.innerHTML=`<h2>本地测试控制</h2><label>模拟账户<select id="account"><option value="0">账户 A</option><option value="1">账户 B</option></select></label>
<select id="side" hidden><option value="bsc">BSC</option><option value="arc">Arc</option></select>
<label><input id="auto-deliver" type="checkbox" checked>自动模拟目标到账</label>
<label><input id="pause-receive" type="checkbox">暂停接收</label><label><input id="fail-send" type="checkbox">源端回滚</label>
<button id="faults" class="button secondary">应用模拟条件</button><button id="reset" class="text-button">重建本地环境</button>
<p id="balances"></p><p id="accounting"></p><p id="session"></p><details><summary>本地地址</summary><pre id="addresses"></pre></details>`;
document.querySelector('main').append(panel);
try{const saved=JSON.parse(sessionStorage.getItem('candidate-product-selection')||'{}');for(const [id,allowed] of [['account',['0','1']],['side',['bsc','arc']],['asset-select',['binancelife','cat']]])if(allowed.includes(saved[id]))$(id).value=saved[id];}catch{}
function navigate(){const history=location.hash==='#history';$('history').hidden=!history;document.querySelector('.product-grid').hidden=history;}
window.addEventListener('hashchange',navigate);navigate();
for(const side of ['bsc','arc'])$('choose-'+side).onclick=()=>{$('side').value=side;$('side').dispatchEvent(new Event('input'));};
$('refresh-balances').onclick=()=>$('refresh-operations').click();
if(walletMode){
 document.querySelector('.lead').textContent='本地钱包接口测试 · 仅 31337 / 31338 模拟链';
 $('connect').disabled=false;$('connect').textContent='连接测试钱包';
 $('connect').onclick=async()=>{try{await wallet.connect();$('message').textContent='钱包接口已连接，请选择匹配的测试账户和网络。';}catch{$('message').textContent='钱包连接未完成。';}};
 $('flow-sign').textContent='请求测试钱包确认';$('flow-review').querySelector('p.hint').textContent='通过浏览器钱包接口发送，仅用于本地模拟链测试。';
 for(const side of ['bsc','arc'])$('choose-'+side).onclick=async()=>{try{await wallet.switchChain(side==='bsc'?31337:31338);$('side').value=side;$('side').dispatchEvent(new Event('input'));}catch{$('message').textContent='钱包切链未完成，原方向保持不变。';}};
}
ui=mountCandidate({wallet,ids:{asset:'asset-select',amount:'bridge-amount',prepare:'prepare-send',refresh:'refresh-operations',records:'operations',review:'flow-review','review-title':'flow-title','review-details':'flow-details',ack:'flow-ack',confirm:'flow-sign',cancel:'flow-close'},
 onControls:busy=>{for(const id of ['choose-bsc','choose-arc','refresh-balances'])$(id).disabled=busy;},
 onRender:(state,intent)=>{
  try{sessionStorage.setItem('candidate-product-selection',JSON.stringify({'account':String(intent.account),'side':intent.side,'asset-select':intent.asset}));}catch{}
  for(const row of $('operations').children)row.hidden=row.dataset.account!==String(intent.account);
  const asset=state.assets.find(a=>a.id===intent.asset),balance=asset.balances[intent.account];
  if(walletMode){
   for(const r of state.walletRequests??[])if(r.intent.account===intent.account){const row=document.createElement('p');row.dataset.walletStatus=r.status;row.textContent=`钱包操作：${r.status==='unknown'?'广播结果待核验，禁止重复发送':r.status==='confirmed'?'源交易已确认':r.status==='rejected'?'用户已取消':r.status==='failed'?'源交易失败':'交易冲突，需核验'}${r.hash?' · '+r.hash:''}`;row.style.overflowWrap='anywhere';$('operations').append(row);}
  }
  $('token-balance').textContent=balance[intent.side]+' '+asset.symbol;$('native-balance').textContent='本地模拟';$('amount-symbol').textContent=asset.symbol;
  $('source-label').textContent=intent.side==='bsc'?'BSC 模拟链':'Arc 模拟链';$('destination-label').textContent=intent.side==='bsc'?'Arc 模拟链':'BSC 模拟链';
  for(const side of ['bsc','arc'])$('choose-'+side).setAttribute('aria-pressed',String(side===intent.side));
 },onPreview:p=>{$('receive-estimate').textContent=p?p.intent.amount:'预览核验后显示';$('fee-estimate').textContent=p?`消息费 0 · Gas 上限 ${p.feeCap} 模拟原生币`:'预览核验后显示';}
});
