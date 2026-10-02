// The public bridge opens in English. Language controls become available after
// wallet connection; a connection never restores an older language choice.
let connected = false;
let language = 'en';

const exact = new Map(Object.entries({
  '单独跨链': 'Bridge an asset',
  'WOTR 三步体验': 'WOTR journey · 3 steps',
  '从 BNB 到 Arc USDC': 'From BNB to Arc USDC',
  '三笔独立交易 · 主网': '3 independent transactions · Mainnet',
  '在 BNB Chain 买入 WOTR，跨链到 Arc，再兑换成 USDC。每笔交易都需要在钱包确认。你可以离开页面，稍后回来查看进度。': 'Buy WOTR on BNB Chain, bridge it to Arc, then swap it for USDC. Confirm each transaction in your wallet. You can leave and return to check progress.',
  '购买 WOTR': 'Buy WOTR',
  '跨链 WOTR': 'Bridge WOTR',
  '兑换 USDC': 'Swap to USDC',
  '在 BNB Chain 买入 WOTR': 'Buy WOTR on BNB Chain',
  'PancakeSwap V2 · WOTR/BNB 池': 'PancakeSwap V2 · WOTR/BNB pool',
  '你支付 · BNB': 'You pay · BNB',
  '预计收到': 'Estimated receive',
  '连接钱包后刷新实时报价。': 'Connect your wallet, then refresh the live quote.',
  '刷新报价': 'Refresh quote',
  '跨链 WOTR 到 Arc': 'Bridge WOTR to Arc',
  'Tevumi Bridge · 两链使用同一钱包': 'Tevumi Bridge · same wallet on both chains',
  '使用现有 WOTR 跨链表单选择数量并查看实时消息费。': 'Use the existing WOTR bridge form to choose the amount and review the live message fee.',
  '打开 WOTR 跨链': 'Open WOTR bridge',
  '在 Arc 将 WOTR 兑换为 USDC': 'Swap WOTR for USDC on Arc',
  'Uniswap V4 · WOTR/USDC 池': 'Uniswap V4 · WOTR/USDC pool',
  '你卖出 · WOTR': 'You sell · WOTR',
  '连接钱包后刷新 Arc 池报价。最后兑换需要 Arc 原生 USDC 支付 Gas。': 'Connect your wallet, then refresh the Arc pool quote. Arc native USDC is needed for gas.',
  '检查授权': 'Review approval',
  '体验进度': 'JOURNEY PROGRESS',
  '前往 Arc USDC': 'Your journey to Arc USDC',
  '在 BNB Chain 购买 WOTR': 'Purchase WOTR on BNB Chain',
  '跨链到 Arc': 'Bridge to Arc',
  '从 BNB Chain 向 Arc 跨链 WOTR': 'Send WOTR from BNB Chain to Arc',
  '在 Arc 将 WOTR 兑换为原生 USDC': 'Swap WOTR for native USDC on Arc',
  '你的路线': 'YOUR ROUTE',
  '清晰的三步': 'Three clear steps',
  '连接钱包即可开始。': 'Connect your wallet to get started.',
  '连接后将在这里显示实时余额。': 'Live balances appear here after connection.',
  '每一步都需要单独的钱包交易。最终到账数量取决于当前池子、费用和市场价格。签名前请查看最新报价。': 'Each step uses a separate wallet transaction. The amount you get depends on the current pools, fees and market price. Read the latest quote before signing.',
  'Arc 使用原生 USDC 支付 Gas。最后兑换前请在 Arc 钱包保留一些 USDC。': 'Arc uses native USDC for gas. Keep some USDC in your Arc wallet before the final swap.',
  'Tevumi Bridge 首页': 'Tevumi Bridge home',
  '你的资产不止一条链': 'Your assets go beyond one chain',
  '跨链转移': 'Bridge assets',
  '主网': 'Mainnet',
  'BNB Chain ↔ Arc · 主网': 'BNB Chain ↔ Arc · Mainnet',
  '选择方向': 'Choose direction',
  '未连接钱包': 'Wallet not connected',
  '跨链方向': 'Bridge direction',
  '跨链资产': 'Asset',
  '搜索币安人生、CAT…': 'Search 币安人生, CAT…',
  '可跨链资产': 'Available assets',
  '没有找到匹配的资产。': 'No matching assets found.',
  '发送数量': 'Amount to send',
  '正在读取当前单笔限额…': 'Loading the current per-transfer limit…',
  '连接钱包后显示所选资产的余额。': 'Connect your wallet to see the selected asset balance.',
  '连接钱包后显示余额和双向消息费报价。': 'Connect your wallet to see balances and fee quotes.',
  '连接钱包': 'Connect wallet',
  '授权并跨链': 'Approve and bridge',
  '开始跨链': 'Bridge now',
  '再次跨链': 'Bridge again',
  '查看 Arc 到账': 'Check arrival on Arc',
  '查看 BNB Chain 到账': 'Check arrival on BNB Chain',
  '首次从 BNB Chain 发送需要授权；一次点击会依次请求授权和发送，两笔交易各需钱包确认。': 'The first BNB Chain transfer needs approval. One click starts approval and transfer in sequence; confirm each transaction in your wallet.',
  '交易进度': 'Transfer progress',
  '准备交易': 'Prepare transfer',
  '选择资产和方向，连接钱包': 'Choose an asset and direction, then connect your wallet',
  '来源链确认': 'Source-chain confirmation',
  '在钱包确认后等待主网回执': 'Confirm in your wallet and wait for the mainnet receipt',
  '目标链到账': 'Destination-chain arrival',
  '发送后自动核验到账事件': 'Arrival is checked automatically after sending',
  '选择方向并连接钱包后即可开始。': 'Choose a direction and connect your wallet to begin.',
  '使用真实资产和主网手续费。请核对钱包中的网络、合约和费用；交易处理中不要重复发送。': 'This uses real assets and mainnet fees. Check the network, contract, and fees in your wallet. Do not send again while a transaction is being checked.',
  '跨链记录': 'Transfer history',
  '连接钱包后查看跨链记录。': 'Connect your wallet to view transfer history.',
  '展开后查看跨链记录。': 'Expand to view transfer history.',
  '加载更多': 'Load more',
  '跨链说明': 'About this bridge',
  '各自跨链': 'Bridge each asset',
  '资产在两条链之间流转，不进行币种互换。': 'Move the same asset between chains. This is not a token swap.',
  '小额通道': 'Small-transfer route',
  '每笔至少 0.000001 枚，发送前会复核链上限额与余额。': 'Minimum 0.000001 tokens per transfer. On-chain limits and balances are checked before sending.',
  '真实主网': 'Live mainnet',
  '使用真实资产；还需支付对应链上的消息费与 Gas。': 'Uses real assets. Message fees and gas are paid on the source chain.',
  '返回资产选择': 'Back to asset selection',
  '小额开放': 'Small transfers open',
  '按链上状态': 'Live chain status',
  '当前方向的桥仍暂停，暂不能发送。桥管理钱包开放后请刷新页面。': 'This route is paused. Reload the page after the bridge admin opens it.',
  '发送链或目标链接收仍暂停。': 'Sending or destination receiving is still paused.',
  '请输入最多 6 位小数的数量。': 'Enter an amount with at most 6 decimal places.',
  '数量超出可用范围。': 'Amount is outside the supported range.',
  '最小数量为 0.000001 枚。': 'Minimum amount is 0.000001 tokens.',
  '当前操作尚未完成，请等待结果。': 'The current operation is still in progress. Please wait.',
  '正在核对上一笔交易，请勿重复发起。核对完成后页面会自动更新。': 'Checking the previous transaction. Please do not send again. The page will update automatically.',
  '上一笔交易已核对，页面状态已更新。': 'The previous transaction has been checked. The page is up to date.',
  '已到账目标链。可以在交易记录中查看哈希，或发起下一笔。': 'Arrived on the destination chain. View the transaction hashes in history or start another transfer.',
  '来源链交易已提交，正在自动核验目标链到账。请勿重复发送。': 'Source-chain transaction submitted. Destination arrival is being checked automatically. Do not send again.',
  '请选择搜索结果后继续。': 'Select an asset from the search results to continue.',
  '已连接钱包。核对资产和数量后开始跨链。': 'Wallet connected. Check the asset and amount, then bridge.',
  '选择资产和方向，连接钱包后即可开始。': 'Choose an asset and direction, then connect your wallet.',
  '正在加载跨链记录…': 'Loading transfer history…',
  '这个钱包暂无跨链记录。': 'No transfer history for this wallet yet.',
  '记录暂时无法加载，请稍后重新展开。': 'History could not be loaded. Please try expanding it again later.',
  '重试加载': 'Retry',
  '已到账': 'Arrived',
  '跨链中': 'In transit',
  '确认中': 'Confirming',
  '发送失败': 'Send failed',
  '状态待核验': 'Status pending verification',
  '数量未核验': 'Amount unverified',
  '数量待确认': 'Amount pending confirmation',
  '数量待核验': 'Amount pending verification',
  '查看发送交易': 'View source transaction',
  '查看到账交易': 'View destination transaction',
  '操作失败': 'Operation failed',
  '广播结果不明': 'Broadcast result unclear',
  '暂无记录': 'No records',
  '未记录': 'Not recorded',
  '未核验': 'Not verified',
  '未找到浏览器钱包。': 'No browser wallet found.',
  '请先连接钱包。': 'Connect your wallet first.',
  '钱包账户已切换，请重新连接。': 'Wallet account changed. Please reconnect.',
  '钱包网络切换失败。': 'Could not switch the wallet network.',
  '正在读取所选资产余额…': 'Loading the selected asset balance…',
  '所选资产余额暂不可用，请稍后刷新。': 'The selected asset balance is unavailable. Please refresh later.',
  '正在读取双向余额和消息费报价…': 'Loading balances and message fee quotes…',
  '消息费币种异常。': 'Unexpected message fee currency.',
  '报价会变化，钱包确认前按最新数据重新计算。': 'Quotes may change and are recalculated before wallet confirmation.',
  '不支持的跨链方向。': 'Unsupported bridge direction.',
  '不支持的跨链资产。': 'Unsupported bridge asset.',
  '只读 RPC 网络不符。': 'Read-only RPC network mismatch.',
  'Gas 估算或费率异常。': 'Gas estimate or fee rate is invalid.',
  'Arc 基础费报价不可用。': 'Arc base fee quote is unavailable.',
  '钱包余额不足以覆盖本笔最高网络费用。': 'Wallet balance cannot cover the maximum network fee.',
  '已在钱包拒绝，未提交交易。': 'Rejected in wallet. No transaction was submitted.',
  '钱包未返回有效哈希；请按广播结果不明处理。': 'Wallet returned no valid hash. Treat the broadcast result as unclear.',
  '回执等待超时。原哈希已保存，请刷新或按哈希恢复。': 'Receipt wait timed out. The original hash was saved; refresh or recover by hash.',
  '缺少原始调用记录，无法核验交易身份。': 'The original call record is missing; transaction identity cannot be verified.',
  '未找到匹配的 OFTSent 事件。': 'No matching OFTSent event was found.',
  '解除暂停仅由指定管理钱包签署。': 'Only the designated admin wallet can resume transfers.',
  '解除暂停后链上状态不匹配。': 'On-chain state does not match after resuming.',
  '暂停仅由指定 guardian 钱包签署。': 'Only the designated guardian wallet can pause transfers.',
  '暂停后链上状态不匹配。': 'On-chain state does not match after pausing.',
  '双链尚未全部解除暂停。': 'Transfers are still paused on one or both chains.',
  '授权计划异常。': 'Approval plan is invalid.',
  '精确授权地址或数量不匹配。': 'Exact approval address or amount does not match.',
  '精确授权已核验，正在准备跨链交易，请继续查看钱包。': 'Exact approval verified. Preparing the bridge transfer; continue in your wallet.',
  '授权已完成，但发送计划未就绪；请检查状态后重试。': 'Approval completed, but the transfer plan is not ready. Check the status before retrying.',
  '发送计划异常。': 'Transfer plan is invalid.',
  '存在广播结果不明的交易，请先核验。': 'A transaction has an unclear broadcast result. Verify it first.',
  '原发送 GUID 或目标链起始区块缺失。请先恢复发送交易。': 'The source GUID or destination start block is missing. Recover the source transaction first.',
  '到账索引暂不可用；请保留原发送哈希，稍后再点核验，不要重新发送。': 'Arrival index is unavailable. Keep the source hash and verify later; do not send again.',
  '目标链交易哈希格式异常。': 'Destination transaction hash has an invalid format.',
  '目标链到账交易未成功或区块不匹配。': 'Destination transaction failed or the block does not match.',
  '目标链回执未找到与原 GUID、账户和数量匹配的到账事件。': 'No destination arrival event matches the original GUID, account, and amount.',
  '请输入完整交易哈希。': 'Enter the complete transaction hash.',
  '请先核验本轮双向到账。': 'Verify both arrivals in this round first.',
  '上一轮记录已归档到本浏览器。请导出保存。': 'The previous round was archived in this browser. Export it for safekeeping.',
  '正在读取所选资产的链上状态…': 'Loading the selected asset on-chain status…',
  '不支持的发送网络。': 'Unsupported source network.',
  '正式候选通道尚未配置。': 'The bridge route is not configured.',
  '目标链执行选项未配置。': 'Destination execution options are not configured.',
  '数量必须为正数，最多 6 位小数。': 'Amount must be positive and use at most 6 decimal places.',
  '数量不符合共享精度。': 'Amount does not match the shared precision.',
  'RPC 网络与候选通道不匹配。': 'RPC network does not match the bridge route.',
  '候选合约或原币没有代码。': 'Bridge contract or original token has no code.',
  'Endpoint 身份不匹配。': 'Endpoint identity does not match.',
  '双向可信合约不匹配。': 'Trusted contracts do not match across the two chains.',
  '原币绑定不匹配。': 'Original token binding does not match.',
  '发送或目标接收已暂停。': 'Sending or destination receiving is paused.',
  '超过当前发送或接收额度。': 'Exceeds the current send or receive capacity.',
  '原币精度不符合候选合约要求。': 'Original token precision does not meet contract requirements.',
  '超过锁仓容量。': 'Exceeds locked collateral capacity.',
  '原币余额不足。': 'Insufficient original token balance.',
  'Arc 对应币余额不足。': 'Insufficient corresponding token balance on Arc.',
  '不支持使用 LZ 代币支付消息费。': 'Paying the message fee with LZ token is unsupported.',
  '币安人生': '币安人生',
}));

const patterns = [
  [/^超过当前单笔上限 ([\d.]+) 枚。$/, (_, n) => `Exceeds the current per-transfer limit of ${n} tokens.`],
  [/^当前单笔上限 ([\d.]+) 枚；发送前会复核可用额度。$/, (_, n) => `Current per-transfer limit: ${n} tokens. Available capacity is checked before sending.`],
  [/^已连接 (0x[\da-f]+)$/i, (_, account) => `Connected ${account}`],
  [/^钱包余额：([\d.]+) (币安人生|CAT|WOTR)$/, (_, amount, asset) => `Wallet balance: ${amount} ${asset}`],
  [/^([\d.]+) 枚$/, (_, amount) => `${amount} tokens`],
  [/^(.+?) 合约身份或 peer 不匹配。$/, (_, side) => `${side} contract identity or peer does not match.`],
  [/^(.+?) 管理权限不匹配。$/, (_, side) => `${side} admin authority does not match.`],
  [/^(.+?)：报价暂不可用。发送前仍会重新核算。$/, (_, side) => `${side}: quote unavailable. It will be recalculated before sending.`],
  [/^(.+?) 已有交易或结果不明；先核验原哈希。$/, (_, kind) => `${kind} already has a transaction or unclear result. Verify the original hash first.`],
  [/^(.+?) 正在请求钱包确认；请核对网络、合约和费用。$/, (_, kind) => `${kind} is awaiting wallet confirmation. Check the network, contract, and fees.`],
  [/^钱包未提交交易：(.+)$/, (_, detail) => `Wallet did not submit the transaction: ${detail}`],
  [/^钱包未返回交易哈希：(.+)。不要重发，请按原哈希恢复。$/, (_, detail) => `Wallet returned no transaction hash: ${detail}. Do not send again; recover using the original hash.`],
  [/^(.+?) 已提交 (0x[\da-f]+)；正在等待回执。$/i, (_, kind, hash) => `${kind} submitted ${hash}; waiting for a receipt.`],
  [/^(.+?) 回执已核验：(0x[\da-f]+)$/i, (_, kind, hash) => `${kind} receipt verified: ${hash}`],
  [/^自动核验暂不可用：(.+)。可稍后手动核验。$/, (_, detail) => `Automatic verification unavailable: ${detail}. You can verify manually later.`],
  [/^原交易未确认成功或调用身份不匹配：(.+)$/, (_, kind) => `Original transaction failed or call identity does not match: ${kind}`],
  [/^(.+?) 已非完全暂停，请刷新核对。$/, (_, side) => `${side} is no longer fully paused. Refresh and check.`],
  [/^(.+?) 已完全暂停。$/, (_, side) => `${side} is already fully paused.`],
  [/^(.+?) 尚未查到匹配 GUID 的到账事件。请稍后重新核验，不要重发。$/, (_, side) => `No arrival event matching the GUID was found on ${side}. Verify again later; do not resend.`],
  [/^(.+?) 到账已核验：(0x[\da-f]+)$/i, (_, side, hash) => `${side} arrival verified: ${hash}`],
  [/^(.+?) 已按原哈希核验。$/, (_, kind) => `${kind} verified using the original hash.`],
  [/^(.+?) 枚$/, (_, amount) => `${amount} tokens`],
];

const reverse = new Map([...exact].map(([chinese, english]) => [english, chinese]));
function originalText(value) {
  const plain = value.trim();
  if (!reverse.has(plain)) return value;
  return value.replace(plain, reverse.get(plain));
}

export function translate(value) {
  if (language === 'zh-CN' || !/[\u3400-\u9fff]/u.test(value)) return value;
  const leading = value.match(/^\s*/u)?.[0] ?? '';
  const trailing = value.match(/\s*$/u)?.[0] ?? '';
  const source = value.trim();
  if (exact.has(source)) return leading + exact.get(source) + trailing;
  for (const [pattern, replacement] of patterns) if (pattern.test(source)) return leading + source.replace(pattern, replacement) + trailing;
  return value;
}

const sources = new WeakMap();
const attributes = ['aria-label', 'placeholder', 'content'];
function updateText(node) {
  const prior = sources.get(node);
  const original = prior && node.nodeValue === prior.rendered ? prior.original : originalText(node.nodeValue);
  const rendered = language === 'en' ? translate(original) : original;
  sources.set(node, { original, rendered });
  if (node.nodeValue !== rendered) node.nodeValue = rendered;
}
function updateAttribute(element, name) {
  const current = element.getAttribute(name);
  if (current === null) return;
  const stored = sources.get(element) ?? {};
  const prior = stored[name];
  const original = prior && current === prior.rendered ? prior.original : originalText(current);
  const rendered = language === 'en' ? translate(original) : original;
  stored[name] = { original, rendered };
  sources.set(element, stored);
  if (current !== rendered) element.setAttribute(name, rendered);
}
function visit(root) {
  if (root.nodeType === Node.TEXT_NODE) { updateText(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  if (root.matches('script,style')) return;
  for (const name of attributes) updateAttribute(root, name);
  for (const child of root.childNodes) visit(child);
}
function apply() {
  document.documentElement.lang = language;
  document.querySelector('.language-switch').hidden = !connected;
  document.querySelectorAll('[data-language]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.language === language));
  });
  visit(document.body);
  const description = document.querySelector('meta[name="description"]');
  if (description) description.content = language === 'en'
    ? 'Bridge 币安人生, CAT or WOTR between BNB Chain and Arc with Tevumi Bridge.'
    : 'Tevumi Bridge：选择币安人生、CAT 或 WOTR，在 BNB Chain 与 Arc 之间跨链。';
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-language]').forEach(button => button.addEventListener('click', () => {
    if (!connected) return;
    language = button.dataset.language;
    apply();
    window.dispatchEvent(new Event('tevumi:locale-change'));
  }));
  window.addEventListener('tevumi:bridge-view', event => {
    const nextConnected = Boolean(event.detail?.account);
    if (connected === nextConnected) return;
    connected = nextConnected;
    if (!connected) language = 'en';
    apply();
    window.dispatchEvent(new Event('tevumi:locale-change'));
  });
  apply();
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') updateText(mutation.target);
      for (const node of mutation.addedNodes) visit(node);
      if (mutation.type === 'attributes' && attributes.includes(mutation.attributeName)) updateAttribute(mutation.target, mutation.attributeName);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attributes });
});

export const currentLanguage = () => language;
