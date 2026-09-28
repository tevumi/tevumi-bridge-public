import {beginTiming,markTiming,timeRead,endTiming,mountTiming,timedProvider} from './flow-timing.js';
import {publicReadProvider} from './read-provider.js';
import {classifyFlowError,flowErrorReasons} from './flow-errors.js';
import { selectedAsset, assets, requirePilotAsset } from './assets.js';
import { realOperationPair, assertRealOperation } from './real-transfer.js';
import { findDelivery } from './delivery.js';
import { JsonRpcProvider, FetchRequest, formatEther, getAddress } from 'ethers';
import { chains, verifyRecord, assertContext } from './pilot.js';
import { routes } from './routes.js';
import { inspectConfiguration, transferPlan, verifyOperation, verifyDelivery, remoteChain } from './bridge.js';

export function initBridgeConsole({state,action,context:rawContext,message,invalidate}) {
  const $ = id => document.getElementById(id), key = 'tevumi-pilot-operations-v1';
  const context=()=>timeRead('钱包账号与网络',rawContext);
  let storageError=false;
  let operations = [], preview, revision = 0, fingerprint = '', snapshots;
  let progress;
  const progressNode=document.createElement('p');
  progressNode.id='flow-progress';progressNode.className='hint';progressNode.setAttribute('role','status');progressNode.setAttribute('aria-live','polite');progressNode.hidden=true;
  $('prepare-approve').parentElement.after(progressNode);
  const signProgress=document.createElement('p');
  signProgress.id='flow-sign-progress';signProgress.className='hint';signProgress.setAttribute('role','status');
  $('flow-sign').before(signProgress);
  mountTiming(progressNode.parentElement,'flow-timing');mountTiming($('flow-review'),'flow-timing-dialog');
  function stage(text) { if(progress){markTiming(text);progress.text=text;paintProgress();} }
  function paintProgress() {
    if(!progress)return;
    const seconds=Math.floor((Date.now()-progress.started)/1000);
    const text=progress.text+(seconds>=8?(' 已等待 '+seconds+' 秒；网络响应较慢，请勿重复点击。'):'');
    progressNode.hidden=false;progressNode.textContent=text;
    signProgress.textContent=progress.signing?text:'';
  }
  async function withProgress(button,label,fn,signing=false) {
    const original=button.textContent;
    const trace=beginTiming(signing?'确认到钱包':'点击到预览',selectedAsset().id,state().chainId);let outcome='ok';
    const walletProvider=state().provider;
    const debug=e=>{if(e.action==='sendEip1193Request'&&e.payload?.method==='eth_sendTransaction')markTiming('已向钱包提交 eth_sendTransaction 请求');};
    if(signing)walletProvider?.on('debug',debug);
    progress={started:Date.now(),text:signing?'正在重新核验授权或发送条件…':'正在准备预览，完成后请核对并在钱包确认。',signing};
    button.textContent=label;button.setAttribute('aria-busy','true');paintProgress();
    const timer=setInterval(paintProgress,1000);
    try { await fn();progressNode.textContent=$('message').textContent; }
    catch(error) {
      const category=classifyFlowError(error);trace.errorCode=category;
      outcome='error';markTiming(flowErrorReasons[category]);
      const rejected=category==='USER_REJECTED';
      const reason=flowErrorReasons[category];
      const text=rejected?'已取消钱包操作，没有自动重试。':error.code
        ? (progress.text+'未完成：'+reason+'。请稍后重试；若已在钱包确认，请先核验交易记录。')
        : '本次操作未完成，请查看页面提示。';
      progressNode.textContent=text;signProgress.textContent=text;
      if(category!=='VALIDATION')throw new Error(text);
      throw error;
    }
    finally {endTiming(trace,outcome);if(signing)walletProvider?.off('debug',debug);clearInterval(timer);progress=undefined;button.textContent=original;button.removeAttribute('aria-busy');}
  }
  const checked = new Set(), publicProviders = {}, scanCursors = new Map(), queryErrors = new Set();
  try { const value = JSON.parse(localStorage.getItem(key) || '[]'); if(!Array.isArray(value))throw Error(); operations = value.filter(r=>r && chains[r.chainId] && /^0x[\da-fA-F]{64}$/.test(r.txHash) && /^0x[\da-fA-F]{40}$/.test(r.account)); }
  catch { storageError=true;message('操作记录无法读取，请保留导出文件，暂不签名。',true); }
  const own = () => operations.filter(r=>r.account.toLowerCase() === state().account?.toLowerCase());
  const save = () => {if(storageError)throw Error('操作记录异常，请刷新核查后再操作。');localStorage.setItem(key,JSON.stringify(operations));};
  function cancel() { window.dispatchEvent(new CustomEvent('bridge-quote',{detail:null})); revision++; preview=undefined; $('flow-ack').checked=false; $('flow-sign').disabled=true; if ($('flow-review').open) $('flow-review').close(); }
  function deliveryRpc(id) {
    if (!chains[id].deliveryRpc) return rpc(id);
    const key = `delivery:${id}`;
    if (!publicProviders[key]) { const request = new FetchRequest(chains[id].deliveryRpc); request.timeout=15000; publicProviders[key] = new JsonRpcProvider(request,undefined,{cacheTimeout:-1}); }
    const base = rpc(id);
    return { getNetwork:()=>base.getNetwork(), getBlockNumber:()=>base.getBlockNumber(), getBlock:n=>base.getBlock(n), getTransactionReceipt:h=>base.getTransactionReceipt(h), getLogs:filter=>publicProviders[key].getLogs(filter) };
  }
  function rpc(id) {
    if (state().chainId === id) return timedProvider(state().provider,id);
    if (!publicProviders[id]) { const request = new FetchRequest(chains[id].rpc); request.timeout=15000; publicProviders[id] = publicReadProvider(new JsonRpcProvider(request,undefined,{cacheTimeout:-1,batchMaxCount:1})); }
    return timedProvider(publicProviders[id],id);
  }
  function link(parent,text,url) { const a=document.createElement('a'); a.href=url;a.textContent=text;a.target='_blank';a.rel='noopener noreferrer';parent.append(a); }
  function render() {
    const s=state(), f=`${s.account}:${s.chainId}:${selectedAsset().id}`;
    if (f !== fingerprint) { fingerprint=f; snapshots=undefined;checked.clear();scanCursors.clear();queryErrors.clear();cancel();$('route-state').textContent='钱包状态已变化，请重新核验两侧配置。';$('route-details').replaceChildren(); }
    const disabled=s.busy || !s.account || !chains[s.chainId] || storageError;
    for (const id of ['check-route','prepare-config','prepare-send','refresh-operations']) $(id).disabled=disabled;
    $('prepare-config').disabled=disabled || selectedAsset().id!=='tvpilot';
    $('prepare-approve').disabled=disabled || s.chainId !== 56;
    $('bridge-amount').disabled=s.busy;
    $('export-operations').disabled=!s.account || (!own().length && !s.records.length);
    $('flow-sign').disabled=s.busy || !preview || !$('flow-ack').checked;
    $('operations').replaceChildren();
    if (!own().length) { const p=document.createElement('p');p.className='hint';p.textContent='暂无操作记录。';$('operations').append(p); }
    for (const record of own()) {
      const row=document.createElement('div');row.className='operation';
      const p=document.createElement('p');p.className='operation-state';
      const statuses={'approval-mismatch':'实际授权额度与预览不符；请核对当前额度',pending:'已提交，等待源链确认',failed:'交易失败',confirmed:record.key==='approve'?'授权交易成功；发送前将核对当前额度':'配置交易成功（当前配置仍需核验）',sent:'源链已发送，等待目标链到账；验证与执行进度尚未核实',delivered:'目标链到账事件已核验'};
      if(record.key==='send'&&record.assetId&&record.assetId!=='tvpilot'){const old=record.chainId===5042?record.to:record.destinationAddress;if(['0x8641222880c929d1f1c124b890ed478c9c9c79b1','0xf3a3dcfb99d3e6525a1ed53377e450c4017b366e'].includes(String(old).toLowerCase())){const badge=document.createElement('span');badge.className='legacy-badge';badge.textContent='旧版测试记录';row.append(badge);}}
      p.textContent=`${assets.find(a=>a.id===(record.assetId??'tvpilot'))?.symbol??'未知资产'} · ${chains[record.chainId].name} · ${record.label} · ${checked.has(record.txHash) ? statuses[record.status] : '存在记录，待重新核验'}`;row.append(p);
      if(record.key==='send'&&checked.has(record.txHash)){const progress=document.createElement('ol');progress.className='transfer-progress';progress.setAttribute('aria-label','跨链进度');for(const [label,done]of [['已提交',true],['源链确认',['sent','delivered'].includes(record.status)],['目标链到账',record.status==='delivered']]){const item=document.createElement('li');item.textContent=(done?'✓ ':'○ ')+label;item.classList.toggle('complete',done);progress.append(item);}row.append(progress);}
      if(record.key==='send' && record.status!=='delivered' && record.status!=='failed'){const q=document.createElement('p');q.className='hint';q.textContent=queryErrors.has(record.txHash)?'查询暂时失败，将自动重试；未判定跨链失败，请勿重复发送。':'自动查询中：每 15 秒检查一次；关闭页面后暂停，重新连接后继续。';row.append(q);}
      link(row,'源链交易',`${chains[record.chainId].explorer}/tx/${record.txHash}`);
      if (record.guid && checked.has(record.txHash)) {
        const guid=document.createElement('p');guid.textContent=`消息 GUID：${record.guid}`;row.append(guid);
        link(row,'查看消息进度',`https://layerzeroscan.com/tx/${record.txHash}`);
        if (record.status === 'delivered') { row.append(document.createTextNode(' · '));link(row,'目标链交易',`${chains[record.destinationChainId].explorer}/tx/${record.destinationHash}`); }
        else {
          const label=document.createElement('label');label.textContent='目标链交易哈希';const input=document.createElement('input');input.type='text';input.placeholder='0x…';label.append(input);row.append(label);
          const button=document.createElement('button');button.className='button secondary';button.textContent='核验这笔到账';button.disabled=disabled;
          button.onclick=()=>{const hash=input.value.trim();action(async()=>{
            validateBindings(record,await verifiedPair(record.assetId??'tvpilot'));
            const source=await verifyOperation(record,rpc(record.chainId));
            const result=await verifyDelivery(source,rpc(record.destinationChainId),hash);
            Object.assign(record,result);checked.add(record.txHash);save();render();message('已核验目标链接收事件，GUID、接收地址和数量一致。');
          });};row.append(button);
        }
      }
      $('operations').append(row);
    }
  }
  async function verifiedPair(assetId=selectedAsset().id) {
    const s=state(), c=await context();
    if (c.account !== s.account || c.chainId !== s.chainId) throw new Error('钱包状态已变化，请重新连接。');
    if(assetId && assetId!=='tvpilot')return realOperationPair(assetId,rpc);
    const pair={};
    for (const kind of ['PilotToken','PilotAdapter','PilotOFT']) {
      const r=s.records.filter(r=>r.kind===kind).at(-1);
      if (!r) throw new Error('请先完成三个实验合约的部署，再核验两侧配置。');
      const verified=await verifyRecord(r,rpc(r.chainId));
      if (verified.status !== 'confirmed') throw new Error('实验合约尚未全部确认。请先核验部署记录。');
      pair[kind]=verified;
    }
    if (getAddress(pair.PilotAdapter.args[0]) !== pair.PilotToken.address) throw new Error('锁仓合约原币与测试代币不匹配。');
    if (pair.PilotAdapter.single !== pair.PilotOFT.single || pair.PilotAdapter.total !== pair.PilotOFT.total) throw new Error('两侧部署额度不一致。');
    return pair;
  }
  async function inspect(pairs) {
    try { return await inspectRoute(pairs); }
    catch (error) {
      snapshots=undefined;$('route-details').replaceChildren();
      const explanation=error.code
        ? '链上读取失败，本次核验未完成。请稍后重试；若持续失败，请检查钱包 RPC 或切换网络后重新核验。'
        : String(error.message || '配置核验失败，请重试。').replace(/https?:\/\/[^\s"')]+/g,'[RPC 地址已隐藏]').slice(0,180);
      $('route-state').textContent=explanation;$('route-state').classList.add('error');
      // Keep structured provider codes for the progress/diagnostics boundary.
      if(error.code)throw error;
      throw new Error(explanation);
    }
  }
  async function inspectRoute(pairs) {
    $('route-state').classList.remove('error');
    $('route-state').textContent='核验尚未完成，正在读取两条链。任何读取失败均不视为配置通过。';$('route-details').replaceChildren();snapshots=undefined;
    const start=revision,s=state(),pair=await (pairs?.get(selectedAsset().id)??verifiedPair()), result={};
    for (const id of [56,5042]) {
      $('route-state').textContent=`部署记录已核验，正在检查 ${chains[id].name} 的可信合约和验证配置…`;
      const mine=pair[id===56?'PilotAdapter':'PilotOFT'],peer=pair[id===56?'PilotOFT':'PilotAdapter'];
      result[id]=pair.snapshots?.[id]??await inspectConfiguration(rpc(id),id,chains[id],mine.address,peer.address,s.account,id===56?pair.PilotToken.address:mine.address,mine.single,mine.total);
    }
    const current=await context();
    if (start!==revision || current.account!==s.account || current.chainId!==s.chainId) throw new Error('钱包状态已变化，请重新核验。');
    snapshots={pair,result};$('route-details').replaceChildren();
    for (const id of [56,5042]) {
      const section=document.createElement('div'),title=document.createElement('h3');title.textContent=`${chains[id].name} · 区块 ${result[id].block}`;section.append(title);
      for (const step of result[id].steps) {const p=document.createElement('p');p.textContent=`${result[id].matches[step.key]?'✓':'待配置'} ${step.label}`;section.append(p);}
      $('route-details').append(section);
    }
    $('route-state').textContent=Object.values(result).every(r=>r.ready)?'两侧配置与实验方案一致。发送前将重新核验，尚不代表实际投递成功。':'两侧尚有配置未完成。请在对应网络逐项预览、签名并核验。';
    return snapshots;
  }
  const isUnfinished=r=>!['confirmed','delivered','failed','approval-mismatch'].includes(r.status) || (r.key==='send'&&r.status==='confirmed');
  async function refreshOperations(recordsToCheck=own()) {
    const s=state();
    const pairs=new Map();
    for (const record of recordsToCheck) {
      const assetId=record.assetId??'tvpilot';
      if(!pairs.has(assetId) && (record.key==='send'||assetId!=='tvpilot'))pairs.set(assetId,await verifiedPair(assetId));
    }
    // One fresh pair inspection per asset and action; never reuse across clicks.
    const results=[];
    for(const record of recordsToCheck){
      const assetId=record.assetId??'tvpilot';
      validateBindings(record,await pairs.get(assetId));
      const updated=await verifyOperation(record,rpc(record.chainId));
      if (updated.status==='sent' && record.destinationHash) {
        try {Object.assign(updated,await verifyDelivery(updated,rpc(record.destinationChainId),record.destinationHash));}
        catch { updated.status='sent';delete updated.destinationHash;queryErrors.add(record.txHash); }
      }
      if (updated.status==='sent') {
        try {
          const result=await findDelivery(updated,rpc(record.chainId),deliveryRpc(record.destinationChainId),scanCursors.get(record.txHash));
          scanCursors.set(record.txHash,result.cursor);Object.assign(updated,result.record);queryErrors.delete(record.txHash);
        } catch { queryErrors.add(record.txHash); }
      }
      results.push({record,updated});
    }
    if(s.account!==state().account || s.chainId!==state().chainId)throw Error('钱包状态已变化，请重新核验。');
    for(const {record,updated} of results){Object.assign(record,updated);checked.add(record.txHash);}
    save();render();return pairs;
  }
  function validateBindings(record,pair) {
    if(record.assetId && record.assetId!=='tvpilot'){assertRealOperation(record);return;}
    if(record.key!=='send')return;
    const mine=pair[record.chainId===56?'PilotAdapter':'PilotOFT'],peer=pair[record.chainId===56?'PilotOFT':'PilotAdapter'];
    if(getAddress(record.to)!==mine.address || getAddress(record.destinationAddress)!==peer.address)throw new Error('跨链记录中的合约地址与已核验部署不一致。');
  }
  async function makePlan(mode) {
    const asset=selectedAsset();if(mode==='config')requirePilotAsset();
    stage('正在核验当前资产的未完成交易…');
    const relevant=own().filter(r=>(r.assetId??'tvpilot')===asset.id);
    // Archived rows are display history, not evidence used to authorize this operation.
    // Current balances, allowance, limits, identity and route are still read below.
    const pairs=await refreshOperations(relevant.filter(isUnfinished));
    if(own().some(r=>(r.assetId??'tvpilot')!==asset.id&&r.chainId===state().chainId&&isUnfinished(r)&&r.status!=='sent'))
      throw Error('当前网络有其他资产的未完成交易，请在交易记录中核验后继续。');
    stage('正在核验两条链的合约和通道配置…');
    if (relevant.some(r=>r.status==='pending')) throw new Error('还有等待确认的操作，请核验后再继续，避免重复发送。');
    if (relevant.some(r=>r.key==='send' && r.status==='sent')) throw new Error('还有跨链消息未核验到账，请先处理该消息，不自动重发或变更配置。');
    const snapshot=await inspect(pairs),s=state(),id=s.chainId;
    if (mode==='config') {
      const next=snapshot.result[id].steps.find(step=>!snapshot.result[id].matches[step.key]);
      if (!next) throw new Error('当前链配置已完成。可切换到另一条链继续核验。');
      return {...next,mode,destinationAddress:snapshot.pair[id===56?'PilotOFT':'PilotAdapter'].address};
    }
    if (!Object.values(snapshot.result).every(r=>r.ready)) throw new Error('两侧配置尚未全部通过，不能授权或发送。');
    const mine=snapshot.pair[id===56?'PilotAdapter':'PilotOFT'];
    const peer=snapshot.pair[id===56?'PilotOFT':'PilotAdapter'];
    stage('正在核对余额、授权额度和本次数量…');
    const amount=$('bridge-amount').value.trim();
    if(asset.id!=='tvpilot' && amount!=='0.000001')throw Error('真实资产本轮仅测试 0.000001 枚。');
    return {assetId:asset.id,sourceToken:snapshot.pair.PilotToken.address,...await transferPlan(rpc(id),id,chains[id],mine.address,id===56?snapshot.pair.PilotToken.address:mine.address,s.account,amount,mode==='auto'?'auto':mode==='approve'),mode,inputAmount:amount,sourceEid:chains[id].eid,destinationEid:chains[id].remote,destinationChainId:remoteChain(id),destinationAddress:peer.address};
  }
  async function prepare(mode) {
    invalidate();const seq=revision;message('正在核验两条链和操作记录，仅读取，不发送交易…');
    const next=await makePlan(mode),s=state(),provider=timedProvider(s.provider,s.chainId);
    stage('正在估算手续费，随后显示操作预览…');
    const [estimate,fees,balance]=await Promise.all([
      provider.estimateGas({from:s.account,to:next.to,data:next.data,value:BigInt(next.value)}),
      provider.getFeeData(),provider.getBalance(s.account),
    ]),gasPrice=fees.maxFeePerGas??fees.gasPrice;
    if (!gasPrice) throw new Error('无法取得手续费报价。');
    const gasLimit=(estimate*120n+99n)/100n,feeCap=gasLimit*gasPrice;
    if (balance<feeCap+BigInt(next.value)) throw new Error('原生手续费余额不足，请先核对预算。');
    const c=await context();assertContext({account:s.account,chainId:s.chainId},c.account,c.chainId);
    if (seq!==revision) throw new Error('操作状态已变化，请重新预览。');
    preview={...next,account:s.account,gasLimit:String(gasLimit),gasPrice:String(gasPrice),feeCap:String(feeCap),priority:fees.maxPriorityFeePerGas?.toString(),eip1559:fees.maxFeePerGas!==null,createdAt:Date.now()};
    window.dispatchEvent(new CustomEvent('bridge-quote',{detail:preview}));
    $('flow-title').textContent=(mode==='auto'?(next.key==='approve'?'第 1 步：':'确认跨链：'):'')+next.label;$('flow-details').replaceChildren();
    for (const [k,v] of [['网络',chains[s.chainId].name],['钱包 / 接收者',s.account],['调用合约',next.to],['对端桥合约',next.destinationAddress],['数量',next.amount?`${formatEther(next.amount)} ${selectedAsset().symbol}`:'不转移代币'],['消息费',`${formatEther(next.value)} ${chains[s.chainId].symbol}`],['交易 Gas 上限费用',`${formatEther(feeCap)} ${chains[s.chainId].symbol}`],['合计费用上限',`${formatEther(feeCap+BigInt(next.value))} ${chains[s.chainId].symbol}`]]) {const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=v;$('flow-details').append(dt,dd);}
    $('flow-data').textContent=JSON.stringify({chainId:s.chainId,from:s.account,to:next.to,value:next.value,data:next.data,policy:routes[s.chainId],peer:next.destinationAddress},null,2);
    $('flow-review').showModal();markTiming('预览框已显示');message('预览完成，尚未发送。预览有效期为 2 分钟。');
  }
  $('check-route').onclick=()=>action(async()=>{invalidate();await inspect();message('两侧配置检查完成。');});
  for (const [id,mode] of [['prepare-config','config'],['prepare-approve','approve'],['prepare-send','send']]) $(id).onclick=()=>action(()=>withProgress($(id),mode==='approve'?'正在准备授权…':'正在准备预览…',()=>prepare(mode)));
  if(document.querySelector('.product-actions'))$('prepare-send').onclick=()=>action(()=>withProgress($('prepare-send'),'正在准备跨链…',()=>prepare('auto')));
  $('bridge-amount').oninput=cancel;
  $('flow-close').onclick=cancel;$('flow-review').addEventListener('cancel',cancel);$('flow-ack').onchange=render;
  $('flow-sign').onclick=()=>action(()=>withProgress($('flow-sign'),'正在核验…',async()=>{
    if (!preview || !$('flow-ack').checked) throw new Error('请先核对这笔操作。');
    const approved=preview,seq=revision,c=await context();assertContext(approved,c.account,c.chainId);
    if (Date.now()-approved.createdAt>120000) {cancel();throw new Error('操作预览已过期，请重新估算。');}
    const fresh=await makePlan(approved.mode);
    if (seq!==revision || fresh.assetId!==approved.assetId || fresh.to!==approved.to || fresh.data!==approved.data || fresh.value!==approved.value) {cancel();throw new Error('配置、数量或消息费用已变化，请重新估算。');}
    if(approved.assetId!=='tvpilot' && approved.mode!=='config')assertRealOperation(approved);
    const provider=timedProvider(state().provider,state().chainId);
    stage('正在复核手续费…');
    const estimate=await provider.estimateGas({from:approved.account,to:approved.to,data:approved.data,value:BigInt(approved.value)});
    if (estimate>BigInt(approved.gasLimit)) {cancel();throw new Error('Gas 需求已变化，请重新估算。');}
    save();cancel();
    stage('正在取得签名账户并复核钱包网络…');
    const signer=await timeRead('取得签名账户',()=>provider.getSigner(approved.account)),now=await context();assertContext(approved,now.account,now.chainId);
    if (Date.now()-approved.createdAt>120000) throw new Error('操作预览已过期，请重新估算。');
    const tx={chainId:approved.chainId,from:approved.account,to:approved.to,data:approved.data,value:BigInt(approved.value),gasLimit:BigInt(approved.gasLimit)};
    if (approved.eip1559) {tx.maxFeePerGas=BigInt(approved.gasPrice);tx.maxPriorityFeePerGas=BigInt(approved.priority??'0');} else tx.gasPrice=BigInt(approved.gasPrice);
    stage('正在调用钱包，请查看钱包弹窗…');
    const sent=await timeRead('钱包发送调用到返回（含用户确认及广播）',()=>signer.sendTransaction(tx));
    markTiming('钱包发送调用已返回');
    operations.push({...approved,txHash:sent.hash,status:'pending',submittedAt:new Date().toISOString()});
    checked.add(sent.hash);
    try{save();}catch{render();message(`交易已广播但记录保存失败，请立即导出全部记录并保存哈希：${sent.hash}`,true);return;}
    snapshots=undefined;$('route-state').textContent='操作已提交，配置需重新核验。';render();message(`操作已提交，等待确认：${sent.hash}。请点击核验操作与到账记录。`);
    if(approved.mode==='auto'&&approved.key==='approve'){
      const continuation=revision,record=operations.at(-1);
      $('flow-title').textContent='等待授权确认';$('flow-details').replaceChildren();$('flow-data').textContent='';
      $('flow-review').showModal();stage('授权已提交，正在等待链上确认；关闭窗口可停止后续准备。');
      for(let attempt=0;attempt<30;attempt++){
        if(continuation!==revision)return;
        const wallet=await context();assertContext(approved,wallet.account,wallet.chainId);
        const result=await verifyOperation(record,rpc(approved.chainId));
        if(continuation!==revision)return;
        Object.assign(record,result);save();render();
        if(result.status!=='pending'){
          if(result.status!=='confirmed')throw Error('授权未按预览成功完成，请核验交易记录后继续。');
          if(selectedAsset().id!==approved.assetId||$('bridge-amount').value.trim()!==approved.inputAmount)throw Error('资产或数量已变化，请重新开始。');
          stage('授权已确认，正在准备跨链费用…');
          await prepare('auto');message('授权已确认。请核对跨链费用，再在钱包确认跨链交易。');return;
        }
        await new Promise(resolve=>setTimeout(resolve,2000));
      }
      cancel();message('授权仍在等待确认，交易记录已保留。稍后点击“授权并跨链”可继续，请勿重复授权。');
    }
  },true));
  $('refresh-operations').onclick=()=>action(async()=>{cancel();await refreshOperations();message('操作记录已按链上回执更新。源链发送成功不等于到账。');});
  $('export-operations').onclick=()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify({project:'Tevumi',version:2,exportedAt:new Date().toISOString(),account:state().account,deployments:state().records,operations:own()},null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='tevumi-pilot-all-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $('route-policy').textContent=JSON.stringify({verifiedSnapshot:'2026-09-18',requiredOperators:['Canary','P2P'],receiveGas:200000,chains:routes},null,2);
  // Reuse the action mutex: no concurrent wallet work, no background signing.
  setInterval(()=>{
    if(!state().account || state().busy || preview || document.hidden || $('operations').contains(document.activeElement))return;
    const waiting=own().filter(r=>r.key==='send' && isUnfinished(r));
    if(!waiting.length)return;
    action(async()=>{try{await refreshOperations(waiting);}catch{for(const r of waiting)queryErrors.add(r.txHash);render();}});
  },15000);
  window.addEventListener('storage',e=>{if(e.key===key){storageError=true;cancel();message('另一页面修改了操作记录，请刷新后核验。',true);render();}});
  window.addEventListener('pilot-invalidate',cancel);window.addEventListener('pilot-render',render);render();
}
