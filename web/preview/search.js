import { amountValidation, bridgeView, selectAmount, selectAsset, selectDirection } from '../immediate-deploy/live.js';
import { formatEther } from 'ethers';
import './history.js';

// Public asset catalog. Historical routes remain in the controller for receipt recovery.
const assets = [
  { key: 'wotr', name: 'WOTR', aliases: 'Wobble Otter 水獭', route: 'BNB Chain ↔ Arc', status: '按链上状态' },
];
const input = document.querySelector('#asset-search');
const list = document.querySelector('#asset-options');
const empty = document.querySelector('#asset-empty');
const selectedName = document.querySelector('#selected-name');
const amountInput = document.querySelector('#send-amount');
amountInput.addEventListener('input', () => {
  try { selectAmount(amountInput.value); }
  catch (error) { document.querySelector('#message').textContent = String(error?.message ?? error); }
});
let selected = assets[0];
let highlighted = -1;
let side = 'bsc';

for (const asset of assets) {
  const option = document.createElement('li');
  option.id = `asset-option-${asset.key}`;
  option.setAttribute('role', 'option');
  option.setAttribute('tabindex', '-1');
  option.setAttribute('aria-selected', String(asset === selected));
  option.dataset.key = asset.key;
  option.dataset.search = `${asset.name} ${asset.aliases} ${asset.route}`.toLocaleLowerCase();
  for (const [className, value] of [['asset-name', asset.name], ['asset-route', asset.route], ['asset-status', asset.status]]) {
    const span = document.createElement('span'); span.className = className; span.textContent = value; option.append(span);
  }
  option.addEventListener('click', () => { void select(asset); });
  option.addEventListener('mouseenter', () => setHighlight(visibleOptions().indexOf(option)));
  list.insertBefore(option, empty);
}
const options = [...list.querySelectorAll('[role="option"]')];
function visibleOptions() { return options.filter(option => !option.hidden); }
function setHighlight(index) {
  const visible = visibleOptions();
  highlighted = index < 0 || !visible.length ? -1 : index % visible.length;
  for (const option of options) option.classList.toggle('highlighted', visible[highlighted] === option);
  if (highlighted >= 0) {
    input.setAttribute('aria-activedescendant', visible[highlighted].id);
    visible[highlighted].scrollIntoView({ block: 'nearest' });
  } else input.removeAttribute('aria-activedescendant');
}
function filter() {
  const query = input.value.trim().toLocaleLowerCase();
  for (const option of options) option.hidden = !option.dataset.search.includes(query);
  empty.hidden = visibleOptions().length !== 0;
  setHighlight(-1);
}
function open() { list.hidden = false; input.setAttribute('aria-expanded', 'true'); filter(); }
function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); setHighlight(-1); }
async function select(asset) {
  try { await selectAsset(asset.key); }
  catch (error) { document.querySelector('#message').textContent = String(error?.message ?? error); return; }
  selected = asset;
  selectedName.textContent = asset.name;
  for (const option of options) option.setAttribute('aria-selected', String(option.dataset.key === asset.key));
  input.value = '';
  close();
  updateView();
}
export async function chooseAsset(key) {
  const asset = assets.find(item => item.key === key);
  if (!asset) throw Error('Unknown bridge asset.');
  await select(asset);
}
input.addEventListener('focus', open);
input.addEventListener('click', open);
input.addEventListener('input', () => {
  open();
  updateView();
});
input.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); if (list.hidden) open();
    const visibleCount = visibleOptions().length;
    if (visibleCount) setHighlight(highlighted < 0 ? (event.key === 'ArrowDown' ? 0 : visibleCount - 1) : (highlighted + (event.key === 'ArrowDown' ? 1 : visibleCount - 1)) % visibleCount);
  } else if (event.key === 'Enter' && !list.hidden && highlighted >= 0) {
    event.preventDefault();
    void select(assets.find(asset => asset.key === visibleOptions()[highlighted].dataset.key));
  } else if (event.key === 'Escape') { close(); input.blur(); }
});
document.addEventListener('pointerdown', event => { if (!event.target.closest('.asset-combobox')) close(); });
async function chooseDirection(next) {
  const previous = side;
  side = next; updateView();
  try { await selectDirection(next); }
  catch (error) { side = previous; updateView(); document.querySelector('#message').textContent = String(error?.message ?? error); }
}
export { chooseDirection };
document.querySelector('#direction-bsc').addEventListener('click', () => { void chooseDirection('bsc'); });
document.querySelector('#direction-arc').addEventListener('click', () => { void chooseDirection('arc'); });
function updateView() {
  const { account, records, busy, amount, limitLD, routeReady, routePaused } = bridgeView();
  if (amountInput.value !== amount) amountInput.value = amount;
  amountInput.disabled = busy;
  const amountError = amountValidation();
  amountInput.setAttribute('aria-invalid', String(Boolean(amountError)));
  document.querySelector('#amount-note').textContent = amountError || (limitLD === null ? '正在读取当前单笔限额…' : `当前单笔上限 ${formatEther(limitLD)} 枚；发送前会复核可用额度。`);
  const source = records[`send-${side}`];
  const unknownKind = source?.unknown ? `send-${side}` : side === 'bsc' && !source?.hash && records['approve-bsc']?.unknown ? 'approve-bsc' : null;
  const searching = Boolean(input.value.trim());
  for (const item of ['bsc', 'arc']) {
    const button = document.querySelector(`#direction-${item}`);
    button.classList.toggle('active', item === side);
    button.setAttribute('aria-pressed', String(item === side));
  }
  const buttons = ['connect', 'send-bsc', 'send-arc', 'check-arc', 'check-bsc'];
  for (const id of buttons) document.querySelector(`#${id}`).hidden = true;
  let action = !account ? 'connect' : side === 'bsc' ? 'send-bsc' : 'send-arc';
  if (account && source?.hash && !source.deliveredHash) action = side === 'bsc' ? 'check-arc' : 'check-bsc';
  if (account && unknownKind) action = null;
  if (action) {
    const button = document.querySelector(`#${action}`);
    button.hidden = false;
    button.disabled = busy || searching || (action.startsWith('send-') && (Boolean(amountError) || !routeReady || routePaused));
  }
  document.querySelector('#send-bsc').textContent = source?.deliveredHash ? '再次跨链' : '授权并跨链';
  document.querySelector('#send-arc').textContent = source?.deliveredHash ? '再次跨链' : '开始跨链';
  document.querySelector('#approval-note').hidden = side !== 'bsc';
  const summary = document.querySelector('#status-summary');
  if (unknownKind) summary.textContent = '正在核对上一笔交易，请勿重复发起。核对完成后页面会自动更新。';
  else if (source?.deliveredHash) summary.textContent = `已到账目标链。可以在交易记录中查看哈希，或发起下一笔。`;
  else if (source?.hash) summary.textContent = '来源链交易已提交，正在自动核验目标链到账。请勿重复发送。';
  else if (searching) summary.textContent = '请选择搜索结果后继续。';
  else if (routePaused) summary.textContent = '当前方向的桥仍暂停，暂不能发送。桥管理钱包开放后请刷新页面。';
  else summary.textContent = account ? '已连接钱包。核对资产和数量后开始跨链。' : '选择资产和方向，连接钱包后即可开始。';
  document.querySelector('#step-prepare').classList.toggle('active', !source?.hash);
  document.querySelector('#step-source').classList.toggle('active', Boolean(source?.hash && !source.deliveredHash));
  document.querySelector('#step-destination').classList.toggle('active', Boolean(source?.deliveredHash));
}
window.addEventListener('tevumi:bridge-view', updateView);
updateView();
