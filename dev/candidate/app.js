import '../../web/src/style.css';
import './style.css';
export function mountCandidate({ids={},onRender=()=>{},onControls=()=>{},onPreview=()=>{},wallet}={}){
const $=id=>document.getElementById(ids[id]??id);let token,state,preview,busy=false;
const intent=()=>({asset:$('asset').value,account:Number($('account').value),side:$('side').value,amount:$('amount').value});
function controls(){for(const id of ['prepare','refresh','faults','reset','asset','account','side','amount'])$(id).disabled=busy||!state;$('confirm').disabled=busy||!preview||!$('ack').checked;$('cancel').disabled=busy;for(const b of document.querySelectorAll('[data-retry]'))b.disabled=busy;onControls(busy||!state);}
function close(){preview=null;onPreview(null);$('review').close();$('ack').checked=false;controls();}
function render(){
 const a=state.assets.find(a=>a.id===$('asset').value),b=a.balances[Number($('account').value)];
 $('balances').textContent=`BSC 余额 ${b.bsc} · Arc 余额 ${b.arc} · 剩余授权 ${b.allowance} ${a.symbol}`;
 $('accounting').textContent=`${a.symbol}：锁仓本金 ${a.principal} · Arc 总供应量 ${a.supply}`;
 $('addresses').textContent=JSON.stringify({模拟链:state.chains,账户:state.accounts[Number($('account').value)],Adapter:a.adapter,OFT:a.oft},null,2);
 $('session').textContent='模拟环境 '+state.sessionId.slice(0,8);$('pause-receive').checked=state.faults.pauseReceive;$('fail-send').checked=state.faults.failSend;
 $('records').replaceChildren();
 for(const r of [...state.records].reverse()){
  const div=document.createElement('div');div.className='operation';div.dataset.account=String(r.account);
  const text=document.createElement('p');text.textContent=`${r.asset==='cat'?'CAT':'币安人生'} · 账户 ${r.account===0?'A':'B'} · ${r.side==='bsc'?'BSC → Arc':'Arc → BSC'} · ${r.amount} · ${r.status==='received'?'目标链到账事件已核验':'源链已确认，等待目标到账'}`;div.append(text);
  const detail=document.createElement('pre');detail.textContent=`源交易：${r.sourceHash}\nGUID：${r.guid}${r.destinationHash?'\n目标交易：'+r.destinationHash:''}${r.error?'\n'+r.error:''}`;div.append(detail);
  if(r.status==='pending'){const button=document.createElement('button');button.className='button secondary';button.textContent='投递 / 重试原消息';button.dataset.retry=r.id;button.onclick=()=>work(async()=>{await api('retry',{id:r.id});$('message').textContent='已核验投递结果，请查看记录。';});div.append(button);}
  $('records').append(div);
 }
 onRender(state,intent());controls();
}
async function api(path,input){const r=await fetch('/__candidate/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Candidate-Token':token},body:JSON.stringify(input)});const data=await r.json();if(!r.ok)throw new Error(data.error);if(data.state){state=data.state;render();}return data.result;}
async function refresh(){const r=await fetch('/__candidate/state');const data=await r.json();if(!r.ok)throw new Error(data.error);token=data.token;state=data;render();if(wallet)await wallet.recover(state,api);}
async function work(fn){if(busy)return;busy=true;controls();try{await fn();}catch(e){$('message').textContent=e instanceof TypeError?'本地服务连接失败，请刷新状态核验记录后重试。':e.message;try{await refresh();}catch{}close();}finally{busy=false;controls();}}
function show(p){preview=p;onPreview(p);$('review-title').textContent=p.key==='approve'?'确认精确授权':'确认跨链发送';$('review-details').textContent=`${p.intent.asset==='cat'?'CAT':'币安人生'} · ${p.intent.amount}\n${p.intent.side==='bsc'?'BSC 模拟链 → Arc 模拟链':'Arc 模拟链 → BSC 模拟链'}\n模拟账户 / 收款人：${p.recipient}\n调用合约：${p.to}\nGas 费用上限：${p.feeCap} 模拟原生币`;$('ack').checked=false;if(!$('review').open)$('review').showModal();controls();}
$('prepare').onclick=()=>work(async()=>{const seq=wallet?await wallet.assertContext(intent(),state):null;const next=await api('preview',intent());if(wallet&&seq!==await wallet.assertContext(next.intent,state))throw new Error('钱包状态已变化，请重新预览。');show(next);$('message').textContent='预览就绪，尚未发送交易。';});
$('confirm').onclick=()=>work(async()=>{const p=preview;preview=null;const r=wallet?await wallet.confirm(p,state,api,$('auto-deliver').checked):await api('confirm',{id:p.id,autoDeliver:$('auto-deliver').checked});if(r.kind==='approve'){show(r.next);$('message').textContent='授权已确认。请核对下一步跨链发送。';}else{close();$('message').textContent='源交易已提交，请查看到账记录。';}});
$('ack').onchange=controls;$('cancel').onclick=()=>{close();$('message').textContent='已取消预览，未提交这笔操作。';};
$('review').addEventListener('cancel',event=>{event.preventDefault();if(!busy)$('cancel').click();});
for(const id of ['asset','account','side','amount'])$(id).addEventListener('input',()=>{close();if(state)render();});
$('refresh').onclick=()=>work(refresh);
$('faults').onclick=()=>work(async()=>{close();await api('faults',{pauseReceive:$('pause-receive').checked,failSend:$('fail-send').checked});$('message').textContent='本地模拟条件已更新。';});
$('reset').onclick=()=>work(async()=>{close();await api('reset',{});await refresh();$('message').textContent='已重建本地环境，账户各有 100 枚模拟币。';});
work(async()=>{await refresh();$('message').textContent='本地环境就绪，无需连接真实钱包。';});
return {invalidate:close,refresh:()=>work(refresh)};

}
if(document.getElementById('prepare'))mountCandidate();
