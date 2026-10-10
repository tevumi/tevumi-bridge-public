import {formatEther} from 'ethers';
import {bridgeView} from '../immediate-deploy/live.js';
import {currentLanguage} from './locale.js';

const text = (en, zh) => currentLanguage() === 'zh-CN' ? zh : en;
const hashOk = value => /^0x[0-9a-f]{64}$/i.test(value || '');
const sent = new Set();
const views = {};

for (const kind of ['buy', 'swap']) {
  const panel = document.createElement('details');
  panel.className = 'advanced journey-history';
  panel.id = `journey-${kind}-history`;
  panel.hidden = true;
  const heading = document.createElement('summary');
  const list = document.createElement('div');
  list.className = 'history-list';
  list.setAttribute('aria-live', 'polite');
  const more = document.createElement('button');
  more.className = 'secondary';
  more.type = 'button';
  more.hidden = true;
  panel.append(heading, list, more);
  document.querySelector(`#journey-${kind}-card`).after(panel);
  views[kind] = {panel, heading, list, more, page: 0, account: null, loading: false, items: []};
  panel.addEventListener('toggle', () => { if (panel.open) void load(kind, true); });
  more.addEventListener('click', () => { void load(kind); });
}

function render(kind) {
  const view = views[kind];
  view.heading.textContent = text('Transfer history', '交易记录');
  view.more.textContent = text('Load more', '加载更多');
  view.list.replaceChildren();
  if (!view.items.length) {
    view.list.textContent = text('No transactions recorded for this wallet yet.', '这个钱包暂无交易记录。');
    return;
  }
  for (const item of view.items) {
    const card = document.createElement('article');
    card.className = 'history-card';
    const top = document.createElement('div');
    top.className = 'history-card-top';
    const title = document.createElement('strong');
    const reverse = kind === 'swap' && item.input_asset === 'USDC' && item.output_asset === 'WOTR';
    title.textContent = kind === 'buy' ? 'BNB Chain · BNB → WOTR' : reverse ? 'Arc · USDC → WOTR' : 'Arc · WOTR → USDC';
    const badge = document.createElement('span');
    badge.className = `history-status history-${item.status}`;
    badge.textContent = item.status === 'verified' ? text('Completed', '已完成') : item.status === 'failed' ? text('Failed on-chain', '链上失败') : text('Confirming', '确认中');
    top.append(title, badge);
    const meta = document.createElement('p');
    const inputUnit = kind === 'buy' ? 'BNB' : reverse ? 'USDC' : 'WOTR';
    const outputUnit = kind === 'buy' || reverse ? 'WOTR' : 'USDC';
    const input = /^\d+$/.test(item.input_amount || '') ? `${formatEther(BigInt(item.input_amount))} ${inputUnit}` : text('Amount unverified', '数量未核验');
    const output = item.status === 'verified' && /^\d+$/.test(item.output_amount || '') ? ` → ${formatEther(BigInt(item.output_amount))} ${outputUnit}` : '';
    meta.textContent = `${input}${output} · ${new Date(item.created_at * 1000).toLocaleString(currentLanguage(), {hour12: false})}`;
    if(kind==='buy'){
      const token=item.token_address || '0xb97b99cb6dc0edbb89512e14100b2e9c23132ee5';
      meta.textContent+=` · ${token.toLowerCase()==='0xe2a0ce4be658ee9b09e461f5283c718a20984444'?'WOTR':text('Historical contract','历史合约')}`;
    }
    const actions = document.createElement('div');
    actions.className = 'history-links';
    if (hashOk(item.tx_hash)) {
      const link = document.createElement('a');
      link.href = `${kind === 'buy' ? 'https://bscscan.com/tx/' : 'https://explorer.arc.io/tx/'}${item.tx_hash}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `${text('View transaction', '查看交易')} ↗`;
      actions.append(link);
    }
    card.append(top, meta, actions);
    view.list.append(card);
  }
}

async function load(kind, reset = false) {
  const view = views[kind];
  const account = bridgeView().account?.toLowerCase();
  if (!view.panel.open || !account || view.loading) return;
  if (reset || view.account !== account) {
    view.account = account;
    view.page = 0;
    view.items = [];
    view.list.textContent = text('Loading history…', '正在加载交易记录…');
    view.more.hidden = true;
  }
  view.loading = true;
  const page = view.page;
  try {
    const response = await fetch(`/api/journey-transfers?account=${encodeURIComponent(account)}&kind=${kind}&page=${page}`, {cache:'no-store', signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw Error('History unavailable');
    const data = await response.json();
    if (bridgeView().account?.toLowerCase() !== account) return;
    if (page === 0) view.items = [];
    view.items.push(...data.items);
    view.page = page + 1;
    view.more.hidden = !data.more;
    render(kind);
  } catch {
    if (page === 0) view.list.textContent = text('History is temporarily unavailable. Reopen to retry.', '交易记录暂时无法加载，请重新展开重试。');
    else view.more.textContent = text('Retry', '重试');
  } finally { view.loading = false; }
}

async function index(kind, hash) {
  if (!views[kind] || !hashOk(hash)) return;
  const key = `${kind}:${hash.toLowerCase()}`;
  if (sent.has(key)) return;
  sent.add(key);
  try {
    const response = await fetch('/api/journey-transfers', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({kind,hash}), signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw Error('Index unavailable');
    if (views[kind].panel.open) void load(kind, true);
  } catch { sent.delete(key); }
}

window.addEventListener('tevumi:journey-hash', event => { void index(event.detail?.kind, event.detail?.hash); });
function showTab(tab) {
  const account = bridgeView().account;
  for (const kind of ['buy','swap']) views[kind].panel.hidden = !account || tab !== kind || (kind==='swap'&&new URLSearchParams(location.search).get('market')!=='historical');
}
window.addEventListener('tevumi:journey-tab', event => showTab(event.detail?.tab));
let activeAccount = bridgeView().account?.toLowerCase() || null;
window.addEventListener('tevumi:bridge-view', () => {
  const account = bridgeView().account?.toLowerCase() || null;
  if (account !== activeAccount) {
    for (const kind of ['buy','swap']) views[kind].panel.open = false;
    activeAccount = account;
  }
  showTab(document.body.dataset.view || 'buy');
  for (const kind of ['buy', 'swap']) {
    const view = views[kind];
    if (view.account === account) continue;
    view.account = null;
    view.items = [];
    view.more.hidden = true;
    view.list.textContent = account ? text('Expand to view transaction history.', '展开后查看交易记录。') : text('Connect your wallet to view history.', '连接钱包后查看交易记录。');
    if (view.panel.open && account) void load(kind, true);
  }
});
window.addEventListener('tevumi:locale-change', () => { for (const kind of ['buy','swap']) render(kind); });
setInterval(() => { for (const kind of ['buy','swap']) if (views[kind].panel.open && views[kind].account) void load(kind, true); }, 30000);
for (const kind of ['buy','swap']) views[kind].list.textContent = text('Connect your wallet to view history.', '连接钱包后查看交易记录。');
showTab(document.body.dataset.view || 'buy');
