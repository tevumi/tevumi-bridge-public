import { bridgeView } from '../immediate-deploy/live.js';
import { formatEther } from 'ethers';
import { currentLanguage } from './locale.js';

const panel = document.querySelector('#history-panel');
const list = document.querySelector('#history-list');
const more = document.querySelector('#history-more');
let shownAccount = null;
let page = 0;
let loading = false;
let items = [];
const explorers = { 56: 'https://bscscan.com/tx/', 5042: 'https://explorer.arc.io/tx/' };
const chainNames = { 56: 'BNB Chain', 5042: 'Arc' };
const validHash = hash => /^0x[0-9a-f]{64}$/i.test(hash || '');
const labels = {
  en: { arrived: 'Arrived', in_transit: 'In transit', pending: 'Confirming', failed: 'Send failed', unknown: 'Status pending verification', amountFailed: 'Amount unverified', amountPending: 'Amount pending confirmation', amountUnknown: 'Amount pending verification', source: 'View source transaction', target: 'View destination transaction', unit: 'tokens', empty: 'No transfer history for this wallet yet.' },
  'zh-CN': { arrived: '已到账', in_transit: '跨链中', pending: '确认中', failed: '发送失败', unknown: '状态待核验', amountFailed: '数量未核验', amountPending: '数量待确认', amountUnknown: '数量待核验', source: '查看发送交易', target: '查看到账交易', unit: '枚', empty: '这个钱包暂无跨链记录。' },
};
const copy = () => labels[currentLanguage()];

function link(label, chain, hash) {
  const a = document.createElement('a');
  a.href = explorers[chain] + hash;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = `${label} ↗`;
  return a;
}

function card(item) {
  const text = copy();
  const node = document.createElement('article');
  node.className = 'history-card';
  const top = document.createElement('div');
  top.className = 'history-card-top';
  const route = document.createElement('strong');
  route.textContent = `${item.asset === 'cat' ? 'CAT' : '币安人生'} · ${chainNames[item.chain]} → ${chainNames[item.target_chain]}`;
  const state = document.createElement('span');
  state.className = `history-status history-${item.status}`;
  state.textContent = text[item.status] || text.unknown;
  top.append(route, state);
  const meta = document.createElement('p');
  const quantity = item.status === 'failed' ? text.amountFailed : item.status === 'pending' ? text.amountPending : /^\d+$/.test(item.amount_ld || '') ? `${formatEther(BigInt(item.amount_ld))} ${text.unit}` : text.amountUnknown;
  meta.textContent = `${quantity} · ${new Date(item.created_at * 1000).toLocaleString(currentLanguage(), { hour12: false })}`;
  const actions = document.createElement('div');
  actions.className = 'history-links';
  if (validHash(item.source_hash)) actions.append(link(text.source, item.chain, item.source_hash));
  if (validHash(item.target_hash)) actions.append(link(text.target, item.target_chain, item.target_hash));
  node.append(top, meta, actions);
  return node;
}

function renderCards() {
  list.replaceChildren(...items.map(card));
  if (!items.length) list.textContent = copy().empty;
}

async function load(reset = false) {
  const account = bridgeView().account?.toLowerCase();
  if (!panel.open || !account || loading) return;
  if (reset || shownAccount !== account) {
    page = 0;
    items = [];
    shownAccount = account;
    list.textContent = '正在加载跨链记录…';
    more.hidden = true;
  }
  loading = true;
  const requestedPage = page;
  try {
    const response = await fetch(`/api/transfers?account=${encodeURIComponent(account)}&page=${requestedPage}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw Error('记录服务暂不可用');
    const data = await response.json();
    if (bridgeView().account?.toLowerCase() !== account) return;
    if (requestedPage === 0) items = [];
    items.push(...data.items);
    renderCards();
    more.hidden = !data.more;
    page = requestedPage + 1;
  } catch {
    if (requestedPage === 0) list.textContent = '记录暂时无法加载，请稍后重新展开。';
    else more.textContent = '重试加载';
  } finally { loading = false; }
}

panel.addEventListener('toggle', () => { if (panel.open) void load(true); });
more.addEventListener('click', () => { void load(); });
window.addEventListener('tevumi:bridge-view', () => {
  const account = bridgeView().account?.toLowerCase();
  if (account !== shownAccount) {
    shownAccount = null;
    items = [];
    list.textContent = account ? '展开后查看跨链记录。' : '连接钱包后查看跨链记录。';
    more.hidden = true;
    if (panel.open && account) void load(true);
  }
});
window.addEventListener('tevumi:history-changed', () => { if (panel.open) void load(true); });
window.addEventListener('tevumi:locale-change', () => { if (panel.open && shownAccount && !loading) renderCards(); });
setInterval(() => { if (panel.open && shownAccount && page === 1) void load(true); }, 20000);
