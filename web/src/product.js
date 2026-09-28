import { selectedAsset, selectAsset } from './assets.js';
import {walletSession as session} from './main.js';
import {Contract,formatEther} from 'ethers';
import {pairFor} from './real-route.js';
import {chains} from './pilot.js';
import './product.css';
const $=id=>document.getElementById(id);
$('card-connect').onclick=()=>$('connect').click();
$('choose-bsc').onclick=()=>$('switch-bsc').click();
$('choose-arc').onclick=()=>$('switch-arc').click();
$('asset-select').onchange=()=>{selectAsset($('asset-select').value);window.dispatchEvent(new Event('pilot-invalidate'));window.dispatchEvent(new Event('pilot-render'));updateProduct();};
function updateProduct(){
  const asset=selectedAsset(), real=asset.id!=='tvpilot';
  $('asset-select').disabled=$('connect').disabled;
  $('amount-symbol').textContent=asset.symbol;
  $('asset-status').textContent=real?'已通过新版小额往返验证（2026-09-20）· 仅指定钱包，单笔 0.000001 枚。':'TVPILOT 无市场价值，仅用于实验。';
  $('asset-source').hidden=!real;
  if(real)$('asset-source').href='https://bscscan.com/token/'+asset.sourceToken;
  if(real)$('prepare-config').disabled=true;

  const connected=/^0x[0-9a-f]{40}$/i.test($('account').textContent.trim());
  $('card-connect').hidden=connected;
  $('card-connect').disabled=$('connect').disabled;
  document.querySelector('.product-actions').hidden=!connected;
  $('prepare-approve').hidden=true;
  $('prepare-send').textContent=session.state().chainId===5042?'返回 BSC ↗':'授权并跨链 ↗';
  const network=$('network').textContent;
  const active=network==='BSC Mainnet'?'bsc':network==='Arc Mainnet'?'arc':null;
  for(const chain of ['bsc','arc']){const b=$(`choose-${chain}`);b.setAttribute('aria-pressed',String(chain===active));b.disabled=$(`switch-${chain}`).disabled;}
  $('source-label').textContent=active?network:'选择发送网络';
  $('destination-label').textContent=active==='bsc'?'Arc':active==='arc'?'BNB Chain':'另一条链';
}
window.addEventListener('pilot-render',updateProduct);updateProduct();

function showView(){
  const view=['history','about'].includes(location.hash.slice(1))?location.hash.slice(1):'bridge';
  document.querySelector('.product-grid').hidden=view!=='bridge';
  $('history').hidden=view!=='history';
  $('about').hidden=view!=='about';
  document.querySelector('.advanced').hidden=view!=='about';
  for(const link of document.querySelectorAll('[data-view]')){
    if(link.dataset.view===view)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  }
}
window.addEventListener('hashchange',showView);showView();

import './real-console.js';

import './real-route-console.js';

let balanceKey='',readVersion=0;
const identity=()=>{const s=session.state();return `${s.account}:${s.chainId}:${selectedAsset().id}`;};
async function readBalances(){
 const s=session.state(),asset=selectedAsset(),key=identity(),version=++readVersion;
 $('token-balance').textContent='读取中…';$('native-balance').textContent='读取中…';$('balance-note').textContent='正在查询发送链余额…';
 try{
  const c=await session.context();if(c.account!==s.account||c.chainId!==s.chainId)throw Error();
  let token;
  if(asset.id==='tvpilot')token=s.records.filter(r=>r.account.toLowerCase()===s.account.toLowerCase()&&r.kind===(s.chainId===56?'PilotToken':'PilotOFT')).at(-1)?.address;
  else {const pair=pairFor(asset.id);token=s.chainId===56?pair[56].sourceToken:pair[5042].address;}
  if(!token)throw Error();
  const block=await s.provider.getBlockNumber(),contract=new Contract(token,['function balanceOf(address) view returns(uint256)'],s.provider);
  const [amount,native]=await Promise.all([contract.balanceOf(s.account,{blockTag:block}),s.provider.getBalance(s.account,block)]);
  const now=await session.context();if(version!==readVersion||key!==identity()||now.account!==s.account||now.chainId!==s.chainId)return;
  $('token-balance').textContent=`${formatEther(amount)} ${asset.symbol}`;$('native-balance').textContent=`${formatEther(native)} ${chains[s.chainId].symbol}`;
  $('balance-note').textContent=`${chains[s.chainId].name} · 区块 ${block} · 交易后可刷新余额`;
 }catch{if(version===readVersion&&key===identity()){$('token-balance').textContent='暂未取得';$('native-balance').textContent='暂未取得';$('balance-note').textContent='请确认钱包网络后刷新余额；查询失败不代表余额为零。';}}
}
function balanceState(){const s=session.state(),key=identity();$('refresh-balances').disabled=s.busy||!s.account||!chains[s.chainId];if(key===balanceKey)return;balanceKey=key;readVersion++;$('token-balance').textContent='连接钱包后查询';$('native-balance').textContent='—';$('balance-note').textContent='余额来自当前发送网络。';if(s.account&&chains[s.chainId])void readBalances();}
$('refresh-balances').onclick=()=>void readBalances();window.addEventListener('pilot-render',balanceState);balanceState();
let quoteTimer;
function resetQuote(){ clearTimeout(quoteTimer); $('receive-estimate').textContent='预览核验后显示';$('fee-estimate').textContent='预览核验后显示';$('quote-note').textContent='检查并预览不会发送交易；费用按发送链原生币支付。'; }
window.addEventListener('bridge-quote',e=>{const p=e.detail;clearTimeout(quoteTimer);if(!p||p.key!=='send'){resetQuote();return;}$('receive-estimate').textContent=`${formatEther(p.amount)} ${selectedAsset().symbol}`;$('fee-estimate').textContent=`${formatEther(BigInt(p.value)+BigInt(p.feeCap))} ${chains[p.chainId].symbol}`;$('quote-note').textContent='当前预览估算，有效期两分钟；实际费用以链上回执为准。';quoteTimer=setTimeout(resetQuote,Math.max(0,120000-(Date.now()-p.createdAt)));});
const directory=$('asset-contracts');if(directory){directory.innerHTML='<h3>当前真实资产合约</h3><p class="hint">两币新版已通过一次小额往返；这是历史验证结果，发送前仍会读取当前配置。旧 tBNLIFE / tCAT 合约仅保留历史记录，不用于当前通道。</p>';for(const [id,label]of [['binancelife','币安人生'],['cat','CAT']]){const pair=pairFor(id),row=document.createElement('p');row.textContent=label+' · ';for(const chainId of [56,5042]){const a=document.createElement('a');a.href=chains[chainId].explorer+'/address/'+pair[chainId].address;a.target='_blank';a.rel='noopener noreferrer';a.textContent=chains[chainId].name+' '+pair[chainId].address;row.append(a,document.createElement('br'));}directory.append(row);}}
