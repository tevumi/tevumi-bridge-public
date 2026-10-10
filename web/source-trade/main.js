import {JsonRpcProvider,Contract,parseUnits,formatUnits,formatEther,hexlify,toUtf8Bytes} from 'ethers';
import {pickWallet,rememberWalletSession,restoreWalletSession,clearWalletSession} from '../preview/wallet-picker.js';
import {TradeEngine} from './engine.js';
import {createOrder,validateOrder,legs,progress,stringify} from './order.js';
import {wotrRoutes} from '../src/wotr-routes.js';
import {hashValid} from './proofs.js';
import {continueTrade,waitingForProof} from './workflow.js';
const host=document.querySelector('[data-source-trade]');
const embedded=Boolean(host);
const $=id=>embedded?host.querySelector(`[data-trade-id="${id}"]`):document.getElementById(id);
const production=embedded||location.pathname.startsWith('/preview/');
const apiPath=path=>production?path.replace(/^\/api\//,'/api/source-trade/'):path;
const providers=Object.fromEntries([56,5042].map(chain=>[chain,new JsonRpcProvider(location.origin+apiPath('/api/rpc/'+chain),chain,{batchMaxCount:1,cacheTimeout:-1})]));
let lang='en',wallet,account,orders=[],order,quote,working=false,restored=false,quoteVersion=0,checking=false;
let flow,previewTimer,previewing=false;
const text=(en,zh)=>lang==='en'?en:zh;
const tr={funding:()=>text('Move funds','资金跨链'),buy:()=>text('Buy on BNB Chain','在 BNB Chain 买入'),sell:()=>text('Sell on BNB Chain','在 BNB Chain 卖出'),bridge:()=>text('Bridge WOTR','WOTR 跨链'),approval:()=>text('Approve this exact amount','授权本次数量')};
let cacheKey='tevumi:source-trade:orders:v1';
const api=async(path,init)=>{const response=await fetch(apiPath(path),{...init,signal:AbortSignal.timeout(55000)});const data=await response.json();if(!response.ok)throw Error(response.status===401?text('Connect and sign in to recover your orders. The signature does not transfer funds.','请连接并签名登录以恢复订单；此签名不转移资产。'):data.error||'Order service unavailable.');return data;};
async function signIn(){
 if(!production)return;
 const challenge=await api('/api/auth/challenge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account})});
 message('Sign in to save and recover orders. This signature does not approve or transfer tokens.','请签名登录以保存和恢复订单。此签名不授权或转移代币。');
 const signature=await wallet.request({method:'personal_sign',params:[hexlify(toUtf8Bytes(challenge.message)),account]});
 await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:challenge.id,signature})});
}
function useWallet(choice,who){
 wallet=choice.provider;account=who;rememberWalletSession(choice,account);
 if(production)cacheKey='tevumi:source-trade:orders:v2:'+account.toLowerCase();
 wallet.on?.('accountsChanged',()=>{flow?.abort();account=null;wallet=null;orders=[];restored=false;clearWalletSession();selectOrder(null);message('Wallet changed. Reconnect before continuing.','钱包已变化，请重新连接后继续。');});
}
const message=(en,zh=en)=>{$('message').textContent=text(en,zh);};
const explain=e=>e?.code===4001||e?.code==='ACTION_REJECTED'?text('Wallet confirmation cancelled. No transaction was submitted.','已取消钱包确认，未提交交易。'):text('Operation is not complete. Keep the original transaction and retry verification. Details: ','操作尚未完成，请保留原交易并重新核验。详细信息：')+String(e?.shortMessage||e?.message||'Unavailable').replace(/https?:\/\/\S+/g,'[service]').slice(0,280);
async function persist(o){
 const oldRevision=o.revision;
 const exists=orders.some(v=>v.id===o.id);
 if(exists)o.revision++;
 const index=orders.findIndex(v=>v.id===o.id);
 const next=orders.slice();if(index<0)next.unshift(o);else next[index]=o;
 try{
  // Save before requesting any signature. Failure leaves the operation locked.
  localStorage.setItem(cacheKey,stringify(next));
  await api('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:stringify(o)});
  orders=next;
 }catch(e){o.revision=oldRevision;restored=false;throw e;}
 render();
}
const engine=new TradeEngine({providers,api,persist,onChange:()=>render()});
function clearQuote(){quote=null;quoteVersion++;previewing=false;render();schedulePreview();}
function active(){return orders.find(o=>o.account.toLowerCase()===account?.toLowerCase()&&!['COMPLETED','CANCELLED'].includes(o.state));}
function selectOrder(o){order=o;quote=null;quoteVersion++;previewing=false;engine.results={};if(o){engine.setOrder(o);$('direction').value=o.kind;$('amount').value=formatUnits(o.input,6);}render();}
async function balances(){
 if(!account)return;const who=account;
 try{
  const token=new Contract(wotrRoutes.current.arc,['function balanceOf(address) view returns(uint256)'],providers[5042]);
  const [arc,bnb,wotr]=await Promise.all([providers[5042].getBalance(who),providers[56].getBalance(who),token.balanceOf(who)]);
  if(account===who)$('balance').textContent=text(`Arc: ${formatEther(arc)} USDC · ${formatEther(wotr)} WOTR | BNB Chain: ${formatEther(bnb)} BNB`,`Arc：${formatEther(arc)} USDC · ${formatEther(wotr)} WOTR | BNB Chain：${formatEther(bnb)} BNB`);
 }catch{if(account===who)$('balance').textContent=text('Balances unavailable. Refresh to retry; they are checked again before sending.','余额暂不可读，刷新可重试；发送前会重新核验。');}
}
function renderQuote(){
 if(!quote){$('quote').textContent=text('Refresh the quote for the next step.','刷新下一步的报价。');return;}
 const q=quote;let lines=[text(`Step ${q.leg+1}: ${tr[q.kind]()}`,`第 ${q.leg+1} 步：${tr[q.kind]()}`)];
 if(q.kind==='funding'){
  const d=q.chain===5042?6:18,out=q.targetChain===5042?6:18;
  lines.push(text(`Input: ${formatUnits(q.amount,d)} ${q.chain===5042?'USDC':'BNB'}`,`输入：${formatUnits(q.amount,d)} ${q.chain===5042?'USDC':'BNB'}`));
  lines.push(text(`Estimated / minimum arrival: ${formatUnits(q.quote.estimate.toAmount,out)} / ${formatUnits(q.quote.estimate.toAmountMin,out)} ${q.targetChain===5042?'USDC':'BNB'}`,`预计 / 最低到账：${formatUnits(q.quote.estimate.toAmount,out)} / ${formatUnits(q.quote.estimate.toAmountMin,out)} ${q.targetChain===5042?'USDC':'BNB'}`));
  lines.push(text(`Route: ${q.quote.toolDetails?.name||q.quote.tool}`,`路由：${q.quote.toolDetails?.name||q.quote.tool}`));
  for(const fee of q.quote.estimate.feeCosts||[])lines.push(`${fee.name}: ${formatUnits(fee.amount,fee.token.decimals)} ${fee.token.symbol} · `+text(fee.included?'included in quote':'extra fee',fee.included?'已含在报价中':'额外收费'));
  for(const g of q.quote.estimate.gasCosts||[])lines.push(text('Source gas estimate: ','源链 Gas 估算：')+`${formatUnits(g.amount,g.token.decimals)} ${g.token.symbol}`);
  if(q.preview)lines.push(text(`Estimated WOTR after source purchase: ${formatEther(q.preview.estimatedArcWotr)} (estimate, not a locked end-to-end price)`,`源链买入后预计 WOTR：${formatEther(q.preview.estimatedArcWotr)}（估算，不是全流程锁价）`));
  if(q.preview)lines.push(text('BNB retained for gas/message fee: ','钱包预留 BNB 支付 Gas / 消息费：')+formatEther(q.preview.gasReserve));
 }else if(q.kind==='bridge'){
  lines.push(text(`Bridge amount: ${formatEther(q.amount)} WOTR`,`跨链数量：${formatEther(q.amount)} WOTR`));
  lines.push(q.key==='approve'?text('Confirm the exact WOTR approval in your wallet; the transfer follows automatically.','请在钱包确认本次数量的 WOTR 授权，之后自动继续转账。'):text(`Message fee: ${formatEther(q.value)} ${q.chain===56?'BNB':'USDC'}; source gas is additional.`,`消息费：${formatEther(q.value)} ${q.chain===56?'BNB':'USDC'}；来源链 Gas 另计。`));
  if(q.preview)lines.push(text(`Estimated source sale proceeds: ${formatEther(q.preview.out)} BNB; funding return fees are additional.`,`源链预计卖出所得：${formatEther(q.preview.out)} BNB；资金返回费用另计。`));
  if(q.returnPreview)lines.push(text(`Estimated Arc receipt after the source sale and funding fees: ${formatUnits(q.returnPreview.estimate.toAmount,6)} USDC (refreshed before each step).`,`源链卖出并扣资金返回费用后，Arc 预计收到：${formatUnits(q.returnPreview.estimate.toAmount,6)} USDC（每一步前重新报价）。`));
 }else{
  lines.push(text(`Market: ${q.quote.route==='curve'?'Four.meme curve':'PancakeSwap V2'}`,`市场：${q.quote.route==='curve'?'Four.meme 联合曲线':'PancakeSwap V2'}`));
  lines.push(text(`Estimated receive: ${formatEther(q.quote.out)} ${q.kind==='buy'?'WOTR':'BNB'}`,`预计收到：${formatEther(q.quote.out)} ${q.kind==='buy'?'WOTR':'BNB'}`));
  if(q.kind==='sell'&&q.quote.route==='curve')lines.push(text(`Minimum gross curve proceeds: ${formatEther(q.quote.minGross)} BNB (before protocol fee). Estimated net minimum: ${formatEther(q.quote.minOut)} BNB; net is not guaranteed by this contract.`,`最低曲线成交额：${formatEther(q.quote.minGross)} BNB（扣协议费前）。估算净额下限：${formatEther(q.quote.minOut)} BNB；此合约不保证净额下限。`));
  else lines.push(text('Minimum receive: ','最低收到：')+formatEther(q.quote.minOut)+(q.kind==='buy'?' WOTR':' BNB'));
  if(q.preview)lines.push(text(`Estimated Arc return: ${formatUnits(q.preview.estimate.toAmount,6)} USDC; refreshed after the actual sale.`,`预计返回 Arc：${formatUnits(q.preview.estimate.toAmount,6)} USDC；实际卖出后重新报价。`));
  if(q.reserve)lines.push(text('BNB retained in your wallet for gas/message fee: ','钱包预留 BNB 支付 Gas / 消息费：')+formatEther(q.reserve));
 }
 lines.push(text('Quotes last 60 seconds. Start continues this order with fresh quotes and automatic arrival checks. Confirm each transaction in your wallet. Later prices and fees may change.','报价有效期 60 秒。开始后自动更新后续报价、核验到账并继续本订单；每笔交易仍需在钱包确认。后续价格及费用可能变化。'));
 $('quote').textContent=lines.join('\n');
}
function render(){
 if(!embedded)document.documentElement.lang=lang==='en'?'en':'zh-CN';
 $('subtitle').textContent=production?text('Source-chain trading','源链成交'):text('Source-chain trading · local mainnet rehearsal','源链成交 · 本地主网验收');
 $('trade-nav').hidden=!production;$('historical').hidden=!production;
 $('historical').textContent=text('Historical WOTR pool and records','历史 WOTR 池与记录');
 const nav=$('trade-nav').querySelectorAll('a');nav[0].textContent=text('Buy','购买');nav[1].textContent=text('Bridge','跨链');nav[2].textContent=text('Swap','兑换');
 $('heading').textContent=text('Trade WOTR from Arc','从 Arc 买卖 WOTR');
 $('intro').textContent=text('Trade at the BNB Chain market, then return the purchased WOTR or sale proceeds to Arc. Each transaction is confirmed separately in your wallet.','在 BNB Chain 市场成交，再把买入的 WOTR 或卖出资金转回 Arc。每笔交易分别在钱包确认。');
 $('language').textContent=lang==='en'?'简体中文':'EN';
 $('connect').textContent=account?(restored?text('Wallet connected','钱包已连接'):text('Sign in to recover orders','签名登录恢复订单')):text('Connect wallet','连接钱包');
 $('account').textContent=account?text('Wallet: ','钱包：')+account:text('Connect your wallet to start.','连接钱包后开始。');
 $('asset').textContent='BNB WOTR: '+wotrRoutes.current.sourceToken+'\nArc WOTR: '+wotrRoutes.current.arc;
 $('direction-label').textContent=text('Direction','方向');$('amount-label').textContent=text('Input amount · ','输入数量 · ')+($('direction').value==='buy'?'USDC':'WOTR');
 $('refresh').textContent=text('Refresh quote','刷新报价');$('send').textContent=flow?text('Processing · confirm in wallet','处理中 · 请在钱包确认'):quote?text(order?.transactions.length?'Continue exchange':'Start exchange',order?.transactions.length?'继续兑换':'开始兑换'):text(previewing?'Getting quote…':'Review a quote first',previewing?'正在获取报价…':'先获取报价');
 $('pause').textContent=text('Pause after current transaction','暂停后续操作');$('pause').hidden=!flow;
 $('check').textContent=text('Verify original transactions','核验原交易');$('next').textContent=text('Start another order','开始另一笔订单');$('cancel').textContent=text('Cancel unsubmitted order','取消未提交订单');
 $('orders-heading').textContent=text('Orders','订单');$('export').textContent=text('Export records','导出记录');
 $('recovery-note').textContent=text('Arrival checks resume automatically after refresh. Further wallet requests require Continue exchange. Pausing does not cancel a submitted transaction. Keep the original order and journal.','刷新后自动恢复到账核验；继续钱包操作需要点击「继续兑换」。暂停不撤销已提交交易，请保留原订单与记录。');
 $('note').textContent=text('Real mainnet transactions. LI.FI funds the BNB market; LayerZero bridges WOTR. There is no Arc WOTR pool and no guaranteed end-to-end price or time. Funding slippage is 0.5%; source trade slippage is 1%. Gas and token message fees are additional. Residual BNB and sub-6-decimal WOTR stay in your wallet.','真实主网交易。LI.FI 转移资金，LayerZero 跨链 WOTR；不使用 Arc WOTR 池，不保证全流程价格或完成时间。资金跨链滑点 0.5%，源链交易滑点 1%。Gas 和代币消息费另计；预留 BNB 和不足六位小数的 WOTR 尾数留在钱包。');
 const index=order?progress(order.kind,engine.results):0;
 $('steps').replaceChildren(...legs(order?.kind||$('direction').value).map((key,i)=>{const li=document.createElement('li');li.textContent=tr[key]()+(i<index?text(' · verified',' · 已核验'):i===index?text(' · next',' · 下一步'):'');return li;}));
 $('direction').disabled=Boolean(order)||working;$('amount').disabled=Boolean(order)||working;
 $('refresh').disabled=!account||!restored||working||order?.state==='COMPLETED';$('send').disabled=!quote||working||!restored||Date.now()-quote.at>60000;
 $('check').disabled=!order||checking||working;$('connect').disabled=working;$('next').disabled=working||Boolean(order&&order.state!=='COMPLETED');$('cancel').disabled=!order||working||order.transactions.some(t=>t.state!=='REJECTED');
 renderQuote();renderOrders();
 if(embedded)renderEmbedded();
}
function renderEmbedded(){
 const buy=$('direction').value==='buy',input=buy?'USDC':'WOTR',output=buy?'WOTR':'USDC';
 $('heading').textContent=text(`Swap ${input} for ${output} on Arc`,`在 Arc 将 ${input} 兑换为 ${output}`);
 $('intro').textContent=text('Source market · automatic cross-chain settlement','源链市场成交 · 自动跨链结算');
 $('amount-label').textContent=text(`You sell · ${input}`,`卖出 · ${input}`);
 $('connect').hidden=!account||restored;$('next').hidden=!order||order.state!=='COMPLETED';$('cancel').hidden=!order||order.transactions.some(t=>t.state!=='REJECTED');
 host.querySelector('#source-input-token').textContent=input;host.querySelector('#source-input-symbol').textContent='Arc';host.querySelector('#source-output-token').textContent=output;
 host.querySelector('#source-output-label').textContent=text('Estimated receive','预计收到');
 $('orders-heading').textContent=text('Transaction history','交易记录');
 $('refresh').hidden=!account||!restored||working||previewing||Boolean(quote)||order?.state==='COMPLETED';
 const reverse=host.querySelector('#source-reverse');reverse.textContent=`⇄ ${input} → ${output}`;reverse.disabled=Boolean(order)||working;reverse.setAttribute('aria-label',text('Reverse swap direction','反转兑换方向'));
 let amount,decimals=buy?18:6;
 if(order?.state==='COMPLETED')amount=engine.results[2]?.destination?.received;
 else if(buy)amount=quote?.preview?.estimatedArcWotr||(quote?.kind==='buy'?quote.quote.out:quote?.kind==='bridge'?quote.amount:null);
 else amount=quote?.returnPreview?.estimate?.toAmount||quote?.preview?.estimate?.toAmount||(quote?.kind==='funding'?quote.quote.estimate.toAmount:null);
 host.querySelector('#source-output').textContent=amount?Number(formatUnits(amount,decimals)).toLocaleString(lang==='en'?'en-US':'zh-CN',{maximumFractionDigits:6}):'—';
 if(document.body.dataset.view==='swap'&&new URLSearchParams(location.search).get('market')!=='historical'){
  document.getElementById('journey-intro').textContent=text(`Swap ${input} for ${output} from Arc. Review the live quote before confirming.`,`从 Arc 将 ${input} 兑换为 ${output}，确认前请核对实时报价。`);
  const context=document.getElementById('context-swap');context.querySelector('h3').textContent=text(`From ${input} to ${output}.`,`从 ${input} 到 ${output}。`);context.querySelector('h3 + p').textContent=text('Trades execute at the BNB Chain market, then assets return to Arc.','交易在 BNB Chain 市场成交，随后资产返回 Arc。');context.querySelector('.context-route strong').textContent=`${input} → ${output}`;
  context.querySelector('.context-note').textContent=text('Quotes and arrivals update automatically. Confirm each transaction in your wallet.','报价与到账自动更新，请逐笔在钱包确认。');
 }
}
export function syncHostLanguage(){if(embedded){lang=document.documentElement.lang==='zh-CN'?'zh-CN':'en';render();}}
export async function syncHostWallet(provider,who){
 if(!embedded)return;
 syncHostLanguage();
 if(!who||!provider){if(account){flow?.abort();wallet=null;account=null;orders=[];restored=false;selectOrder(null);}return;}
 if(host.hidden||account?.toLowerCase()===who.toLowerCase())return;
 const choice=await restoreWalletSession();
 useWallet(choice?.provider===provider?choice:{provider,info:{rdns:'shared-wallet',name:'Wallet'}},who);
 try{await restore();selectOrder(active());void balances();if(order)await verify();}
 catch(e){if(waitingForProof(e))flowStatus('waiting');else $('message').textContent=explain(e);}
 render();schedulePreview();
}
function txLink(chain,hash){const a=document.createElement('a');a.href=(chain===56?'https://bscscan.com/tx/':'https://explorer.arc.io/tx/')+hash;a.textContent=hash;a.target='_blank';a.rel='noopener noreferrer';return a;}
function renderOrders(){
 $('orders').replaceChildren();const shown=orders.filter(o=>o.account.toLowerCase()===account?.toLowerCase());
 if(!shown.length){$('orders').textContent=text('No orders for this wallet.','此钱包暂无订单。');return;}
 for(const o of shown){
  const card=document.createElement('div');card.className='order';const title=document.createElement('h3');title.textContent=(o.kind==='buy'?'USDC → WOTR':'WOTR → USDC')+' · '+text(o.state==='COMPLETED'?'Completed':o.state==='CANCELLED'?'Cancelled':'In progress',o.state==='COMPLETED'?'已完成':o.state==='CANCELLED'?'已取消':'进行中');card.append(title);
  for(const t of o.transactions){
   const p=document.createElement('p');p.textContent=tr[t.kind]()+' · '+text(t.state==='REJECTED'?'Wallet declined':t.state==='VERIFIED'?'Receipt verified':t.hash?'Submitted; inspect receipt':'Unknown wallet result',t.state==='REJECTED'?'已拒签':t.state==='VERIFIED'?'回执已核验':t.hash?'已提交，请核对回执':'钱包结果待核验');if(t.hash)p.append(document.createElement('br'),txLink(t.chain,t.hash));card.append(p);
   if(t.proof?.gas){const fee=document.createElement('p');fee.textContent=text('Actual source gas: ','实际来源链 Gas：')+formatEther(t.proof.gas)+(t.chain===56?' BNB':' USDC');card.append(fee);}
   if(t.proof?.destination){const d=t.proof.destination,p=document.createElement('p');p.textContent=text('Verified arrival: ','已核验到账：')+formatUnits(d.received,t.kind==='funding'&&t.targetChain===5042?6:18)+(t.kind==='bridge'?' WOTR':t.targetChain===5042?' USDC':' BNB');p.append(document.createElement('br'),txLink(t.targetChain,d.hash));card.append(p);}
   if(o.id===order?.id&&t.state!=='REJECTED'&&!t.hash){const input=document.createElement('input');input.placeholder=text('Original transaction hash from wallet activity','从钱包活动获取原交易哈希');input.style.fontSize='14px';const button=document.createElement('button');button.textContent=text('Recover original hash','恢复原哈希');button.onclick=()=>run(async()=>{if(!hashValid(input.value.trim()))throw Error('Enter the full original transaction hash.');t.hash=input.value.trim();t.state='SUBMITTED';await persist(o);await verify();});card.append(input,button);}
   if(o.id===order?.id&&t.kind==='bridge'&&t.hash&&!t.proof?.destination){const input=document.createElement('input');input.placeholder=text('Destination hash if arrival indexing is unavailable','若到账索引不可用，填写目标交易哈希');input.style.fontSize='14px';const button=document.createElement('button');button.textContent=text('Verify destination hash','核验目标哈希');button.onclick=()=>run(async()=>{if(!hashValid(input.value.trim()))throw Error('Enter a full destination hash.');t.destinationHash=input.value.trim();await persist(o);await verify();});card.append(input,button);}
  }
  if(o.id===order?.id&&o.state==='COMPLETED'){const final=engine.results[2],p=document.createElement('p');p.textContent=text('Verified receipt: ','已核验到账：')+(o.kind==='buy'?formatEther(final?.destination.received||0)+' WOTR':formatUnits(final?.destination.received||0,6)+' USDC');card.append(p);}
  $('orders').append(card);
 }
}
async function run(action){if(working)return;working=true;render();try{await action();}catch(e){$('message').textContent=order&&!order.transactions.some(t=>t.state!=='REJECTED')&&(e.code==='SERVER_ERROR'||/502|503|504|fetch|读取|service unavailable|service temporarily/i.test(e.message))?text('Quote unavailable; this order has not submitted a transaction. Refresh the quote to retry.','报价暂不可用，此订单尚未提交交易。请点击刷新下一步报价重试。'):explain(e);quote=null;}finally{working=false;render();}}
async function verify(){if(checking)return;checking=true;render();try{await engine.verify();message(order.state==='COMPLETED'?'Exchange completed. Arrival verified.':'Original transactions verified. Continue exchange when ready.',order.state==='COMPLETED'?'兑换完成，实际到账已核验。':'原交易已核验，可以继续兑换。');await balances();}finally{checking=false;render();}}
function schedulePreview(){clearTimeout(previewTimer);if(account&&restored&&!order&&!working&&!previewing)previewTimer=setTimeout(()=>void preview(),600);}
async function preview(){
 if(!account||!restored||order||working||previewing)return;
 const version=++quoteVersion,who=account;previewing=true;render();
 try{
  const candidate=createOrder($('direction').value,who,$('amount').value.trim(),crypto.randomUUID());
  const reader=new TradeEngine({providers,api,persist:async()=>{throw Error('Preview cannot write an order.');}});reader.setOrder(candidate);
  const result=await reader.quote();
  if(version===quoteVersion&&account===who&&!order){quote=result;message('Review the estimate, then Start exchange. Keep this page open and confirm the wallet prompts.','核对预估后点击「开始兑换」。保持页面打开，按钱包弹窗确认即可。');}
 }catch(e){if(version===quoteVersion&&!order)$('message').textContent=explain(e);}
 finally{if(version===quoteVersion){previewing=false;render();}}
}
async function withOrderLock(action){
 if(!navigator.locks)throw Error('This browser must support Web Locks to prevent simultaneous signing from two tabs.');
 const id=order?.id,who=account;
 await navigator.locks.request('tevumi-source-trade:'+who.toLowerCase(),{ifAvailable:true},async lock=>{
  if(!lock)throw Error('Another tab is processing this order. Use the original tab.');
  await restore();if(account!==who)throw Error('Wallet changed. Reconnect before continuing.');
  if(id){const current=orders.find(o=>o.id===id);if(!current)throw Error('Original order unavailable. Preserve the journal.');selectOrder(current);}
  else if(active())throw Error('An unfinished order already exists. Reload to recover it.');
  await action();
 });
}
function flowStatus(status){
 const messages={quoting:['Updating the next quote…','正在自动更新下一步报价…'],wallet:['Confirm in your wallet. The next step follows after verification.','请在钱包确认，核验成功后会自动继续下一步。'],waiting:['Waiting for confirmation and arrival. Checking automatically; do not send again.','等待确认及到账，正在自动核验，请勿重复发送。'],completed:['Exchange completed. Actual arrival verified.','兑换完成，实际到账已核验。'],paused:['Further wallet requests paused. Submitted transactions will still be checked automatically.','后续钱包操作已暂停，已提交交易仍会自动核验。'],timeout:['Still awaiting confirmation. Automatic checks continue; no payment will be repeated.','仍在等待确认，将继续自动核验，不会重复付款。']};message(...messages[status]);
}
// Background recovery performs reads/proof writes only; it never requests a signature.
async function checkInBackground(){
 if(!account||!restored||!order||order.state!=='OPEN'||working||checking)return;
 if(!order.transactions.some(t=>!['VERIFIED','REJECTED'].includes(t.state))&&quote&&Date.now()-quote.at<45000)return;
 await run(async()=>withOrderLock(async()=>{
  try{await engine.verify();if(order.state==='COMPLETED'){flowStatus('completed');void balances();}else{flowStatus('paused');quote=await engine.quote();}}
  catch(e){if(waitingForProof(e))flowStatus('waiting');else throw e;}
 }));
}
async function restore(){
 const server=await api('/api/orders'+(production?'?account='+account:''));server.forEach(validateOrder);
 const raw=localStorage.getItem(cacheKey),cached=raw?JSON.parse(raw):[];if(!Array.isArray(cached))throw Error('Local journal is invalid.');cached.forEach(validateOrder);
 for(const o of cached){
  const remote=server.find(v=>v.id===o.id);
  if(!remote){if(o.transactions.length)throw Error('Local order is missing from the server. Preserve the journal for recovery.');continue;}
  if(o.revision===remote.revision+1){await api('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:stringify(o)});server[server.indexOf(remote)]=o;}
  else if(o.revision>remote.revision)throw Error('Journal revisions disagree. Preserve both copies for recovery.');
 }
 orders=server;localStorage.setItem(cacheKey,stringify(orders));restored=true;render();
}
$('connect').onclick=()=>run(async()=>{if(embedded){if(!account){document.getElementById('header-connect').click();return;}await signIn();await restore();selectOrder(active());void balances();if(order)await verify();return;}if(!production)await restore();const choice=await pickWallet(lang==='en'?'en':'zh-CN');if(!choice)return;const [who]=await choice.provider.request({method:'eth_requestAccounts'});orders=[];restored=false;selectOrder(null);useWallet(choice,who);await signIn();await restore();selectOrder(active());await balances();if(order)try{await verify();}catch(e){if(waitingForProof(e))flowStatus('waiting');else $('message').textContent=explain(e);}}).then(schedulePreview);
$('language').onclick=()=>{lang=lang==='en'?'zh-CN':'en';if(production)sessionStorage.setItem('tevumi:trade-language',lang);render();};
$('direction').onchange=()=>{clearQuote();$('amount').value=$('direction').value==='buy'?'1':'1000';render();};$('amount').oninput=clearQuote;
$('refresh').onclick=()=>run(async()=>{
 quoteVersion++;previewing=false;
 if(!order){const next=createOrder($('direction').value,account,$('amount').value.trim(),crypto.randomUUID());await persist(next);selectOrder(next);}
 const version=++quoteVersion,who=account;
 const result=await engine.quote();if(version!==quoteVersion||account!==who)return;quote=result;message('Review the quote, then Start exchange. Approvals and transfers follow through wallet prompts.','核对报价后点击「开始兑换」，按钱包弹窗确认授权与转账即可。');
});
$('send').onclick=()=>run(async()=>{
 const selected=quote;if(!selected)return;quote=null;quoteVersion++;previewing=false;
 flow=new AbortController();render();
 try{await withOrderLock(async()=>{
  if(!order){const next=createOrder($('direction').value,account,$('amount').value.trim(),crypto.randomUUID());await persist(next);selectOrder(next);}
  await continueTrade({engine,wallet,firstQuote:selected,signal:flow.signal,onQuote:q=>{quote=q;render();},onStatus:flowStatus});
  void balances();
 });}finally{flow=null;render();}
});
$('pause').onclick=()=>{flow?.abort();message('Pausing after the current wallet request or check finishes. This does not cancel submitted transactions.','当前钱包请求或核验结束后暂停；已提交交易不会撤销。');};
$('check').onclick=()=>run(async()=>{const id=order?.id;await restore();if(id)selectOrder(orders.find(o=>o.id===id));await verify();});
$('next').onclick=()=>run(async()=>{if(order)await verify();if(order&&order.state!=='COMPLETED')throw Error('Finish or recover the original order first.');selectOrder(null);$('amount').value=$('direction').value==='buy'?'1':'1000';}).then(schedulePreview);
$('cancel').onclick=()=>run(async()=>{if(order.transactions.some(t=>t.state!=='REJECTED'))throw Error('Submitted or uncertain transactions cannot be cancelled here.');order.state='CANCELLED';await persist(order);selectOrder(null);});
$('export').onclick=()=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([stringify(orders)],{type:'application/json'}));a.href=url;a.download='tevumi-source-trade-orders-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(url);};
if(embedded){
 host.querySelector('#source-reverse').onclick=()=>{if(order||working)return;$('direction').value=$('direction').value==='buy'?'sell':'buy';$('direction').dispatchEvent(new Event('change'));};
}else if(production){
 lang=sessionStorage.getItem('tevumi:trade-language')==='zh-CN'?'zh-CN':'en';
 void restoreWalletSession().then(async choice=>{if(!choice)return;useWallet(choice,choice.account);render();void balances();try{await restore();selectOrder(active());if(order)await verify();}catch(e){if(waitingForProof(e))flowStatus('waiting');else $('message').textContent=explain(e);}schedulePreview();}).catch(e=>{$('message').textContent=explain(e);});
}else restore().catch(e=>{$('message').textContent=explain(e);});render();
setInterval(()=>{if(quote&&Date.now()-quote.at>60000)$('send').disabled=true;},1000);
setInterval(()=>{if(!working&&!order&&(!quote||Date.now()-quote.at>45000))schedulePreview();},5000);
setInterval(()=>void checkInBackground(),8000);
