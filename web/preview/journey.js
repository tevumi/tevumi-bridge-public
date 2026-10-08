import {BrowserProvider, Contract, Interface, ZeroAddress, formatEther, getAddress, parseEther} from 'ethers';
import {buildSwapPlan, verifySwapReceipt, swapAssets} from './swap-plan.js';
import {rpc} from '../immediate-deploy/rpc.js';
import {classifyWalletSendError} from '../immediate-deploy/wallet-result.js';
import {arcFeeParams} from '../immediate-deploy/arc-fees.js';
import {bridgeView,selectedWalletProvider} from '../immediate-deploy/live.js';
import {chooseAsset, chooseDirection} from './search.js';
import {currentLanguage} from './locale.js';
import {renderWalletButton} from './wallet-picker.js';

const $ = id => document.getElementById(id);
const A = Object.freeze({
  bnbWotr: getAddress('0xB97b99cB6DC0EdBB89512e14100B2e9C23132eE5'),
  arcWotr: getAddress('0x70Cedd901366ad932203BBB08B22DcD4d4510028'),
  pair: getAddress('0x36092BCf2B17808469ac92ee0f1a9a2cb71dBA87'),
  pancake: getAddress('0x10ED43C718714eb63d5aA57B78B54704E256024E'),
  wbnb: getAddress('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'),
  quoter: getAddress('0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94'),
  router: getAddress('0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1'),
  permit2: getAddress('0x000000000022D473030F116dDEE9F6B43aC78BA3'),
  poolManager: getAddress('0x8366a39CC670B4001A1121B8F6A443A643e40951'),
});
const pairAbi = ['function token0() view returns(address)', 'function token1() view returns(address)', 'function getReserves() view returns(uint112,uint112,uint32)'];
const pancakeAbi = ['function WETH() view returns(address)', 'function getAmountsOut(uint256,address[]) view returns(uint256[])', 'function swapExactETHForTokens(uint256,address[],address,uint256) payable returns(uint256[])'];
const tokenAbi = ['function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)', 'function approve(address,uint256) returns(bool)', 'event Transfer(address indexed from,address indexed to,uint256 value)'];
const permitAbi = ['function allowance(address,address,address) view returns(uint160 amount,uint48 expiration,uint48 nonce)', 'function approve(address,address,uint160,uint48)'];
const quoterAbi = ['function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData)) returns(uint256 amountOut,uint256 gasEstimate)'];
const routerAbi = ['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable'];
const poolKey = {currency0:ZeroAddress,currency1:A.arcWotr,fee:3000,tickSpacing:60,hooks:ZeroAddress};
const readers = {56:new BrowserProvider({request:({method,params=[]})=>rpc(56,method,params)}),5042:new BrowserProvider({request:({method,params=[]})=>rpc(5042,method,params)})};
const hashOk = value => /^0x[0-9a-f]{64}$/i.test(value || '');
const same = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
const assert = (condition, message) => { if (!condition) throw Error(message); };
const cleanError = error => String(error?.shortMessage || error?.message || error).replace(/https?:\/\/\S+/g,'[RPC]').slice(0,230);
const local = (en,zh) => currentLanguage() === 'zh-CN' ? zh : en;
let account = null;
let buyQuote = null;
let swapQuote = null;
let reverseSwap = false;
let balanceData = null;
let balanceError = false;
let balanceRequest = 0;
let busy = false;
let swapProgress = '';
let activeTab = 'buy';
let activeStep = 'buy';

function key(kind,owner=account) { return `tevumi-journey-v1:${owner?.toLowerCase()}:${kind}`; }
function record(kind) { try { return JSON.parse(localStorage.getItem(key(kind)) || 'null'); } catch { return {state:'unknown'}; } }
function save(kind, value,owner=account) { localStorage.setItem(key(kind,owner), JSON.stringify(value)); }
function clear(kind,owner=account) { localStorage.removeItem(key(kind,owner)); }
function status(kind, message) { $(`journey-${kind}-status`).textContent = message; }
function amount(value) {
  assert(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value) && parseEther(value) > 0n, 'Enter a positive amount with up to 18 decimal places.');
  return parseEther(value);
}
function setTab(tab) {
  const previousTab = activeTab;
  activeTab = tab;
  document.body.dataset.view = tab;
  window.dispatchEvent(new CustomEvent('tevumi:journey-tab',{detail:{tab}}));
  $('asset-picker').hidden = tab !== 'bridge';
  $('wotr-journey').hidden = tab === 'bridge';
  for (const item of ['buy','bridge','swap']) $(`context-${item}`).hidden = item !== tab;
  for (const item of ['buy','bridge','swap']) {
    const button = $(`nav-${item}`);
    if (item === tab) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  }
  if (tab !== 'bridge') {
    setStep(tab);
    $('journey-title').textContent = tab === 'buy' ? 'Buy' : 'Swap';
    $('journey-intro').textContent = tab === 'buy'
      ? local('Buy WOTR with BNB on BNB Chain. Review the live quote before confirming.','在 BNB Chain 使用 BNB 购买 WOTR。确认前请核对实时报价。')
      : local('Swap WOTR for native USDC on Arc. Review the live quote before confirming.','在 Arc 将 WOTR 兑换为原生 USDC。确认前请核对实时报价。');
    $(`journey-${tab}-card`).querySelector('.journey-card-heading').after($('journey-wallet'));
  }
  if (account && previousTab !== tab) void loadBalances();
  if (tab === 'swap') renderSwapDirection();
}
function setStep(step) {
  activeStep = step;
  for (const item of ['buy','bridge','swap']) {
    const selected = item === step;
    $(`journey-${item}-card`).hidden = !selected;
    $(`journey-route-${item}`).classList.toggle('active',selected);
    if (selected) $(`journey-step-${item}`).setAttribute('aria-current','step');
    else $(`journey-step-${item}`).removeAttribute('aria-current');
  }
}
async function walletOn(chainId,wallet=selectedWalletProvider()) {
  assert(account && wallet, 'Connect your wallet first.');
  const wanted = '0x' + chainId.toString(16);
  if (!same(await wallet.request({method:'eth_chainId'}), wanted)) await wallet.request({method:'wallet_switchEthereumChain',params:[{chainId:wanted}]});
  const accounts = await wallet.request({method:'eth_accounts'});
  assert(accounts?.length && same(getAddress(accounts[0]), account), 'Wallet account changed. Reconnect before continuing.');
  assert(same(await wallet.request({method:'eth_chainId'}), wanted), 'Wallet network is not the selected chain.');
}
async function tx(kind, chainId, to, data, value=0n, extra={}, guard=()=>{}) {
  const transactionAccount = account;
  const wallet=selectedWalletProvider();
  await walletOn(chainId,wallet);
  guard();
  const reader = readers[chainId];
  const nonce = await reader.getTransactionCount(account, 'pending');
  let gasEstimate;
  try { gasEstimate = await reader.estimateGas({from:account,to,data,value}); }
  catch (error) {
    if (chainId !== 5042) throw error;
    // Some Arc RPCs cannot estimate these calls even when eth_call succeeds.
    // Simulate the exact call and use a bounded limit checked against balance.
    await reader.call({from:account,to,data,value});
    gasEstimate = kind === 'swap' ? 500000n : kind === 'approve-permit' ? 150000n : 120000n;
  }
  assert(gasEstimate >= 21000n && gasEstimate < 2_000_000n, 'Transaction gas estimate is outside the expected range.');
  const fee = await reader.getFeeData();
  const gasPrice = fee.gasPrice ?? BigInt(await reader.send('eth_gasPrice',[]));
  const block = chainId === 5042 ? await reader.getBlock('latest') : null;
  const arcFees = chainId === 5042 ? arcFeeParams(gasPrice,block.baseFeePerGas,fee.maxPriorityFeePerGas ?? 0n) : null;
  const maxGasPrice = chainId === 56 ? gasPrice : arcFees.maximumPrice;
  assert(maxGasPrice > 0n, 'Network fee quote is unavailable.');
  assert(await reader.getBalance(account) > value + gasEstimate * 13n / 10n * maxGasPrice, 'Wallet lacks native coin for the amount and maximum estimated gas.');
  const pending = {state:'unknown',nonce,chainId,to,data,value:value.toString(),createdAt:Date.now(),...extra};
  guard();
  save(kind,pending,transactionAccount);
  const request = {from:account,to,data,value:'0x'+value.toString(16),gas:'0x'+(gasEstimate*12n/10n+1n).toString(16),chainId:'0x'+chainId.toString(16)};
  if (chainId === 56) request.gasPrice = '0x'+gasPrice.toString(16);
  else { request.maxFeePerGas = arcFees.maxFeePerGas; request.maxPriorityFeePerGas = arcFees.maxPriorityFeePerGas; }
  let hash;
  try { hash = await wallet.request({method:'eth_sendTransaction',params:[request]}); }
  catch (error) {
    if (['rejected','not_submitted'].includes(classifyWalletSendError(error))) { clear(kind,transactionAccount); throw Error(local('Wallet did not submit the transaction.','钱包未提交交易。')); }
    throw Error('Wallet result is still being checked. Do not submit again.');
  }
  assert(hashOk(hash), 'Wallet did not return a transaction hash. Do not submit again.');
  save(kind,{...pending,state:'submitted',hash},transactionAccount);
  if (kind === 'buy' || kind === 'swap') window.dispatchEvent(new CustomEvent('tevumi:journey-hash',{detail:{kind,hash}}));
  guard();
  return hash;
}
async function verify(kind) {
  if (!account) return null;
  const verificationAccount = account;
  const item = record(kind);
  if (!item) return null;
  if (item.state === 'verified' && (kind !== 'swap' || item.outputVerified === true || item.usdcArrivalVerified === true && item.direction !== 'usdc-to-wotr')) return item;
  if (item.state === 'failed') return item;
  if (!hashOk(item.hash)) return item;
  const reader = readers[item.chainId];
  const [transaction,receipt] = await Promise.all([reader.getTransaction(item.hash),reader.getTransactionReceipt(item.hash)]);
  if (!transaction || !receipt) return item;
  assert(same(transaction.from,verificationAccount) && same(transaction.to,item.to) && same(transaction.data,item.data) && transaction.value === BigInt(item.value), 'Saved transaction does not match the chain transaction.');
  if (receipt.status !== 1) { save(kind,{...item,state:'failed'},verificationAccount); return {...item,state:'failed'}; }
  if (kind === 'buy') {
    let received = 0n;
    const iface = new Interface(tokenAbi);
    for (const log of receipt.logs) {
      if (!same(log.address,A.bnbWotr)) continue;
      try { const event = iface.parseLog(log); if (event?.name === 'Transfer' && same(event.args.from,A.pair) && same(event.args.to,account)) received += event.args.value; } catch { /* ignore other logs */ }
    }
    assert(received >= BigInt(item.minOut) && received > 0n, 'WOTR receipt does not show the minimum tokens received.');
    item.received = received.toString();
  }
  if (kind === 'swap') {
    const parsed = new Interface(routerAbi).parseTransaction({data:transaction.data,value:transaction.value});
    assert(parsed?.name === 'execute' && same(parsed.args.commands,'0x10'), 'Arc transaction is not the planned Uniswap v4 swap.');
    const reverse = item.direction === 'usdc-to-wotr';
    assert(item.amountIn && item.minOut, 'Saved swap amounts are unavailable. Check the transaction history.');
    const received = verifySwapReceipt(receipt,verificationAccount,reverse,BigInt(item.amountIn),BigInt(item.minOut));
    item.outputVerified = true;
    item.received = received.toString();
    item.usdcArrivalVerified = !reverse;
    if (!reverse) item.nativeUsdcReceived = received.toString();
  }
  const verified = {...item,state:'verified',block:receipt.blockNumber};
  save(kind,verified,verificationAccount);
  if (kind === 'buy' || kind === 'swap') window.dispatchEvent(new CustomEvent('tevumi:journey-hash',{detail:{kind,hash:item.hash}}));
  return verified;
}
async function balances(requestId) {
  if (!account) return;
  const requestedAccount = account;
  const [bnbWotr,arcWotr,bnb,arcUsdc] = await Promise.all([
    new Contract(A.bnbWotr,tokenAbi,readers[56]).balanceOf(requestedAccount),
    new Contract(A.arcWotr,tokenAbi,readers[5042]).balanceOf(requestedAccount),
    readers[56].getBalance(requestedAccount),readers[5042].getBalance(requestedAccount),
  ]);
  if (!same(account,requestedAccount) || requestId !== balanceRequest) return;
  balanceData = {bnb,bnbWotr,arcWotr,arcUsdc};
  balanceError = false;
  renderLiveText();
}
async function loadBalances() {
  const requestedAccount = account;
  if (!requestedAccount) return;
  const requestId = ++balanceRequest;
  try { await balances(requestId); } catch {
    if (!same(account,requestedAccount) || requestId !== balanceRequest) return;
    balanceData = null; balanceError = true; renderLiveText();
    $('journey-balances').textContent = local('Balances are temporarily unavailable. Refresh later.','余额暂不可用，请稍后刷新。');
  }
}
function displayBalance(value) {
  const exact = formatEther(value);
  const [whole,fraction=''] = exact.split('.');
  const shown = fraction.slice(0,8).replace(/0+$/,'');
  if (value > 0n && whole === '0' && !shown) return '<0.00000001';
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')}${shown ? '.'+shown : ''}`;
}
function renderBalances() {
  const ready = Boolean(account && balanceData);
  const unavailable = local('Balance temporarily unavailable','余额暂不可用');
  const pending = account ? local('Loading balance…','正在读取余额…') : '';
  const fallback = balanceError ? unavailable : pending;
  $('journey-buy-balance').textContent = ready ? local(`BNB Chain balance: ${displayBalance(balanceData.bnb)} BNB`,`BNB Chain 余额：${displayBalance(balanceData.bnb)} BNB`) : fallback;
  $('journey-buy-held').textContent = ready ? local(`BNB Chain WOTR: ${displayBalance(balanceData.bnbWotr)} · Keep BNB for gas.`,`BNB Chain WOTR：${displayBalance(balanceData.bnbWotr)} · 请预留 BNB 支付 Gas。`) : '';
  $('journey-swap-balance').textContent = ready ? local(`Arc balance: ${displayBalance(reverseSwap ? balanceData.arcUsdc : balanceData.arcWotr)} ${swapAssets(reverseSwap).input}`,`Arc 余额：${displayBalance(reverseSwap ? balanceData.arcUsdc : balanceData.arcWotr)} ${swapAssets(reverseSwap).input}`) : fallback;
  $('journey-swap-gas').textContent = ready ? local(`Arc native USDC balance: ${displayBalance(balanceData.arcUsdc)} · Keep some for gas.`,`Arc 原生 USDC 余额：${displayBalance(balanceData.arcUsdc)} · 请预留部分支付 Gas。`) : '';
}
function renderLiveText() {
  renderBalances();
  if (balanceData) {
    const {bnb,bnbWotr,arcWotr,arcUsdc} = balanceData;
    $('journey-balances').textContent = local(`BNB Chain: ${formatEther(bnb)} BNB · ${formatEther(bnbWotr)} WOTR\nArc: ${formatEther(arcWotr)} WOTR · ${formatEther(arcUsdc)} USDC for gas`,`BNB Chain：${formatEther(bnb)} BNB · ${formatEther(bnbWotr)} WOTR\nArc：${formatEther(arcWotr)} WOTR · ${formatEther(arcUsdc)} USDC 可支付 Gas`);
  }
  if (buyQuote) $('journey-buy-quote').textContent = local(`Estimated receive: ${formatEther(buyQuote.out)} WOTR\nMinimum receive: ${formatEther(buyQuote.minOut)} WOTR (1% slippage)\nEstimated pool impact: ${(buyQuote.impactBps/100).toFixed(2)}% · BNB block ${buyQuote.block}\nGas is charged separately. Quote expires after 60 seconds.`,`预计收到：${formatEther(buyQuote.out)} WOTR\n最低收到：${formatEther(buyQuote.minOut)} WOTR（1% 滑点）\n预计池子价格影响：${(buyQuote.impactBps/100).toFixed(2)}% · BNB 区块 ${buyQuote.block}\nGas 另计，报价 60 秒后失效。`);
  const units = swapAssets(reverseSwap);
  renderSwapDirection();
  if (swapQuote) $('journey-swap-quote').textContent = local(`Estimated receive: ${formatEther(swapQuote.out)} ${units.output}\nMinimum receive: ${formatEther(swapQuote.minOut)} ${units.output} (1% slippage)\nGas is charged separately. Quote expires after 60 seconds.`,`预计收到：${formatEther(swapQuote.out)} ${units.output}\n最低收到：${formatEther(swapQuote.minOut)} ${units.output}（1% 滑点）\nGas 另计，报价 60 秒后失效。`);
  else $('journey-swap-quote').textContent = account
    ? local(`Enter a ${units.input} amount, then refresh the Arc pool quote. Keep native USDC for gas.`,`输入 ${units.input} 数量并刷新 Arc 池报价，请预留原生 USDC 支付 Gas。`)
    : local('Connect your wallet, then refresh the Arc pool quote. Arc native USDC is needed for gas.','连接钱包后刷新 Arc 池报价。Arc 原生 USDC 用于支付 Gas。');
  $('journey-buy-out').textContent = buyQuote ? Number(formatEther(buyQuote.out)).toLocaleString(currentLanguage()==='zh-CN'?'zh-CN':'en-US',{maximumFractionDigits:6}) : '—';
  $('journey-swap-out').textContent = swapQuote ? Number(formatEther(swapQuote.out)).toLocaleString(currentLanguage()==='zh-CN'?'zh-CN':'en-US',{maximumFractionDigits:6}) : '—';
}
async function quoteBuy() {
  const value = amount($('journey-bnb').value.trim());
  const reader = readers[56], pair = new Contract(A.pair,pairAbi,reader), router = new Contract(A.pancake,pancakeAbi,reader);
  const [network,code,reserves,token0,token1,weth,output,block] = await Promise.all([
    reader.getNetwork(),reader.getCode(A.pair),pair.getReserves(),pair.token0(),pair.token1(),router.WETH(),router.getAmountsOut(value,[A.wbnb,A.bnbWotr]),reader.getBlock('latest'),
  ]);
  assert(network.chainId === 56n && code !== '0x' && same(weth,A.wbnb) && [token0,token1].some(t=>same(t,A.wbnb)) && [token0,token1].some(t=>same(t,A.bnbWotr)), 'BNB pool or router identity is unexpected.');
  const reserveBnb = same(token0,A.wbnb) ? reserves[0] : reserves[1];
  const reserveWotr = same(token0,A.bnbWotr) ? reserves[0] : reserves[1];
  assert(reserveBnb > 0n && reserveWotr > 0n && output[1] > 0n && output[1] < reserveWotr, 'Pool quote or reserves are unavailable.');
  const minOut = output[1]*99n/100n;
  const impactBps = Number((value*10000n)/(reserveBnb+value));
  buyQuote = {value,out:output[1],minOut,impactBps,block:block.number,at:Date.now()};
  renderLiveText();
  draw();
}
async function buy() {
  assert(buyQuote && Date.now()-buyQuote.at < 60000, 'Refresh the buy quote before signing.');
  assert(!record('buy') || ['failed','verified'].includes(record('buy').state), 'A prior buy transaction is being checked. Do not submit again.');
  const quoted = buyQuote;
  assert(amount($('journey-bnb').value.trim()) === quoted.value, 'Amount changed. Refresh the quote.');
  await quoteBuy();
  assert(buyQuote.out >= quoted.minOut, 'Price changed beyond the prior minimum. Refresh and review the quote.');
  const deadline = BigInt((await readers[56].getBlock('latest')).timestamp + 900);
  const data = new Interface(pancakeAbi).encodeFunctionData('swapExactETHForTokens',[quoted.minOut,[A.wbnb,A.bnbWotr],account,deadline]);
  const hash = await tx('buy',56,A.pancake,data,quoted.value,{minOut:quoted.minOut.toString()});
  buyQuote = null; status('buy',`BNB transaction submitted: ${hash}. Checking the receipt…`); draw();
  await readers[56].waitForTransaction(hash,1,120000).catch(()=>null);
  await refreshAll();
}
async function quoteSwap() {
  const quotedDirection = reverseSwap, quotedAccount = account;
  const value = amount($('journey-wotr').value.trim());
  assert(value < 2n**128n, 'Amount is too large for this pool.');
  const reader = readers[5042];
  const [network,routerCode,quoterCode,poolCode,tokenCode,tokenBalance,usdcBalance,tokenAllowance,permitAllowance,block] = await Promise.all([
    reader.getNetwork(),reader.getCode(A.router),reader.getCode(A.quoter),reader.getCode(A.poolManager),reader.getCode(A.arcWotr),
    new Contract(A.arcWotr,tokenAbi,reader).balanceOf(account),reader.getBalance(account),
    quotedDirection ? Promise.resolve(0n) : new Contract(A.arcWotr,tokenAbi,reader).allowance(account,A.permit2),
    quotedDirection ? Promise.resolve({amount:0n,expiration:0n}) : new Contract(A.permit2,permitAbi,reader).allowance(account,A.arcWotr,A.router),reader.getBlock('latest'),
  ]);
  assert(network.chainId === 5042n && [routerCode,quoterCode,poolCode,tokenCode].every(code=>code!=='0x'), 'Arc swap contracts are unavailable.');
  assert(quotedDirection ? usdcBalance > value : tokenBalance >= value, quotedDirection ? local('Keep enough native USDC for the amount and gas.','请留足兑换数量及 Gas 所需的原生 USDC。') : 'Not enough WOTR in this Arc wallet. Wait for bridge arrival.');
  assert(usdcBalance > 0n, 'Arc native USDC is needed for approval and swap gas.');
  const quoter = new Contract(A.quoter,quoterAbi,reader);
  const result = await quoter.quoteExactInputSingle.staticCall({poolKey,zeroForOne:quotedDirection,exactAmount:value,hookData:'0x'});
  assert(result.amountOut > 0n, 'Arc pool returned no output quote.');
  assert(quotedDirection === reverseSwap && same(account,quotedAccount), 'Wallet or direction changed. Refresh the quote.');
  const minOut = result.amountOut*99n/100n;
  assert(minOut > 0n, 'Amount is too small to set a minimum receipt.');
  const stage = quotedDirection ? 'swap' : tokenAllowance<value ? 'token' : permitAllowance.amount<value || permitAllowance.expiration<BigInt(block.timestamp+1200) ? 'permit' : 'swap';
  swapQuote = {reverse:quotedDirection,account:quotedAccount,value,out:result.amountOut,minOut,tokenBalance,usdcBalance,stage,at:Date.now()};
  renderLiveText();
  draw();
}
async function swap() {
  assert(swapQuote && Date.now()-swapQuote.at < 60000, 'Refresh the Arc quote before signing.');
  assert(amount($('journey-wotr').value.trim()) === swapQuote.value, 'Amount changed. Refresh the quote.');
  for (const kind of ['approve-token','approve-permit','swap']) assert(!record(kind) || ['failed','verified'].includes(record(kind).state), 'A prior transaction is being checked. Do not submit again.');
  const old = {...swapQuote};
  assert(old.reverse === reverseSwap && same(old.account,account), 'Wallet or direction changed. Refresh the quote.');
  const originalAccount = account, originalWallet = selectedWalletProvider();
  const guard = () => {
    assert(same(account,originalAccount) && selectedWalletProvider() === originalWallet, local('Wallet changed. Refresh the quote before continuing.','钱包已改变，请重新刷新报价。'));
    assert(reverseSwap === old.reverse, 'Direction changed. Refresh the quote.');
    assert(amount($('journey-wotr').value.trim()) === old.value, local('Amount changed. Refresh the quote.','数量已改变，请重新刷新报价。'));
  };
  const progress = (en,zh) => { swapProgress = local(en,zh); status('swap',swapProgress); draw(); };
  const approve = async (kind,to,data) => {
    guard();
    progress('Confirm approval in your wallet…','请在钱包确认授权…');
    const hash = await tx(kind,5042,to,data,0n,{},guard);
    progress('Confirming approval…','授权确认中…');
    const receipt = await readers[5042].waitForTransaction(hash,1,120000);
    guard();
    assert(receipt, local('Approval is still pending. Do not submit again.','授权仍待确认，请勿重复提交。'));
    const checked = await verify(kind);
    guard();
    assert(checked?.state === 'verified', local('Approval failed or could not be verified. Swap stopped.','授权失败或尚未核验，已停止兑换。'));
  };
  if (!old.reverse) {
    const token = new Contract(A.arcWotr,tokenAbi,readers[5042]);
    const permit = new Contract(A.permit2,permitAbi,readers[5042]);
    const allowance = await token.allowance(account,A.permit2);
    guard();
    if (allowance < old.value) {
      const data = new Interface(tokenAbi).encodeFunctionData('approve',[A.permit2,old.value]);
      await approve('approve-token',A.arcWotr,data);
      assert(await token.allowance(originalAccount,A.permit2) >= old.value, local('WOTR allowance is not confirmed. Swap stopped.','WOTR 授权额度尚未确认，已停止兑换。'));
    }
    const allowance2 = await permit.allowance(account,A.arcWotr,A.router);
    const now = BigInt((await readers[5042].getBlock('latest')).timestamp);
    guard();
    if (allowance2.amount < old.value || allowance2.expiration < now+1200n) {
      const deadline = now+3600n;
      const data = new Interface(permitAbi).encodeFunctionData('approve',[A.arcWotr,A.router,old.value,deadline]);
      await approve('approve-permit',A.permit2,data);
    }
  }
  progress('Checking the latest quote…','正在复核最新报价…');
  guard();
  await quoteSwap();
  guard();
  assert(swapQuote.stage === 'swap', local('Approval is not ready. Refresh the quote before continuing.','授权尚未就绪，请刷新报价后再试。'));
  assert(swapQuote.out >= old.minOut && swapQuote.value === old.value, local('Arc price changed beyond your minimum. Review the new quote before retrying.','Arc 价格变化已超出原最低到账，请核对新报价后再试。'));
  const deadline = BigInt((await readers[5042].getBlock('latest')).timestamp+900);
  const {data,value} = buildSwapPlan(old.reverse,old.value,old.minOut,deadline);
  await readers[5042].call({from:account,to:A.router,data,value});
  guard();
  progress('Confirm the swap in your wallet…','请在钱包确认兑换…');
  const hash = await tx('swap',5042,A.router,data,value,{direction:old.reverse ? 'usdc-to-wotr' : 'wotr-to-usdc',minOut:old.minOut.toString(),amountIn:old.value.toString()},guard);
  swapProgress = local('Confirming swap…','兑换确认中…');
  swapQuote = null; status('swap',`Arc swap submitted: ${hash}. Checking the receipt…`); draw();
  await readers[5042].waitForTransaction(hash,1,120000).catch(()=>null); await refreshAll();
}
async function refreshAll() {
  if (!account) return;
  for (const kind of ['buy','approve-token','approve-permit','swap']) {
    try { await verify(kind); } catch (error) { status(kind==='buy'?'buy':'swap',cleanError(error)); }
  }
  for (const kind of ['buy','swap']) { const item=record(kind); if (hashOk(item?.hash)) window.dispatchEvent(new CustomEvent('tevumi:journey-hash',{detail:{kind,hash:item.hash}})); }
  const buyRecord = record('buy'), swapRecord = record('swap');
  if (buyRecord?.state === 'verified') status('buy','');
  else if (buyRecord?.state === 'failed') status('buy','Buy transaction failed on-chain. Refresh the quote before retrying.');
  else if (buyRecord) status('buy',`Buy transaction is being checked${buyRecord.hash ? ': '+buyRecord.hash : ''}. Do not submit again.`);
  else status('buy','');
  const permitRecord = record('approve-permit'), tokenRecord = record('approve-token');
  if (swapRecord?.state === 'verified') status('swap',swapRecord.outputVerified === true
    ? ''
    : local(`Arc swap confirmed in block ${swapRecord.block}; checking swap output · ${swapRecord.hash}`,`Arc 兑换已在区块 ${swapRecord.block} 确认，正在核验兑换到账 · ${swapRecord.hash}`));
  else if (swapRecord?.state === 'failed') status('swap',local('Arc swap failed on-chain. Refresh the quote before retrying.','Arc 兑换链上失败。刷新报价后再试。'));
  else if (swapRecord) status('swap',local(`Arc swap is being checked${swapRecord.hash ? ': '+swapRecord.hash : ''}. Do not submit again.`,`正在核对 Arc 兑换${swapRecord.hash ? '：'+swapRecord.hash : ''}。请勿重复提交。`));
  else if (permitRecord?.state === 'failed') status('swap',local('Swap access approval failed on-chain. Refresh the quote before retrying.','兑换权限授权链上失败。刷新报价后再试。'));
  else if (permitRecord && permitRecord.state !== 'verified') status('swap',local(`Checking swap access approval${permitRecord.hash ? ': '+permitRecord.hash : ''}. Do not submit again.`,`正在核对兑换权限授权${permitRecord.hash ? '：'+permitRecord.hash : ''}。请勿重复提交。`));
  else if (permitRecord?.state === 'verified') status('swap',local('Approval confirmed. Refresh the quote to continue.','授权已确认，请刷新报价后继续。'));
  else if (tokenRecord?.state === 'failed') status('swap',local('WOTR approval failed on-chain. Refresh the quote before retrying.','WOTR 授权链上失败。刷新报价后再试。'));
  else if (tokenRecord && tokenRecord.state !== 'verified') status('swap',local(`Checking WOTR approval${tokenRecord.hash ? ': '+tokenRecord.hash : ''}. Do not submit again.`,`正在核对 WOTR 授权${tokenRecord.hash ? '：'+tokenRecord.hash : ''}。请勿重复提交。`));
  else if (tokenRecord?.state === 'verified') status('swap',local('WOTR approval confirmed. Refresh the quote to continue with approval and swap.','WOTR 授权已确认。刷新报价后，即可继续授权并兑换。'));
  await loadBalances();
  draw();
}
function draw() {
  const view = bridgeView();
  account = view.account || null;
  const pendingSwap = record('swap');
  if (pendingSwap && !['failed','verified'].includes(pendingSwap.state) && pendingSwap.direction) reverseSwap = pendingSwap.direction === 'usdc-to-wotr';
  $('header-connect').hidden = false;
  $('header-connect').disabled = busy || view.busy;
  renderWalletButton($('header-connect'),selectedWalletProvider(),account,document.documentElement.lang);
  $('journey-wallet').textContent = account ? local(`Connected: ${account}`,`已连接：${account}`) : local('Connect your wallet to get started.','连接钱包即可开始。');
  $('journey-wallet').hidden = !account;
  $('journey-buy-action').disabled = busy || !account || !buyQuote || Date.now()-buyQuote.at>60000 || Boolean(record('buy') && !['failed','verified'].includes(record('buy').state));
  $('journey-swap-action').disabled = busy || !account || !swapQuote || Date.now()-swapQuote.at>60000 || ['approve-token','approve-permit','swap'].some(kind=>record(kind) && !['failed','verified'].includes(record(kind).state));
  $('journey-swap-action').textContent = swapProgress || (reverseSwap || swapQuote?.stage === 'swap' ? local(`Swap ${swapAssets(reverseSwap).input} for ${swapAssets(reverseSwap).output}`,`兑换 ${swapAssets(reverseSwap).input} 为 ${swapAssets(reverseSwap).output}`) : local('Approve and swap','授权并兑换'));
  $('journey-wotr').disabled = busy;
  $('journey-swap-direction').disabled = busy || ['approve-token','approve-permit','swap'].some(kind=>record(kind) && !['failed','verified'].includes(record(kind).state));
  renderSwapDirection();
  $('journey-wotr').placeholder = local('Enter amount','输入数量');
  $('journey-buy-refresh').disabled = busy || !account;
  $('journey-swap-refresh').disabled = busy || !account;
  $('journey-buy-refresh').hidden = !account;
  $('journey-buy-action').hidden = !account;
  $('journey-swap-refresh').hidden = !account;
  $('journey-swap-action').hidden = !account;
  $('journey-open-bridge').disabled = busy;
  $('journey-route-buy').classList.toggle('done',record('buy')?.state==='verified');
  const bridgeDone = Boolean(view.assetId==='wotr' && view.records['send-bsc']?.deliveredHash);
  $('journey-route-bridge').classList.toggle('done',bridgeDone);
  $('journey-route-swap').classList.toggle('done',record('swap')?.state==='verified');
  const portalReady = Boolean(account && record('swap')?.state === 'verified' && record('swap')?.usdcArrivalVerified === true);
  $('journey-next').hidden = false;
  const savedSwap = portalReady ? record('swap') : null;
  const savedIn = /^\d+$/.test(savedSwap?.amountIn || '') ? `${displayBalance(BigInt(savedSwap.amountIn))} WOTR` : local('WOTR','WOTR');
  const savedOut = /^\d+$/.test(savedSwap?.nativeUsdcReceived || '') ? `${displayBalance(BigInt(savedSwap.nativeUsdcReceived))} USDC` : local('USDC','USDC');
  $('journey-portal-title').textContent = portalReady ? local('Saved swap: USDC arrived on Arc','历史兑换：USDC 已到达 Arc') : local('Explore USDC on Arc','探索 Arc 上的 USDC');
  $('journey-portal-details').textContent = portalReady ? local(`${savedIn} → ${savedOut} · Arc block ${savedSwap.block}`,`${savedIn} → ${savedOut} · Arc 区块 ${savedSwap.block}`) : '';
  $('journey-portal-copy').textContent = portalReady ? local('This saved result is separate from a new swap. Arc Portal opens separately and transfers nothing automatically.','这条历史结果与新兑换相互独立。Arc Portal 会在新页面打开，不会自动转移资产。') : local('Explore USDC options on Arc Portal. It opens separately and transfers nothing automatically.','前往 Arc Portal 了解 USDC 的用途。它会在新页面打开，不会自动转移资产。');
  $('journey-portal-link').textContent = local('Explore USDC on Arc Portal ↗','前往 Arc Portal 探索 USDC ↗');
  $('journey-usdc-title').textContent = local('Bridge USDC to another chain','将 USDC 跨往其他链');
  $('journey-usdc-copy').textContent = local('Choose a destination and review a live Circle App Kit quote. Nothing moves until you confirm in your wallet.','选择目标链并查看 Circle App Kit 实时报价。只有在钱包确认后才会转移资产。');
  $('journey-usdc-link').textContent = local('Bridge USDC ↗','跨链 USDC ↗');
  for (const [step,done] of [['buy',record('buy')?.state==='verified'],['bridge',bridgeDone],['swap',record('swap')?.state==='verified']]) {
    $('journey-progress-'+step)?.classList.toggle('done',Boolean(done));
  }
  if (bridgeDone) $('journey-bridge-status').textContent = local('WOTR arrival on Arc is verified in your bridge history.','已在跨链记录中核验 WOTR 到达 Arc。');
  else if (view.assetId==='wotr' && view.records['send-bsc']?.hash) $('journey-bridge-status').textContent = local('BNB transfer submitted; waiting for verified Arc arrival.','BNB 跨链已提交，等待核验 Arc 到账。');
}
function renderSwapDirection() {
  const {input,output} = swapAssets(reverseSwap);
  $('journey-swap-direction').textContent = local(`⇄ ${input} → ${output}`,`⇄ ${input} → ${output}`);
  $('journey-swap-direction').setAttribute('aria-label',local('Reverse swap direction','反转兑换方向'));
  $('journey-swap-card').querySelector('h3').textContent = local(`Swap ${input} for ${output} on Arc`,`在 Arc 将 ${input} 兑换为 ${output}`);
  $('journey-swap-card').querySelector('label[for="journey-wotr"]').textContent = local(`You sell · ${input}`,`卖出 · ${input}`);
  $('journey-swap-card').querySelector('.journey-input strong').textContent = input;
  $('journey-swap-card').querySelector('.journey-output span').textContent = output;
  if (activeTab === 'swap') $('journey-intro').textContent = local(`Swap ${input} for ${output === 'USDC' ? 'native USDC' : output} on Arc. Review the live quote before confirming.`,`在 Arc 将 ${input} 兑换为 ${output}。确认前请核对实时报价。`);
  const context = $('context-swap');
  context.querySelector('h3').textContent = local(`From ${input} to ${output}.`,`从 ${input} 到 ${output}。`);
  context.querySelector('.context-route strong').textContent = `${input} → ${output}`;
  context.querySelector('h3 + p').textContent = local(`Exchange ${input} for ${output} in the Arc pool. The output depends on the live quote.`,`在 Arc 池中将 ${input} 兑换为 ${output}。到账数量取决于实时报价。`);
}
async function run(action, kind) {
  if (busy) return;
  busy = true; draw();
  try { await action(); }
  catch (error) { status(kind,cleanError(error)); }
  finally { busy = false; swapProgress = ''; draw(); }
}
$('nav-buy').addEventListener('click',()=>setTab('buy'));
$('nav-bridge').addEventListener('click',()=>setTab('bridge'));
$('nav-swap').addEventListener('click',()=>setTab('swap'));
for (const step of ['buy','bridge','swap']) $(`journey-step-${step}`).addEventListener('click',()=>setStep(step));
$('header-connect').addEventListener('click',()=>{$('connect').click();});
$('journey-open-bridge').addEventListener('click',()=>run(async()=>{await chooseAsset('wotr');await chooseDirection('bsc');setTab('bridge');$('asset-picker').scrollIntoView({behavior:'smooth'});},'bridge'));
$('journey-bnb').addEventListener('input',()=>{buyQuote=null;renderLiveText();draw();});
$('journey-wotr').addEventListener('input',()=>{swapQuote=null;renderLiveText();draw();});
$('journey-buy-refresh').addEventListener('click',()=>run(quoteBuy,'buy'));
$('journey-buy-action').addEventListener('click',()=>run(buy,'buy'));
$('journey-swap-direction').addEventListener('click',()=>{if ($('journey-swap-direction').disabled) return; reverseSwap=!reverseSwap; swapQuote=null; $('journey-wotr').value=''; status('swap',''); renderLiveText(); draw();});
$('journey-swap-refresh').addEventListener('click',()=>run(quoteSwap,'swap'));
$('journey-swap-action').addEventListener('click',()=>run(swap,'swap'));
window.addEventListener('tevumi:bridge-view',()=>{const before=account;draw();if (account!==before){buyQuote=null;swapQuote=null;balanceData=null;balanceError=false;balanceRequest++;renderLiveText();$('journey-balances').textContent=local('Live balances appear here after connection.','连接后将在这里显示实时余额。');draw();if(account)void refreshAll();}});
window.addEventListener('tevumi:locale-change',()=>{renderLiveText();draw();});
setInterval(()=>{if(account && !busy && !document.hidden) void refreshAll();},30000);
if (new URLSearchParams(window.location.search).get('action') === 'swap') setTab('swap');
draw();
setTab(activeTab);
setStep(activeStep);
