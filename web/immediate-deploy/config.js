import { BrowserProvider, Contract, Interface, getAddress, keccak256, zeroPadValue } from 'ethers';
import { hasRpc, rpc } from './rpc.js';

const $ = id => document.getElementById(id);
const storageKey = 'tevumi-immediate-beta-config-v1';
const abi = ['function executeBatch(address[] targets,bytes[] payloads)'];
const iface = new Interface(abi);
let plan, provider, account, records = {}, busy = false;

function note(message) { $('message').textContent = message; }
function save() { localStorage.setItem(storageKey, JSON.stringify(records)); }
function render() {
  $('wallet-state').textContent = account ? `已连接：${account}` : '尚未连接钱包。';
  $('configure-all').disabled = busy || !account;
  $('refresh').disabled = busy || !account;
  for (const button of document.querySelectorAll('.recover')) button.disabled = busy || !account;
}
function validate(item) {
  if (getAddress(item.transaction.to) !== getAddress(item.admin) || getAddress(item.account) !== getAddress(plan.account) || item.transaction.value !== '0' || keccak256(item.transaction.data) !== item.calldataHash || !hasRpc(item.chainId)) throw Error('配置计划校验失败。');
  const decoded = iface.decodeFunctionData('executeBatch', item.transaction.data);
  if (decoded[0].length !== 12 || decoded[1].length !== 12 || item.stepCount !== 12) throw Error('配置批次不完整。');
}
function selected() {
  if (!provider || !account || getAddress(account) !== getAddress(plan.account)) throw Error('请连接指定部署钱包。');
  return provider;
}
async function switchTo(item) {
  const target = '0x' + item.chainId.toString(16);
  if ((await window.ethereum.request({ method: 'eth_chainId' })).toLowerCase() !== target) await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target }] });
  provider = new BrowserProvider(window.ethereum, undefined, { cacheTimeout: 0 });
}
async function onChain(item) {
  const p = selected();
  if (Number((await p.getNetwork()).chainId) !== item.chainId) throw Error('钱包网络与本笔配置不符。');
  if ((await p.getCode(item.admin)) === '0x') throw Error('新管理合约尚未部署。请先完成部署页六笔交易。');
  const admin = new Contract(item.admin, ['function owner() view returns(address)'], p);
  if (getAddress(await admin.owner()) !== getAddress(item.account)) throw Error('新管理合约所属钱包不符。');
  const remoteEid = item.chainId === 56 ? 30417 : 30102;
  let peersSet = 0;
  const endpoint = new Contract(item.endpoint, ['function delegates(address) view returns(address)'], p);
  for (const [assetId, address] of Object.entries(item.apps)) {
    if ((await p.getCode(address)) === '0x') throw Error('新业务合约尚未全部部署。');
    const app = new Contract(address, ['function owner() view returns(address)', 'function peers(uint32) view returns(bytes32)', 'function receivesPaused() view returns(bool)', item.chainId === 56 ? 'function depositsPaused() view returns(bool)' : 'function sendsPaused() view returns(bool)'], p);
    const [owner, peer, receivesPaused, sendsPaused, delegate] = await Promise.all([app.owner(), app.peers(remoteEid), app.receivesPaused(), item.chainId === 56 ? app.depositsPaused() : app.sendsPaused(), endpoint.delegates(address)]);
    if (getAddress(owner) !== getAddress(item.admin) || getAddress(delegate) !== getAddress(item.admin) || !receivesPaused || !sendsPaused) throw Error('业务合约身份、delegate 或暂停状态不符。');
    if (peer !== '0x' + '00'.repeat(32)) {
      if (peer.toLowerCase() !== zeroPadValue(item.remoteApps[assetId], 32).toLowerCase()) throw Error('链上 peer 与替代版本计划不符。');
      peersSet++;
    }
  }
  const record = records[item.side];
  if (record?.hash) {
    const [sent, receipt] = await Promise.all([p.getTransaction(record.hash), p.getTransactionReceipt(record.hash)]);
    if (!sent || !receipt) return { state: 'pending', label: '原哈希待确认；不要重复提交。' };
    if (receipt.status !== 1 || getAddress(sent.from) !== getAddress(item.account) || getAddress(sent.to) !== getAddress(item.admin) || keccak256(sent.data) !== item.calldataHash || peersSet !== 2) throw Error('原交易或配置后状态不匹配。');
    return { state: 'configured', label: `配置交易已成功：${record.hash}；业务合约仍暂停。` };
  }
  if (record?.unknown || peersSet > 0) return { state: 'unknown', label: '配置状态或原广播结果不明；请按原哈希恢复，不要重复提交。' };
  return { state: 'ready', label: '新合约已部署并暂停，等待钱包签署即时配置。' };
}
async function quote(item) {
  const tx = item.transaction, chainId = item.chainId;
  const [network, nonce, estimated, price, balance] = await Promise.all([
    rpc(chainId, 'eth_chainId', []), rpc(chainId, 'eth_getTransactionCount', [item.account, 'pending']),
    rpc(chainId, 'eth_estimateGas', [{ from: item.account, to: tx.to, data: tx.data, value: '0x0' }]),
    rpc(chainId, 'eth_gasPrice', []), rpc(chainId, 'eth_getBalance', [item.account, 'latest']),
  ]);
  const walletNonce = await selected().getTransactionCount(item.account, 'pending');
  if (BigInt(network) !== BigInt(chainId) || BigInt(nonce) !== BigInt(walletNonce)) throw Error('网络或 pending nonce 在两个 RPC 间不一致。');
  const gas = BigInt(estimated) * 120n / 100n + 1n, gasPrice = BigInt(price);
  if (gas < 21000n || gas > 3000000n || gasPrice <= 0n) throw Error('配置 Gas 报价异常。');
  let maximumPrice = gasPrice;
  const request = { from: item.account, to: tx.to, data: tx.data, value: '0x0', nonce: '0x' + BigInt(nonce).toString(16), chainId: '0x' + chainId.toString(16), gas: '0x' + gas.toString(16) };
  if (chainId === 56) request.gasPrice = '0x' + gasPrice.toString(16);
  else {
    const [block, priority] = await Promise.all([rpc(chainId, 'eth_getBlockByNumber', ['latest', false]), rpc(chainId, 'eth_maxPriorityFeePerGas', [])]);
    if (typeof block.baseFeePerGas !== 'string') throw Error('Arc 基础费报价不可用。');
    const tip = BigInt(priority); maximumPrice = BigInt(block.baseFeePerGas) * 2n + tip;
    if (tip <= 0n || maximumPrice < gasPrice) throw Error('Arc 费用报价异常。');
    request.maxPriorityFeePerGas = '0x' + tip.toString(16); request.maxFeePerGas = '0x' + maximumPrice.toString(16);
  }
  if (BigInt(balance) < gas * maximumPrice) throw Error('钱包余额不足以覆盖本笔最高网络费用。');
  return request;
}
async function configure(item) {
  validate(item); await switchTo(item);
  const before = await onChain(item); if (before.state !== 'ready') return before;
  note(`正在核对 ${item.side.toUpperCase()} 配置的 nonce、Gas 报价和余额；此时尚未请求钱包签名。`);
  const request = await quote(item);
  const active = await window.ethereum.request({ method: 'eth_accounts' });
  if (!active?.length || getAddress(active[0]) !== getAddress(plan.account)) throw Error('签名前钱包账户已变化。');
  records[item.side] = { unknown: true }; save();
  note(`正在请求钱包配置 ${item.side.toUpperCase()}…`);
  let hash;
  try { hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [request] }); }
  catch (error) { if (error?.code === 4001) { delete records[item.side]; save(); throw Error('已在钱包拒绝；未提交配置。'); } throw Error('钱包结果不明。请按原哈希恢复，不要重复提交。'); }
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw Error('钱包未返回有效哈希。请按未知广播处理。');
  records[item.side] = { hash }; save();
  note(`正在等待 ${item.side.toUpperCase()} 配置回执…`);
  const receipt = await provider.waitForTransaction(hash, 1, 180000);
  if (!receipt) throw Error('回执等待超时。原哈希已保存，请稍后继续核验。');
  const after = await onChain(item);
  if (after.state !== 'configured') throw Error('回执或配置状态未通过核验，停止后续操作。');
  $('state-' + item.side).textContent = after.label;
  return after;
}
async function begin() {
  selected(); busy = true; render();
  try {
    for (const item of plan.batches) {
      await switchTo(item);
      const state = await onChain(item);
      if (state.state === 'configured') { $('state-' + item.side).textContent = state.label; continue; }
      if (state.state !== 'ready') throw Error(`${item.side}：${state.label}`);
      await configure(item);
    }
    note('双链配置交易已核验；业务合约仍暂停，跨链交易尚未开放。');
  } finally { busy = false; render(); }
}
async function recover(item) {
  selected(); await switchTo(item);
  const hash = $('hash-' + item.side).value.trim();
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw Error('请输入完整交易哈希。');
  const [sent, receipt] = await Promise.all([provider.getTransaction(hash), provider.getTransactionReceipt(hash)]);
  if (!sent || !receipt) throw Error('原交易尚未查到回执。');
  if (receipt.status !== 1 || getAddress(sent.from) !== getAddress(item.account) || getAddress(sent.to) !== getAddress(item.admin) || keccak256(sent.data) !== item.calldataHash) throw Error('原交易与配置计划不匹配。');
  records[item.side] = { hash }; save();
  const state = await onChain(item);
  if (state.state !== 'configured') throw Error('链上配置尚未核验通过。');
  $('state-' + item.side).textContent = state.label;
  note(`${item.side.toUpperCase()} 已按原哈希恢复。`);
}
async function connect() {
  if (!window.ethereum) throw Error('未找到浏览器钱包扩展。');
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }); account = getAddress(accounts[0]);
  if (account !== getAddress(plan.account)) { account = undefined; render(); throw Error('请使用指定部署钱包。'); }
  provider = new BrowserProvider(window.ethereum, undefined, { cacheTimeout: 0 }); render(); note('已连接。六份新合约部署完成后，可开始即时配置。');
}
function draw() {
  $('summary').innerHTML = `<dt>发布 ID</dt><dd>${plan.releaseId}</dd><dt>指定账户</dt><dd class="mono">${plan.account}</dd><dt>配置规模</dt><dd>每链 12 项，2 笔即时交易</dd><dt>配置延时</dt><dd>无；成功回执后立即生效，业务仍暂停</dd>`;
  for (const item of plan.batches) {
    validate(item);
    const section = document.createElement('article'); section.className = 'step';
    const title = document.createElement('h3'); title.textContent = `${item.side === 'bsc' ? 'BNB Chain' : 'Arc'} · Chain ID ${item.chainId}`; section.append(title);
    for (const value of [`管理合约：${item.admin}`, `配置项：${item.stepCount}`, `调用数据 Keccak-256：${item.calldataHash}`]) { const p = document.createElement('p'); p.textContent = value; section.append(p); }
    const status = document.createElement('p'); status.id = 'state-' + item.side; status.textContent = '尚未核验'; section.append(status);
    const input = document.createElement('input'); input.id = 'hash-' + item.side; input.placeholder = '已有交易哈希 0x…'; input.setAttribute('aria-label', item.side + ' 原交易哈希'); section.append(input);
    const button = document.createElement('button'); button.className = 'recover secondary'; button.textContent = '按原哈希恢复'; button.onclick = () => run(() => recover(item)); section.append(button);
    $('steps').append(section);
  }
  render();
}
async function run(action) { try { await action(); } catch (error) { note(error?.message || '操作未完成。'); } }
async function start() {
  try { records = JSON.parse(localStorage.getItem(storageKey) || '{}'); if (!records || typeof records !== 'object' || Array.isArray(records)) throw Error(); } catch { throw Error('浏览器交易记录不可读，停止签名。'); }
  const response = await fetch('./config-plan.json', { cache: 'no-store' }); if (!response.ok) throw Error('配置计划加载失败。');
  plan = await response.json(); if (plan.state !== 'UNSIGNED_IMMEDIATE_CONFIG' || plan.batches.length !== 2) throw Error('配置计划不完整。'); draw();
}
$('connect').onclick = () => run(connect);
$('configure-all').onclick = () => run(begin);
$('refresh').onclick = () => run(async () => { busy = true; render(); try { for (const item of plan.batches) { await switchTo(item); $('state-' + item.side).textContent = (await onChain(item)).label; } note('双链状态已重新核验。'); } finally { busy = false; render(); } });
start().catch(error => note(error.message));
