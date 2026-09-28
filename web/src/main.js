import { BrowserProvider, Contract, formatEther, getAddress, toQuantity } from 'ethers';
import { chains, kinds, deployment, assertContext, transactionRecord, verifyRecord } from './pilot.js';
import './style.css';
import { initBridgeConsole } from './bridge-console.js';

const $ = id => document.getElementById(id);
const storageKey = 'tevumi-pilot-deployments-v1';
let wallet, provider, account, chainId, plan, busy = false, generation = 0;
let records = [];
const disconnectKey = 'tevumi-wallet-disconnected-v1';
let disconnected = false;
try { disconnected = localStorage.getItem(disconnectKey) === 'true'; } catch {}
const walletMenu = document.createElement('dialog');
walletMenu.id = 'wallet-menu';
walletMenu.setAttribute('aria-labelledby', 'wallet-menu-title');
walletMenu.innerHTML = '<div class="modal-top"><h2 id="wallet-menu-title">钱包连接</h2><button id="wallet-menu-close" class="text-button" aria-label="关闭钱包菜单">✕</button></div><p id="wallet-menu-address"></p><p class="hint">断开本站连接会保留交易记录；钱包中的网站授权可在 OKX 钱包内管理。</p><button id="disconnect-wallet" class="button dark">断开连接</button>';
document.body.append(walletMenu);
$('wallet-menu-close').onclick = () => walletMenu.close();
$('disconnect-wallet').onclick = () => {
  if (busy) return;
  disconnected = true;
  let remembered = true;
  try { localStorage.setItem(disconnectKey, 'true'); } catch { remembered = false; }
  invalidate(); verified.clear(); account = undefined; chainId = undefined; provider = undefined;
  $('balance').textContent = '—'; walletMenu.close(); render();
  message(remembered ? '已断开本站钱包连接，交易记录已保留。' : '已断开连接；浏览器无法保存断开状态，刷新后可能恢复连接。');
};
try {
  const data = JSON.parse(localStorage.getItem(storageKey) || '[]');
  if (Array.isArray(data)) records = data.filter(r => r && Object.hasOwn(kinds, r.kind) && r.chainId === kinds[r.kind] && /^0x[0-9a-fA-F]{40}$/.test(r.account) && /^0x[0-9a-fA-F]{64}$/.test(r.txHash));
} catch { message('本地记录无法读取，请保留已有导出文件，不要重复部署。', true); }
// Restored records must be checked against a chain receipt before use.
const verified = new Set();
function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
function save() { localStorage.setItem(storageKey, JSON.stringify(records)); }
function ownRecords() { return records.filter(r => r.account.toLowerCase() === account?.toLowerCase()); }
function latest(kind) { return ownRecords().filter(r => r.kind === kind).at(-1); }
function invalidate() { generation++; plan = undefined; $('ack').checked = false; $('sign').disabled = true; if ($('review').open) $('review').close(); window.dispatchEvent(new Event('pilot-invalidate')); }
function render() {
  $('connect').setAttribute('aria-haspopup', account ? 'dialog' : 'false');
  $('disconnect-wallet').disabled = busy;
  if (!account && walletMenu.open) walletMenu.close();
  $('connect').textContent = account ? `${account.slice(0,6)}…${account.slice(-4)}` : '连接钱包 ↗';
  $('account').textContent = account || '未连接';
  $('network').textContent = chainId ? (chains[chainId]?.name ?? `不支持的网络 (${chainId})`) : '—';
  for (const kind of Object.keys(kinds)) {
    const element = $(`state-${kind}`), r = latest(kind);
    element.replaceChildren();
    if (!r) element.textContent = kind === 'PilotAdapter' ? '先部署并核验测试代币' : '未记录部署';
    else {
      const state = r.status === 'confirmed' && verified.has(r.txHash) ? '已核验部署' : r.status === 'failed' ? '交易失败，可重新估算' : r.status === 'pending' ? '已提交，等待链上确认' : '存在记录，待链上重新核验';
      element.append(document.createTextNode(`${state} · `));
      const link = document.createElement('a');
      link.href = `${chains[r.chainId].explorer}/tx/${r.txHash}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = r.address || `${r.txHash.slice(0,10)}…`; element.append(link);
    }
  }
  for (const button of document.querySelectorAll('.prepare')) button.disabled = busy || !account || (latest(button.dataset.kind) && latest(button.dataset.kind).status !== 'failed');
  for (const id of ['connect','switch-bsc','switch-arc','refresh']) $(id).disabled = busy;
  $('export').disabled = !ownRecords().length;
  const configured = ownRecords().find(r => ['PilotAdapter','PilotOFT'].includes(r.kind) && r.status !== 'failed');
  if (configured) { $('single').value = configured.single; $('total').value = configured.total; }
  $('single').disabled = busy || !!configured; $('total').disabled = busy || !!configured;
  window.dispatchEvent(new Event('pilot-render'));
}
async function action(fn) {
  if (busy) return;
  busy = true; render();
  try { await fn(); }
  catch (error) {
    if (error.code === 4001 || error.code === 'ACTION_REJECTED') message('已取消钱包操作，没有因此自动重试。');
    else message(error.message?.startsWith('钱包') || !error.code ? String(error.message).slice(0,180) : '操作未完成。请检查钱包网络、余额和交易状态后重试。', true);
  } finally { busy = false; render(); }
}
async function context() {
  if (!wallet || disconnected) throw new Error('请先连接钱包。');
  const accounts = await wallet.request({ method: 'eth_accounts' });
  if (!accounts[0]) throw new Error('钱包已断开，请重新连接。');
  return { account: getAddress(accounts[0]), chainId: Number(await wallet.request({ method: 'eth_chainId' })) };
}
async function sync() {
  invalidate();
  const seq = generation, c = await context();
  if (seq !== generation) return;
  applyWalletContext(c);
}
function applyWalletContext(c) {
  account = c.account; chainId = c.chainId;
  provider = new BrowserProvider(wallet, 'any', { cacheTimeout: -1 });
  $('balance').textContent = '读取中…'; render();
  void loadNativeBalance(provider, account, chainId);
}
async function loadNativeBalance(rpc, who, network) {
  const current = () => provider === rpc && account === who && chainId === network;
  let timer;
  try {
    const balance = await Promise.race([
      rpc.getBalance(who),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Balance timeout')), 12000); }),
    ]);
    if (current()) $('balance').textContent = `${formatEther(balance)} ${chains[network]?.symbol ?? '原生币'}`;
  } catch { if (current()) $('balance').textContent = '暂未取得，请稍后核验'; }
  finally { clearTimeout(timer); }
}
async function refresh() {
  const c = await context();
  if (c.account !== account || c.chainId !== chainId) await sync();
  const rpc = provider, seq = generation, who = account, network = chainId;
  const current = () => seq === generation && provider === rpc && account === who && chainId === network;
  for (const r of ownRecords().filter(r => r.chainId === network)) {
    const updated = await verifyRecord(r, rpc);
    if (!current()) return;
    const index = records.findIndex(x => x.txHash === r.txHash && x.chainId === r.chainId);
    records[index] = updated;
    if (updated.status === 'confirmed') verified.add(updated.txHash);
  }
  if (current()) { save(); render(); }
}
function refreshInBackground() {
  // Receipt verification is read-only; it must not keep the wallet-connect action busy.
  void refresh().catch(() => { /* Unverified records keep their existing pending-verification label. */ });
}

function attachWallet() {
  if (!window.ethereum) throw new Error('未检测到浏览器钱包。请在装有 OKX、MetaMask 或 Rabby 的浏览器打开此页面。');
  if (!wallet) {
    wallet = window.ethereum;
    const changed = () => {
      if (disconnected) return;
      invalidate(); verified.clear(); account = undefined; chainId = undefined; $('balance').textContent = '—'; render();
      message('钱包状态已变化，请点击连接钱包重新检查。');
    };
    wallet.on?.('accountsChanged', changed); wallet.on?.('chainChanged', changed); wallet.on?.('disconnect', changed);
  }
}
$('connect').onclick = () => {
  if (account) { $('wallet-menu-address').textContent = account; walletMenu.showModal(); return; }
  return action(async () => {
  invalidate(); // A manual click supersedes any slow silent restore.
  attachWallet();
  message('正在打开钱包，请在钱包中确认连接…');
  await wallet.request({ method: 'eth_requestAccounts' });
  disconnected = false; await sync();
  try { localStorage.removeItem(disconnectKey); } catch {}
  refreshInBackground();
  message('钱包已连接。检查费用不会发送交易。');
  });
};
for (const [id, target] of [['switch-bsc',56],['switch-arc',5042]]) $(id).onclick = () => action(async () => {
  if (!wallet) throw new Error('请先连接钱包。');
  invalidate(); const c = chains[target];
  try { await wallet.request({ method:'wallet_switchEthereumChain', params:[{ chainId:toQuantity(target) }] }); }
  catch (error) {
    if (error.code !== 4902) throw error;
    await wallet.request({ method:'wallet_addEthereumChain', params:[{ chainId:toQuantity(target), chainName:c.name, nativeCurrency:{ name:c.symbol,symbol:c.symbol,decimals:18 },rpcUrls:[c.rpc],blockExplorerUrls:[c.explorer] }] });
    await wallet.request({ method:'wallet_switchEthereumChain', params:[{ chainId:toQuantity(target) }] });
  }
  await sync(); refreshInBackground(); message(`已切换到 ${c.name}。`);
});
for (const id of ['single','total']) $(id).oninput = invalidate;
for (const button of document.querySelectorAll('.prepare')) button.onclick = () => action(async () => {
  invalidate(); const seq = generation;
  const kind = button.dataset.kind, c = await context();
  if (c.account !== account || c.chainId !== kinds[kind]) throw new Error(`请连接正确钱包，并切换到 ${chains[kinds[kind]].name}。`);
  const rpc = provider;
  // Restrict this first deployment workflow to an EOA; smart-account deployment differs.
  if (await rpc.getCode(account) !== '0x') throw new Error('当前版本仅支持普通 EOA 测试钱包，请使用专用测试账号。');
  const tokenRecord = latest('PilotToken');
  if (kind === 'PilotAdapter') {
    if (!tokenRecord) throw new Error('请先部署测试代币。');
    const token = await verifyRecord(tokenRecord, rpc);
    if (token.status !== 'confirmed') throw new Error('测试代币尚未确认，请先核验记录。');
    verified.add(token.txHash);
    Object.assign(tokenRecord, token); save();
  }
  if (kind !== 'PilotToken') {
    const endpoint = new Contract(chains[c.chainId].endpoint, ['function eid() view returns(uint32)','function nativeToken() view returns(address)'], rpc);
    if (Number(await endpoint.eid()) !== chains[c.chainId].eid || BigInt(await endpoint.nativeToken()) !== 0n) throw new Error('LayerZero 端点检查未通过。');
  }
  const next = await deployment(kind, account, $('single').value, $('total').value, tokenRecord?.address);
  message('正在模拟部署并估算费用…');
  const estimatedGas = await rpc.estimateGas({ from:account, data:next.data, value:0n });
  const fee = await rpc.getFeeData();
  const gasPrice = fee.maxFeePerGas ?? fee.gasPrice;
  if (!gasPrice) throw new Error('无法取得有效 Gas 报价，请稍后重试。');
  const gasLimit = (estimatedGas * 120n + 99n) / 100n;
  const feeCap = gasLimit * gasPrice;
  if (await rpc.getBalance(account) < feeCap) throw new Error('钱包手续费余额不足。请先核对预算，暂不发送交易。');
  const now = await context(); assertContext(next, now.account, now.chainId);
  if (seq !== generation) throw new Error('钱包状态已变化，请重新估算。');
  plan = { ...next, estimatedGas:String(estimatedGas), gasLimit:String(gasLimit), gasPrice:String(gasPrice), feeCap:String(feeCap), maxPriorityFeePerGas:fee.maxPriorityFeePerGas?.toString(), eip1559:fee.maxFeePerGas !== null, createdAt:Date.now() };
  const rows = [['操作',kind],['网络',`${chains[plan.chainId].name} (${plan.chainId})`],['管理员 / 测试地址',account],['额度',kind === 'PilotToken' ? '固定供应量 1,000 枚' : `单笔 ${plan.single} / 累计 ${plan.total} 枚`],['转入原生币','0（仅支付部署手续费）'],['估算 Gas',String(estimatedGas)],['含余量的费用上限',`${formatEther(feeCap)} ${chains[plan.chainId].symbol}`],['构建哈希',plan.bytecodeHash]];
  $('review-details').replaceChildren();
  for (const [key,value] of rows) { const dt=document.createElement('dt'),dd=document.createElement('dd'); dt.textContent=key;dd.textContent=value;$('review-details').append(dt,dd); }
  $('tx-data').textContent = JSON.stringify({ chainId:plan.chainId, from:plan.account, to:null, value:'0', constructorArgs:plan.args, data:plan.data },null,2);
  $('review').showModal(); message('估算完成。尚未发送交易。');
});
$('close-review').onclick = invalidate;
$('review').addEventListener('cancel', invalidate);
$('ack').onchange = () => { $('sign').disabled = !$('ack').checked || !plan || busy; };
$('sign').onclick = () => action(async () => {
  if (!plan || !$('ack').checked) throw new Error('请先核对交易。');
  const approved = plan, c = await context(); assertContext(approved,c.account,c.chainId);
  if (Date.now() - approved.createdAt > 120000) { invalidate(); throw new Error('费用预览已过期，请重新估算。'); }
  if (latest(approved.kind) && latest(approved.kind).status !== 'failed') throw new Error('该合约已有交易记录，请先核验，避免重复部署。');
  // Ensure browser storage is writable BEFORE opening the wallet.
  save(); invalidate(); message('等待你在钱包中确认…');
  const tx = { chainId:approved.chainId, from:approved.account, data:approved.data, value:0n, gasLimit:BigInt(approved.gasLimit) };
  if (approved.eip1559) { tx.maxFeePerGas=BigInt(approved.gasPrice);tx.maxPriorityFeePerGas=BigInt(approved.maxPriorityFeePerGas ?? '0'); }
  else tx.gasPrice=BigInt(approved.gasPrice);
  const signer = await provider.getSigner(approved.account);
  const current = await context(); assertContext(approved,current.account,current.chainId);
  const sent = await signer.sendTransaction(tx);
  records.push(transactionRecord(sent,approved));
  try { save(); }
  catch {
    render(); message(`交易已广播，但浏览器保存失败。请立即导出记录并保存哈希，勿重复部署：${sent.hash}`, true); return;
  }
  render();
  message(`交易已提交，尚未确认：${sent.hash}。点击“核验部署记录”更新结果。`);
  // Deliberately do not block forever waiting for a receipt; pending survives reload.
});
$('refresh').onclick = () => action(async () => { await refresh(); message('已核验当前网络的交易回执。等待中的交易不会显示为部署成功。'); });
$('export').onclick = () => {
  const output={ project:'Tevumi',version:1,exportedAt:new Date().toISOString(),account,deployments:ownRecords() };
  const url=URL.createObjectURL(new Blob([JSON.stringify(output,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='tevumi-pilot-deployments.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
initBridgeConsole({state:()=>({account,chainId,provider,busy,records:ownRecords()}),action,context,message,invalidate});
render();

export const walletSession = {state:()=>({account,chainId,provider,busy,records:ownRecords()}),action,context,message,invalidate};

// Recover wallet-granted access, never a cached address or a new permission request.
async function restoreWallet() {
  if (disconnected || wallet || busy || !window.ethereum) return;
  attachWallet();
  const seq = generation;
  let timer;
  try {
    // Silent reads do not disable the explicit connect button or precede its permission request.
    const [accounts, network] = await Promise.race([
      Promise.all([wallet.request({ method: 'eth_accounts' }), wallet.request({ method: 'eth_chainId' })]),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Wallet restore timeout')), 10000); }),
    ]);
    if (busy || seq !== generation || !accounts?.length) return;
    invalidate();
    applyWalletContext({ account:getAddress(accounts[0]), chainId:Number(network) });
    message('已恢复钱包连接。');
    refreshInBackground();
  } catch {
    if (!busy && seq === generation) message('请点击连接钱包，重新检查钱包授权。');
  } finally { clearTimeout(timer); }
}
// Run after all page modules have subscribed to session updates.
setTimeout(() => void restoreWallet(), 0);
window.addEventListener('ethereum#initialized', () => void restoreWallet());
