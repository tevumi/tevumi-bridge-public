import {BridgeKit} from '@circle-fin/bridge-kit';
import {createViemAdapterFromProvider} from '@circle-fin/adapter-viem-v2';
import {getAddress, parseEther, parseUnits, formatUnits} from 'ethers';
import {rpc} from '../../immediate-deploy/rpc.js';
import {chainBadge, iconFor} from './chain-icons.js';
import {pickWallet} from '../wallet-picker.js';

const $ = id => document.getElementById(id);
const kit = new BridgeKit();
const ARC_ID = 5042;
const ARC_USDC = '0x3600000000000000000000000000000000000000';
const ARC_CCTP_MESSENGER = '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d';
const RECORD_PREFIX = 'tevumi:circle-usdc:mainnet:v1:';
const HISTORY_PREFIX = 'tevumi:circle-usdc:history:v1:';
const validHash = value => /^0x[0-9a-f]{64}$/i.test(value || '');
const same = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
const short = address => address ? `${address.slice(0,6)}…${address.slice(-4)}` : '';
const cleanError = error => String(error?.shortMessage || error?.message || error).replace(/https?:\/\/\S+/g,'[network]').slice(0,250);
const safeJson = value => JSON.stringify(value, (key,item) => key === 'error' ? undefined : typeof item === 'bigint' ? {__tevumi_bigint:item.toString()} : item);
const readJson = value => JSON.parse(value, (key,item) => item && typeof item === 'object' && Object.keys(item).length === 1 && /^\d+$/.test(item.__tevumi_bigint || '') ? BigInt(item.__tevumi_bigint) : item);
const amountValue = () => $('amount').value.trim();
const validAmount = value => /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value) && parseUnits(value,6) > 0n;
const sdkArc = kit.getSupportedChains({isTestnet:false}).find(chain => chain.name === 'Arc');
const directArc = same(sdkArc?.cctp?.contracts?.v2?.tokenMessenger,ARC_CCTP_MESSENGER)
  ? {...sdkArc,kitContracts:{...sdkArc.kitContracts,bridge:undefined}}
  : null;
const supported = kit.getSupportedChains({isTestnet:false}).filter(chain => chain.name !== 'Arc');
let provider = null;
let account = null;
let adapter = null;
let balance = null;
let tokenBalance = null;
let estimate = null;
let estimatedAt = 0;
let quoteTimer = null;
let quoteSequence = 0;
let working = false;
let currentRecord = null;
let historyRecords = [];
let serverRecords = [];
let serverMore = false;
let serverPage = 0;
let serverLoading = false;
let serverUnavailable = false;
const syncedBurns = new Set();
const syncingBurns = new Set();
let walletAccountsChanged = null;
let language = 'en';
const t = (en,zh) => language === 'zh-CN' ? zh : en;
const labels = {
  'back-link':['← Back to Swap','← 返回兑换'],
  eyebrow:['USDC · CIRCLE APP KIT','USDC · CIRCLE APP KIT'],
  title:['Bridge USDC.','跨链 USDC。'],
  lead:['Move Arc USDC to a destination supported by Circle Bridge Kit. Choose a chain and amount; the live quote appears automatically.','将 Arc 上的 USDC 转到 Circle Bridge Kit 支持的目标链。选择链和金额后会自动显示实时报价。'],
  'source-label':['From','来源'],
  'destination-label':['To','目标链'],
  'amount-label':['Amount to send','跨链数量'],
  'amount-help':['Leave enough Arc USDC to pay network gas.','请在 Arc 钱包中留足 USDC 支付网络 Gas。'],
  'recipient-label':['Destination recipient address','目标链收款地址'],
  'recipient-help':['Check this address carefully. It may differ from your Arc wallet address.','请仔细核对目标链地址，它可能与 Arc 钱包地址不同。'],
  'speed-note':['Standard transfer · no CCTP Fast Transfer fee. Completion time varies by route.','标准速度 · 无 CCTP 快速转账费。完成时间因路线而异。'],
  'bridge-button':['Review and bridge USDC','确认报价并跨链 USDC'],
  'aside-label':['WHAT HAPPENS NEXT','后续流程'],
  'stage-one':['Approve and send','授权并发送'],
  'stage-one-help':["Circle's SDK requests any needed approval and starts the Arc transfer.",'Circle SDK 会请求必要的授权并在 Arc 发起转账。'],
  'stage-two':['Bridge confirmation','跨链确认'],
  'stage-two-help':['The SDK follows the burn, attestation, and destination mint.','SDK 跟踪销毁、证明和目标链铸造。'],
  'stage-three':['USDC arrives','USDC 到账'],
  'stage-three-help':['Destination confirmation is shown only after the SDK reports success.','只有 SDK 报告成功后才显示目标链到账。'],
  'aside-note':['Uses real USDC and network fees. A quote is checked again before signing. Wallet confirmations are still required.','本操作使用真实 USDC 并产生网络费。签名前会再次检查报价，仍需在钱包确认。'],
  'activity-title':['Current transfer','当前跨链记录'],
  'retry-button':['Resume transfer','继续原跨链'],
  'history-title':['Transfer history','跨链记录'],
  'history-note':['Verified transfers load from our server; unfinished SDK attempts remain in this browser.','已核验的跨链从服务器读取；未完成的 SDK 尝试仍保存在当前浏览器。'],
  'history-more':['Load more verified transfers','加载更多已核验跨链'],
  'footer-note':['Arc USDC → Circle-supported chains','Arc USDC → Circle 支持的链'],
};
function renderLanguage() {
  document.documentElement.lang=language;
  $('language').hidden=!account;
  $('lang-en').setAttribute('aria-pressed',String(language==='en'));
  $('lang-zh').setAttribute('aria-pressed',String(language==='zh-CN'));
  for (const [id,copy] of Object.entries(labels)) $(id).textContent=language==='zh-CN'?copy[1]:copy[0];
  $('aside-title').innerHTML=language==='zh-CN'?'一次转账。<br>进度清晰。':'One transfer.<br>Clear progress.';
  $('destination').options[0].textContent=t('Select destination','选择目标链');
  $('destination-search').placeholder=t('Search chains','搜索链名称');
  $('destination-search').setAttribute('aria-label',t('Search chains','搜索链名称'));
  renderChainTrigger();
  if (!$('destination-panel').hidden) renderChainOptions();
  renderRecord();
  renderHistory();
  updateButton();
}

function setStatus(message) { $('status').textContent = message || ''; }
function setQuote(message, error=false, warning=false) {
  $('quote').textContent = message;
  $('quote').classList.toggle('error',error);
  $('quote').classList.toggle('warning',warning && !error);
}
function key() { return account ? RECORD_PREFIX + account.toLowerCase() : null; }
function historyKey() { return account ? HISTORY_PREFIX + account.toLowerCase() : null; }
function burnHash(record) {
  const matches=[...(record?.result?.steps || []),...(record?.steps || []),...(record?.events || [])];
  return matches.find(item => /burn/i.test(item?.name || '') && validHash(item?.txHash))?.txHash?.toLowerCase() || null;
}
async function loadServerHistory(reset=false) {
  if (!account || serverLoading) return;
  const expected=account;
  if (reset) { serverPage=0; serverRecords=[]; serverMore=false; }
  serverLoading=true; serverUnavailable=false; renderHistory();
  try {
    const response=await fetch(`/api/usdc-transfers?account=${encodeURIComponent(expected)}&page=${serverPage}`,{cache:'no-store',signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw Error(`History service ${response.status}`);
    const body=await response.json();
    if (!same(account,expected)) return;
    serverRecords=[...serverRecords,...(body.items || [])];
    serverMore=Boolean(body.more); serverPage++;
  } catch { if (same(account,expected)) serverUnavailable=true; }
  finally { serverLoading=false; if (same(account,expected)) { renderHistory(); renderRecord(); } }
}
async function syncBurn(record) {
  const hash=burnHash(record);
  if (!hash || syncedBurns.has(hash) || syncingBurns.has(hash)) return;
  syncingBurns.add(hash);
  try {
    const response=await fetch('/api/usdc-transfers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({hash}),signal:AbortSignal.timeout(20000)});
    if (!response.ok) return;
    syncedBurns.add(hash);
    if (same(account,record.account)) await loadServerHistory(true);
  } catch { /* browser recovery record remains available for a later sync */ }
  finally { syncingBurns.delete(hash); }
}
function hasRecordedHash(record) {
  return [...(record?.events || []),...(record?.steps || []),...(record?.result?.steps || [])].some(item => validHash(item?.txHash));
}
function approvalDeclined(record) {
  if (record?.state !== 'error' || hasRecordedHash(record)) return false;
  const approve = (record.result?.steps || []).find(step => step.name === 'approve');
  const message = `${record.errorMessage || ''} ${approve?.errorMessage || ''} ${approve?.error || ''}`;
  return /user (?:rejected|denied)|rejected the request/i.test(message);
}
function normalizeRecord(record) {
  return approvalDeclined(record) ? {...record,state:'cancelled',approvalRejected:true} : record;
}
function historyEntry(record) {
  const steps=(record.result?.steps || []).filter(step => validHash(step.txHash)).map(step => ({name:step.name,txHash:step.txHash,explorerUrl:step.explorerUrl}));
  const events=(record.events || []).filter(event => validHash(event.txHash)).map(event => ({name:event.name,txHash:event.txHash}));
  return {id:record.id || `legacy:${record.createdAt || 0}:${record.destination || ''}:${record.amount || ''}`,state:record.state,approvalRejected:Boolean(record.approvalRejected),amount:record.amount,destination:record.destination,createdAt:record.createdAt || 0,steps,events};
}
function saveHistory(record) {
  const entry=historyEntry(record);
  historyRecords=[entry,...historyRecords.filter(item=>item.id!==entry.id)].slice(0,100);
  if (historyKey()) localStorage.setItem(historyKey(),safeJson(historyRecords));
  renderHistory();
}
function saveRecord(record) {
  currentRecord = normalizeRecord(record);
  if (key()) localStorage.setItem(key(),safeJson(currentRecord));
  if (historyKey()) saveHistory(currentRecord);
  renderRecord();
  updateButton();
  void syncBurn(currentRecord);
}
function loadRecord() {
  try { const saved=readJson(localStorage.getItem(historyKey()) || '[]'); historyRecords=Array.isArray(saved) ? saved.filter(item=>item && typeof item==='object' && typeof item.id==='string').slice(0,100) : []; } catch { historyRecords=[]; }
  try { currentRecord = normalizeRecord(readJson(localStorage.getItem(key()) || 'null')); } catch { currentRecord = {state:'unknown',amount:'?',destination:'?',events:[]}; }
  if (currentRecord) {
    localStorage.setItem(key(),safeJson(currentRecord));
    saveHistory(currentRecord);
  } else renderHistory();
  renderRecord();
  if (currentRecord) void syncBurn(currentRecord);
  for (const item of historyRecords.slice(0,5)) void syncBurn(item);
}
function pendingRecord() { return currentRecord && !['success','cancelled'].includes(currentRecord.state); }
function selectedChain() { return supported.find(chain => chain.name === $('destination').value); }
function renderChainTrigger() {
  const current=$('destination-current');
  current.replaceChildren();
  const chain=selectedChain();
  if (!chain) { current.textContent=t('Select chain','选择链'); return; }
  current.append(chainBadge(chain.name),document.createTextNode(chain.name));
}
function renderChainOptions() {
  const list=$('destination-options');
  const term=$('destination-search').value.trim().toLowerCase();
  list.replaceChildren();
  for (const chain of supported.filter(item=>item.name.toLowerCase().includes(term))) {
    const option=document.createElement('button');
    option.type='button';
    option.className='destination-option';
    option.setAttribute('role','option');
    option.setAttribute('aria-selected',String($('destination').value===chain.name));
    option.append(chainBadge(chain.name),document.createTextNode(chain.name));
    option.addEventListener('click',()=>{
      $('destination').value=chain.name;
      $('destination').dispatchEvent(new Event('change',{bubbles:true}));
      closeChainPicker();
      $('destination-trigger').focus();
    });
    list.append(option);
  }
  if (!list.children.length) {
    const empty=document.createElement('p');
    empty.className='destination-empty';
    empty.textContent=t('No matching chain','没有匹配的链');
    list.append(empty);
  }
}
function closeChainPicker() {
  $('destination-panel').hidden=true;
  $('destination-trigger').setAttribute('aria-expanded','false');
}
function openChainPicker() {
  $('destination-panel').hidden=false;
  $('destination-trigger').setAttribute('aria-expanded','true');
  $('destination-search').value='';
  renderChainOptions();
  $('destination-search').focus();
}
function destinationIsForwarded(chain) { return chain?.cctp?.forwarderSupported?.destination === true; }
function destinationAddress(chain) {
  if (chain?.type === 'evm') return account;
  return $('recipient').value.trim();
}
function validRecipient(chain) {
  if (!chain) return false;
  if (chain.type === 'evm') return Boolean(account);
  if (chain.type === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test($('recipient').value.trim());
  return false;
}
function params(chain) {
  if (!directArc) throw Error('Circle Arc TokenMessenger configuration does not match the verified mainnet contract.');
  const forwarded = destinationIsForwarded(chain);
  const to = forwarded
    ? {chain:chain.name,recipientAddress:destinationAddress(chain),useForwarder:true}
    : {adapter,chain:chain.name,recipientAddress:destinationAddress(chain)};
  return {from:{adapter,chain:directArc},to,amount:amountValue(),token:'USDC',config:{transferSpeed:'SLOW',batchTransactions:false}};
}
function updateButton() {
  const ready = Boolean(account && adapter && estimate && Date.now()-estimatedAt < 60000 && !working && !pendingRecord() && currentRecord?.state !== 'success');
  $('bridge-button').disabled = !ready;
  $('bridge-button').textContent = currentRecord?.state === 'success' ? t('Previous transfer complete','上一笔跨链已完成') : t('Review and bridge USDC','确认报价并跨链 USDC');
  $('retry-button').hidden = !(account && currentRecord?.state === 'error' && currentRecord.result);
  $('new-transfer-button').hidden = !(account && currentRecord?.state === 'success' && hasRecordedHash(currentRecord));
  $('new-transfer-button').disabled = working;
  $('new-transfer-button').textContent = t('Start a new transfer','发起新一笔跨链');
  $('wallet-button').textContent = account ? `${short(account)} ▾` : t('Connect wallet','连接钱包');
}
function recordLabel(record) {
  if (record.state === 'success' && serverRecords.some(item=>item.status==='arrived' && same(item.source_hash,burnHash(record)))) return t('Destination verified','目标链已核验');
  if (record.approvalRejected) return t('Approval declined','授权已拒绝');
  if (record.state==='pending' && !hasRecordedHash(record)) return t('Awaiting wallet','等待钱包');
  return ({success:t('SDK completed','SDK 已完成'),pending:t('Processing','处理中'),error:t('Action needed','需要处理'),cancelled:t('Cancelled','已取消'),unknown:t('Check status','待核查')})[record.state] || t('Check status','待核查');
}
function transactionLinks(container,record) {
  const seen=new Set();
  for (const step of [...(record.steps || []),...(record.events || [])]) {
    if (!validHash(step.txHash) || seen.has(step.txHash.toLowerCase())) continue;
    seen.add(step.txHash.toLowerCase());
    const link=typeof step.explorerUrl==='string' && step.explorerUrl.startsWith('https://') ? step.explorerUrl : ['approve','burn'].includes(step.name) ? `https://explorer.arc.io/tx/${step.txHash}` : null;
    const node=document.createElement(link ? 'a' : 'span');
    if (link) { node.href=link; node.target='_blank'; node.rel='noopener noreferrer'; }
    node.textContent=`${step.name || 'Transaction'} ${short(step.txHash)}${link ? ' ↗' : ''}`;
    container.append(node);
  }
}
function renderHistory() {
  const list=$('history-list');
  list.replaceChildren();
  $('history-more').hidden=!account || !serverMore || serverLoading;
  if (!account) { list.textContent=t('Connect your wallet to view transfer history.','连接钱包后查看跨链记录。'); return; }
  if (serverLoading && !serverRecords.length) { const p=document.createElement('p'); p.textContent=t('Loading verified transfers…','正在读取已核验跨链…'); list.append(p); }
  if (serverUnavailable) { const p=document.createElement('p'); p.textContent=t('Verified history is temporarily unavailable. Browser records appear below.','已核验历史暂时无法读取；下方仍显示浏览器记录。'); list.append(p); }
  for (const item of serverRecords) {
    const card=document.createElement('article'); card.className='history-card';
    const top=document.createElement('div'); top.className='history-card-top';
    const route=document.createElement('strong'); route.textContent=`${formatUnits(BigInt(item.amount),6)} USDC · Arc → ${item.target_chain}`;
    const arrived=item.status==='arrived';
    const status=document.createElement('span'); status.className=`history-status history-${arrived?'success':'pending'}`;
    status.textContent=arrived ? t('Destination verified','目标链已核验') : t('Arc burn verified','Arc 销毁已核验');
    top.append(route,status);
    const meta=document.createElement('p'); meta.textContent=`${new Date(Number(item.created_at)*1000).toLocaleString(language,{hour12:false})} · ${arrived ? t('Destination CCTP nonce used on-chain','目标链 CCTP nonce 已在链上使用') : t('Destination arrival not yet verified','目标链到账尚未核验')}`;
    const links=document.createElement('div'); links.className='history-links';
    const link=document.createElement('a'); link.href=`https://explorer.arc.io/tx/${item.source_hash}`; link.target='_blank'; link.rel='noopener noreferrer'; link.textContent=t('Arc source transaction ↗','Arc 来源交易 ↗'); links.append(link);
    card.append(top,meta,links); list.append(card);
  }
  const verified=new Set(serverRecords.map(item=>item.source_hash?.toLowerCase()));
  for (const item of historyRecords.filter(item=>!verified.has(burnHash(item)))) {
    const card=document.createElement('article'); card.className='history-card';
    const top=document.createElement('div'); top.className='history-card-top';
    const route=document.createElement('strong'); route.textContent=`${item.amount || '?'} USDC · Arc → ${item.destination || '?'}`;
    const status=document.createElement('span'); status.className=`history-status history-${['success','pending','error','cancelled','unknown'].includes(item.state) ? item.state : 'unknown'}`; status.textContent=recordLabel(item);
    top.append(route,status);
    const meta=document.createElement('p');
    const date=Number(item.createdAt) ? new Date(Number(item.createdAt)).toLocaleString(language,{hour12:false}) : t('Date unavailable','日期不可用');
    meta.textContent=`${date} · ${item.state==='success' ? t('SDK result; verify destination independently','SDK 结果；目标链仍需独立核验') : item.approvalRejected ? t('No transaction hash saved; check wallet activity','未保存交易哈希；请核对钱包记录') : t('Saved browser status','浏览器保存的状态')}`;
    const links=document.createElement('div'); links.className='history-links'; transactionLinks(links,item);
    card.append(top,meta,links); list.append(card);
  }
  if (!list.children.length) list.textContent=t('No USDC transfers found for this wallet.','此钱包暂无 USDC 跨链记录。');
}
function renderRecord() {
  $('activity').hidden = !currentRecord;
  if (!currentRecord) return;
  const body = $('activity-body');
  body.replaceChildren();
  const append = message => { const p=document.createElement('p'); p.textContent=message; body.append(p); };
  append(`${currentRecord.amount || '?'} USDC · Arc → ${currentRecord.destination || '?'} · ${recordLabel(currentRecord)}`);
  if (currentRecord.approvalRejected) append(t('Wallet approval was declined. No transaction hash was saved here; check wallet activity before trying again.','钱包授权已拒绝。这里未保存交易哈希；再次尝试前请核对钱包记录。'));
  else if (currentRecord.state === 'pending' && !hasRecordedHash(currentRecord)) append(t('Waiting for the wallet. No source transaction hash is saved. If the wallet blocks this request, check wallet activity before another attempt.','正在等待钱包确认，尚未保存源链交易哈希。如果钱包拦截了请求，再次尝试前请核对钱包活动。'));
  else if (currentRecord.state === 'pending') append(t('The SDK is processing this transfer. Do not send again.','SDK 正在处理这笔跨链，请勿重复发送。'));
  else if (currentRecord.state === 'unknown') append(t('The result is unclear. Check the saved transaction before another attempt.','结果暂不明确，再次尝试前请核对已保存的交易。'));
  else if (currentRecord.state === 'error') append(t('The SDK stopped before completion. Review any source transaction before resuming; your wallet may request another signature.','SDK 未完成。继续之前先核对源链交易；钱包可能再次请求签名。'));
  else if (currentRecord.state === 'success') append(serverRecords.some(item=>item.status==='arrived' && same(item.source_hash,burnHash(currentRecord))) ? t('The destination CCTP message has been used on-chain. To send again, start a separate transfer below.','目标链 CCTP 消息已在链上执行。如需再次跨链，请在下方发起新的一笔。') : t('The SDK reported completion. Destination verification is still pending; review the history before starting a separate transfer.','SDK 已报告完成，目标链核验仍在进行；再次跨链前请核对历史记录。'));
  if (!currentRecord.approvalRejected && currentRecord.errorMessage) append(cleanError(currentRecord.errorMessage));
  const links=document.createElement('div'); links.className='history-links'; transactionLinks(links,historyEntry(currentRecord)); body.append(links);
  updateButton();
}
function renderChains() {
  const select=$('destination');
  select.replaceChildren(new Option('Select destination',''));
  for (const chain of supported) select.add(new Option(chain.name,chain.name));
  $('arc-icon').src=iconFor('Arc');
  renderChainTrigger();
}
async function readBalance() {
  if (!account) return;
  try {
    const [raw,tokenRaw]=await Promise.all([
      rpc(ARC_ID,'eth_getBalance',[account,'latest']),
      rpc(ARC_ID,'eth_call',[{to:ARC_USDC,data:'0x70a08231'+account.slice(2).toLowerCase().padStart(64,'0')},'latest']),
    ]);
    balance=BigInt(raw);
    tokenBalance=BigInt(tokenRaw);
    $('balance').textContent=`Arc USDC: ${formatUnits(tokenBalance,6)}`;
  } catch {
    balance=null; tokenBalance=null;
    $('balance').textContent='Arc balance unavailable';
  }
}
function renderRecipient() {
  const chain=selectedChain();
  $('recipient-row').hidden = !chain || chain.type === 'evm';
  if (chain?.type === 'evm' && account) $('recipient-help').textContent=`Recipient: your wallet ${short(account)}`;
}
function resetQuote() {
  estimate=null; estimatedAt=0; quoteSequence++;
  updateButton();
}
function startNewTransfer() {
  if (working || currentRecord?.state !== 'success' || !hasRecordedHash(currentRecord)) return;
  currentRecord=null;
  if (key()) localStorage.removeItem(key());
  $('amount').value='';
  setStatus('');
  renderRecord();
  scheduleQuote();
  $('amount').focus();
}
function scheduleQuote() {
  clearTimeout(quoteTimer);
  resetQuote();
  if (!account) { setQuote(t('Connect your wallet to see a live quote.','连接钱包后即可查看实时报价。')); return; }
  if (currentRecord?.state === 'success') { setQuote(t('This transfer is complete. Start a separate transfer below to get a new quote.','本笔跨链已完成。若需再次跨链，请在下方发起新的一笔并重新获取报价。')); return; }
  const chain=selectedChain();
  if (!chain) { setQuote(t('Choose a destination chain.','请选择目标链。')); return; }
  if (!validRecipient(chain)) { setQuote(t('Enter a valid destination recipient address.','请输入有效的目标链收款地址。')); return; }
  if (!validAmount(amountValue())) { setQuote(t('Enter an amount greater than zero with at most six decimal places.','请输入大于零且最多 6 位小数的数量。')); return; }
  if (balance === null || tokenBalance === null) { setQuote(t('Arc balance is unavailable. Try again after it loads.','Arc 余额暂不可用，请稍后重试。'),true); return; }
  if (parseUnits(amountValue(),6)>tokenBalance) { setQuote(t('The Arc wallet does not hold this much transferable USDC.','Arc 钱包没有足够的可转 USDC。'),true); return; }
  if (parseEther(amountValue()) >= balance) { setQuote(t('Leave some Arc USDC in your wallet for network gas.','请在 Arc 钱包中留一些 USDC 支付网络 Gas。'),true); return; }
  if (pendingRecord()) { setQuote(t('A previous transfer still needs checking. Do not send again.','上一笔跨链仍需核查，请勿重复发送。'),true); return; }
  const sequence=quoteSequence;
  setQuote(t('Checking the live route and fees…','正在查询实时报价与费用…'));
  quoteTimer=setTimeout(()=>void fetchQuote(sequence),450);
}
async function fetchQuote(sequence) {
  try {
    const result=await kit.estimate(params(selectedChain()));
    if (sequence !== quoteSequence) return;
    acceptQuote(result);
  } catch (error) {
    if (sequence !== quoteSequence) return;
    resetQuote(); setQuote(t(`No usable quote for these inputs: ${cleanError(error)}`,`当前条件无可用报价：${cleanError(error)}`),true);
  }
}
function acceptQuote(result) {
    if (result.fees.some(item => item.error || item.amount === null) || result.gasFees.some(item => item.error || !item.fees)) throw Error('One or more fees could not be estimated.');
    if (destinationIsForwarded(selectedChain()) && !result.fees.some(item=>item.type==='forwarder' && item.amount!==null)) throw Error('Forwarder fee was not reported. This route cannot be submitted safely.');
    const usdcFees=result.fees.filter(item=>item.token==='USDC').reduce((sum,item)=>sum+parseUnits(item.amount,6),0n);
    const sendAmount=parseUnits(amountValue(),6);
    const received=sendAmount-usdcFees;
    if (received <= 0n) throw Error('Fees would consume the transfer amount. Choose a larger amount or another route.');
    const arcGas=result.gasFees.filter(item=>item.blockchain==='Arc').reduce((sum,item)=>sum+parseEther(item.fees.fee),0n);
    if (balance < parseEther(amountValue())+arcGas) throw Error('Arc USDC balance does not cover the amount and estimated network gas.');
    const feeLines=result.fees.map(item=>`${item.type}: ${item.amount} ${item.token}`);
    const gasLines=result.gasFees.map(item=>`${item.blockchain} ${item.name}: ${item.fees.fee} ${item.token}`);
    estimate=result; estimatedAt=Date.now();
    const highFee=usdcFees*5n>=sendAmount;
    const feePercent=(Number(usdcFees*10000n/sendAmount)/100).toFixed(2);
    const bridgeSpender=directArc?.cctp?.contracts?.v2?.tokenMessenger;
    setQuote([
      ...(highFee ? [t(`High cost: quoted fees are ${feePercent}% of the amount. Consider another destination or a larger transfer.`,`费用较高：报价费用占转出数量的 ${feePercent}%。可比较其他目标链或增大金额。`)] : []),
      t(`Send ${result.amount} USDC from Arc to ${result.destination.chain}.`,`从 Arc 向 ${result.destination.chain} 跨链 ${result.amount} USDC。`),
      t(`Estimated destination amount based on reported fees: ${formatUnits(received,6)} USDC`,`按已报告费用估算目标链到账：${formatUnits(received,6)} USDC`),
      t(`Reported fees: ${feeLines.length ? feeLines.join(' · ') : 'none reported'}`,`已报告费用：${feeLines.length ? feeLines.join(' · ') : '未报告'}`),
      t(`Network gas estimates: ${gasLines.length ? gasLines.join(' · ') : 'none reported'}`,`网络 Gas 估算：${gasLines.length ? gasLines.join(' · ') : '未报告'}`),
      ...(bridgeSpender ? [t(`First wallet request: increase Arc USDC allowance by ${result.amount} USDC for Circle CCTP TokenMessenger ${bridgeSpender}.`,`钱包首笔请求：向 Circle CCTP TokenMessenger ${bridgeSpender} 增加 ${result.amount} USDC 的 Arc USDC 授权额度。`)] : []),
      destinationIsForwarded(selectedChain()) ? t('Circle Forwarder handles destination mint; its quoted fee is included above.','Circle 转发服务负责目标链铸造；其报价费用已计入上方数据。') : t('A destination wallet transaction and gas may also be needed.','目标链钱包可能还需签署交易并支付 Gas。'),
      ...(result.warnings || []).map(item=>item.message || item.code),
      t('Final fees may change before signing.','签名前最终费用可能变化。'),
    ].join('\n'),false,highFee);
    updateButton();
}
async function chooseWallet() {
  if (working || pendingRecord()) { setStatus(t('Review the current transfer before changing wallets.','切换钱包前请先核对当前跨链记录。')); return; }
  const choice=await pickWallet(language);
  if (!choice) return;
  try {
    const accounts=await choice.provider.request({method:'eth_requestAccounts'});
    if (!accounts?.length) throw Error('Wallet returned no account.');
    await useWallet(choice.provider,accounts[0]);
  } catch (error) { setStatus(cleanError(error)); }
}
async function useWallet(selectedProvider,address) {
  const nextAdapter=await createViemAdapterFromProvider({provider:selectedProvider});
  if (provider && walletAccountsChanged) provider.removeListener?.('accountsChanged',walletAccountsChanged);
  provider=selectedProvider;
  account=getAddress(address);
  resetQuote(); currentRecord=null; historyRecords=[]; serverRecords=[]; serverMore=false; serverPage=0; serverLoading=false; serverUnavailable=false;
  adapter=nextAdapter;
  renderLanguage();
  loadRecord();
  void loadServerHistory(true);
  updateButton();
  await readBalance();
  renderRecipient();
  scheduleQuote();
  walletAccountsChanged=async accounts => {
    resetQuote(); account=accounts?.[0] ? getAddress(accounts[0]) : null;
    balance=null; tokenBalance=null; currentRecord=null; historyRecords=[]; serverRecords=[]; serverMore=false; serverPage=0; serverLoading=false;
    $('balance').textContent=account ? 'Loading Arc balance…' : 'Connect to see Arc USDC balance';
    if (account) { loadRecord(); void loadServerHistory(true); await readBalance(); }
    if (!account) language='en';
    if (!account) { renderRecord(); renderHistory(); }
    renderLanguage(); renderRecipient(); scheduleQuote(); updateButton();
  };
  provider.on?.('accountsChanged',walletAccountsChanged);
}
function recordEvent(payload) {
  if (!currentRecord || !['pending','unknown'].includes(currentRecord.state)) return;
  const name=String(payload?.method || payload?.name || 'bridge');
  const hash=payload?.values?.txHash || payload?.txHash;
  if (!/^0x[0-9a-f]{64}$/i.test(hash || '')) return;
  const events=[...(currentRecord.events || []),{name,txHash:hash}];
  saveRecord({...currentRecord,events:events.slice(-12)});
}
kit.on('*',recordEvent);
async function startBridge() {
  if (working || pendingRecord() || !estimate || Date.now()-estimatedAt>=60000) { scheduleQuote(); return; }
  const chain=selectedChain();
  if (!chain || !validRecipient(chain) || !validAmount(amountValue()) || !account) return;
  let needsFeeReview=false;
  working=true; updateButton(); setStatus('Checking Arc network and wallet before requesting a signature…');
  try {
    const accounts=await provider.request({method:'eth_accounts'});
    if (!accounts?.some(item=>same(item,account))) throw Error('Wallet account changed. Reconnect first.');
    const currentChain=await provider.request({method:'eth_chainId'});
    if (Number.parseInt(currentChain,16)!==ARC_ID) await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x13b2'}]});
    if (Number.parseInt(await provider.request({method:'eth_chainId'}),16)!==ARC_ID) throw Error('Switch the wallet to Arc before continuing.');
    await readBalance();
    if (balance===null || tokenBalance===null || parseUnits(amountValue(),6)>tokenBalance || parseEther(amountValue())>=balance) throw Error('Arc USDC balance is insufficient after reserving gas.');
    const chosen=params(chain);
    const refreshed=await kit.estimate(chosen);
    if (refreshed.fees.some(item=>item.error || item.amount===null) || (destinationIsForwarded(chain) && !refreshed.fees.some(item=>item.type==='forwarder' && item.amount!==null))) throw Error('Current fee quote is incomplete. No wallet signature requested.');
    const freshArcGas=refreshed.gasFees.filter(item=>item.blockchain==='Arc').reduce((sum,item)=>sum+parseEther(item.fees?.fee || '0'),0n);
    if (refreshed.gasFees.some(item=>item.error || !item.fees) || balance < parseEther(chosen.amount)+freshArcGas) throw Error('Arc USDC balance no longer covers the transfer and estimated network gas.');
    const priorFees=new Map(estimate.fees.map(item=>[`${item.type}:${item.token}`,item]));
    const feesNotWorse=refreshed.fees.length===estimate.fees.length && refreshed.fees.every(item=>{
      const previous=priorFees.get(`${item.type}:${item.token}`);
      return previous && item.token==='USDC' && parseUnits(item.amount,6)<=parseUnits(previous.amount,6);
    });
    const priorGas=new Map(estimate.gasFees.map(item=>[`${item.blockchain}:${item.name}:${item.token}`,item]));
    const gasNotWorse=refreshed.gasFees.length===estimate.gasFees.length && refreshed.gasFees.every(item=>{
      const previous=priorGas.get(`${item.blockchain}:${item.name}:${item.token}`);
      return previous && item.token==='USDC' && parseEther(item.fees.fee)<=parseEther(previous.fees.fee);
    });
    if (!feesNotWorse || !gasNotWorse) {
      setStatus(t('Fees increased. Review the refreshed quote, then click once more.','费用上涨。请核对刷新后的报价，再点击一次。'));
      acceptQuote(refreshed);
      needsFeeReview=true;
      return;
    }
    estimate=refreshed;
    saveRecord({id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,state:'pending',account,amount:chosen.amount,destination:chain.name,recipient:destinationAddress(chain),forwarded:destinationIsForwarded(chain),createdAt:Date.now(),events:[]});
    setStatus('Follow the wallet prompts. The SDK continues through approval, source transfer, attestation, and mint.');
    const result=await kit.bridge({...chosen,quote:estimate.quote});
    saveRecord({...currentRecord,state:result.state,result});
    setStatus(currentRecord.approvalRejected ? t('Approval declined. No transaction hash was saved here; check wallet activity before retrying.','授权已拒绝。这里未保存交易哈希，再次尝试前请核对钱包记录。') : result.state==='success' ? t('Circle Bridge Kit reports completion. Verify destination arrival independently.','Circle Bridge Kit 报告完成；请独立核验目标链到账。') : t('The transfer needs review. Do not start another source transfer until you check its status.','这笔跨链需要核查。确认状态前请勿重新发起源链转账。'));
    await readBalance();
  } catch (error) {
    // Once the SDK has been called, an ambiguous wallet/network failure must not
    // silently reopen the send button. A stored result can be retried instead.
    if (currentRecord?.state==='pending') {
      const rejected=Number(error?.code)===4001 && !hasRecordedHash(currentRecord);
      saveRecord({...currentRecord,state:rejected ? 'cancelled' : 'unknown',errorMessage:cleanError(error)});
    }
    setStatus(`${cleanError(error)} Check the saved transfer before sending again.`);
  } finally { working=false; if (needsFeeReview) updateButton(); else if (currentRecord?.state==='cancelled') scheduleQuote(); else { resetQuote(); setQuote(currentRecord?.state==='success' ? t('This transfer is complete. Start a separate transfer below to get a new quote.','本笔跨链已完成。若需再次跨链，请在下方发起新的一笔并重新获取报价。') : t('Review the current transfer before requesting another quote.','重新报价前请先核对当前跨链记录。')); } renderRecord(); }
}
async function retryBridge() {
  if (working || currentRecord?.state!=='error' || !currentRecord.result || !account || !same(currentRecord.account,account)) return;
  working=true; updateButton(); setStatus('Resuming the saved Circle transfer. No new bridge is being created.');
  try {
    const result=await kit.retry(currentRecord.result,{from:adapter,...(!currentRecord.forwarded ? {to:adapter} : {})});
    saveRecord({...currentRecord,state:result.state,result});
    setStatus(result.state==='success' ? 'Destination mint completed.' : 'The saved transfer is still incomplete.');
    await readBalance();
  } catch (error) { setStatus(cleanError(error)); }
  finally { working=false; updateButton(); }
}

renderChains();
$('wallet-button').addEventListener('click',()=>void chooseWallet());
$('destination').addEventListener('change',()=>{renderChainTrigger();renderRecipient();scheduleQuote();});
$('destination-trigger').addEventListener('click',()=>{
  if ($('destination-panel').hidden) openChainPicker(); else closeChainPicker();
});
$('destination-search').addEventListener('input',renderChainOptions);
$('destination-panel').addEventListener('keydown',event=>{
  if (event.key==='Escape') { closeChainPicker(); $('destination-trigger').focus(); return; }
  const options=[...$('destination-options').querySelectorAll('button')];
  if (!options.length) return;
  if (event.key==='ArrowDown' || event.key==='ArrowUp') {
    event.preventDefault();
    const index=options.indexOf(document.activeElement);
    const next=index<0 ? (event.key==='ArrowDown'?0:options.length-1) : (index+(event.key==='ArrowDown'?1:options.length-1))%options.length;
    options[next].focus();
  } else if (event.key==='Enter' && document.activeElement===$('destination-search')) {
    event.preventDefault(); options[0].click();
  }
});
document.addEventListener('pointerdown',event=>{
  if (!$('destination-panel').hidden && !event.target.closest('.chain-picker')) closeChainPicker();
});
$('amount').addEventListener('input',scheduleQuote);
$('recipient').addEventListener('input',scheduleQuote);
$('bridge-button').addEventListener('click',()=>void startBridge());
$('retry-button').addEventListener('click',()=>void retryBridge());
$('new-transfer-button').addEventListener('click',startNewTransfer);
$('history-more').addEventListener('click',()=>void loadServerHistory());
$('transfer-history').addEventListener('toggle',()=>{if ($('transfer-history').open && account && !serverRecords.length) void loadServerHistory(true);});
for (const [id,value] of [['lang-en','en'],['lang-zh','zh-CN']]) $(id).addEventListener('click',()=>{if (!account) return; language=value;renderLanguage();scheduleQuote();renderRecord();});
renderLanguage();
updateButton();
setInterval(()=>{if (account && !document.hidden && currentRecord?.state==='success' && !serverRecords.some(item=>item.status==='arrived' && same(item.source_hash,burnHash(currentRecord)))) void loadServerHistory(true);},30000);
