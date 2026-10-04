import {BrowserProvider, Contract, Interface, ZeroAddress, formatEther, getAddress, parseEther} from 'ethers';
import {V4Planner, Actions, URVersion} from '@uniswap/v4-sdk';
import {rpc} from '../immediate-deploy/rpc.js';
import {classifyWalletSendError} from '../immediate-deploy/wallet-result.js';
import {arcFeeParams} from '../immediate-deploy/arc-fees.js';
import {bridgeView} from '../immediate-deploy/live.js';
import {chooseAsset, chooseDirection} from './search.js';
import {currentLanguage} from './locale.js';

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
let balanceData = null;
let busy = false;
let activeTab = 'buy';
let activeStep = 'buy';

function key(kind) { return `tevumi-journey-v1:${account?.toLowerCase()}:${kind}`; }
function record(kind) { try { return JSON.parse(localStorage.getItem(key(kind)) || 'null'); } catch { return {state:'unknown'}; } }
function save(kind, value) { localStorage.setItem(key(kind), JSON.stringify(value)); }
function clear(kind) { localStorage.removeItem(key(kind)); }
function status(kind, message) { $(`journey-${kind}-status`).textContent = message; }
function amount(value) {
  assert(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value) && parseEther(value) > 0n, 'Enter a positive amount with up to 18 decimal places.');
  return parseEther(value);
}
function setTab(tab) {
  activeTab = tab;
  document.body.dataset.view = tab;
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
    $(`journey-${tab}-card`).querySelector('.journey-actions').prepend($('journey-connect'));
    $(`journey-${tab}-card`).querySelector('.journey-card-heading').after($('journey-wallet'));
  }
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
async function walletOn(chainId) {
  assert(account && window.ethereum, 'Connect your wallet first.');
  const wanted = '0x' + chainId.toString(16);
  if (!same(await window.ethereum.request({method:'eth_chainId'}), wanted)) await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:wanted}]});
  const accounts = await window.ethereum.request({method:'eth_accounts'});
  assert(accounts?.length && same(getAddress(accounts[0]), account), 'Wallet account changed. Reconnect before continuing.');
  assert(same(await window.ethereum.request({method:'eth_chainId'}), wanted), 'Wallet network is not the selected chain.');
}
async function tx(kind, chainId, to, data, value=0n, extra={}) {
  await walletOn(chainId);
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
  save(kind,pending);
  const request = {from:account,to,data,value:'0x'+value.toString(16),gas:'0x'+(gasEstimate*12n/10n+1n).toString(16),chainId:'0x'+chainId.toString(16)};
  if (chainId === 56) request.gasPrice = '0x'+gasPrice.toString(16);
  else { request.maxFeePerGas = arcFees.maxFeePerGas; request.maxPriorityFeePerGas = arcFees.maxPriorityFeePerGas; }
  let hash;
  try { hash = await window.ethereum.request({method:'eth_sendTransaction',params:[request]}); }
  catch (error) {
    if (['rejected','not_submitted'].includes(classifyWalletSendError(error))) { clear(kind); throw Error('Wallet did not submit the transaction.'); }
    throw Error('Wallet result is still being checked. Do not submit again.');
  }
  assert(hashOk(hash), 'Wallet did not return a transaction hash. Do not submit again.');
  save(kind,{...pending,state:'submitted',hash});
  return hash;
}
async function verify(kind) {
  if (!account) return null;
  const item = record(kind);
  if (!item) return null;
  if (!hashOk(item.hash)) return item;
  const reader = readers[item.chainId];
  const [transaction,receipt] = await Promise.all([reader.getTransaction(item.hash),reader.getTransactionReceipt(item.hash)]);
  if (!transaction || !receipt) return item;
  assert(same(transaction.from,account) && same(transaction.to,item.to) && same(transaction.data,item.data) && transaction.value === BigInt(item.value), 'Saved transaction does not match the chain transaction.');
  if (receipt.status !== 1) { save(kind,{...item,state:'failed'}); return {...item,state:'failed'}; }
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
    // A successful router receipt alone is not enough to offer the next step.
    // Check the WOTR debit and the wallet's native-USDC increase in this block.
    if (item.usdcArrivalVerified !== true && item.minOut && item.amountIn && receipt.blockNumber > 0) {
      const transfers = new Interface(tokenAbi);
      let wotrSpent = 0n;
      for (const log of receipt.logs) {
        if (!same(log.address,A.arcWotr)) continue;
        try {
          const event = transfers.parseLog(log);
          if (event?.name === 'Transfer' && same(event.args.from,account) && same(event.args.to,A.poolManager)) wotrSpent += event.args.value;
        } catch { /* ignore unrelated WOTR events */ }
      }
      if (wotrSpent === BigInt(item.amountIn)) {
        try {
          const [before,after] = await Promise.all([
            reader.getBalance(account,receipt.blockNumber-1),reader.getBalance(account,receipt.blockNumber),
          ]);
          const received = after - before + receipt.gasUsed * receipt.gasPrice;
          if (received >= BigInt(item.minOut) && received > 0n) {
            item.usdcArrivalVerified = true;
            item.nativeUsdcReceived = received.toString();
          }
        } catch { /* keep the Portal link hidden until the historical balance can be checked */ }
      }
    }
  }
  const verified = {...item,state:'verified',block:receipt.blockNumber};
  save(kind,verified);
  return verified;
}
async function balances() {
  if (!account) return;
  const [bnbWotr,arcWotr,bnb,arcUsdc] = await Promise.all([
    new Contract(A.bnbWotr,tokenAbi,readers[56]).balanceOf(account),
    new Contract(A.arcWotr,tokenAbi,readers[5042]).balanceOf(account),
    readers[56].getBalance(account),readers[5042].getBalance(account),
  ]);
  balanceData = {bnb,bnbWotr,arcWotr,arcUsdc};
  renderLiveText();
}
function renderLiveText() {
  if (balanceData) {
    const {bnb,bnbWotr,arcWotr,arcUsdc} = balanceData;
    $('journey-balances').textContent = local(`BNB Chain: ${formatEther(bnb)} BNB · ${formatEther(bnbWotr)} WOTR\nArc: ${formatEther(arcWotr)} WOTR · ${formatEther(arcUsdc)} USDC for gas`,`BNB Chain：${formatEther(bnb)} BNB · ${formatEther(bnbWotr)} WOTR\nArc：${formatEther(arcWotr)} WOTR · ${formatEther(arcUsdc)} USDC 可支付 Gas`);
  }
  if (buyQuote) $('journey-buy-quote').textContent = local(`Estimated receive: ${formatEther(buyQuote.out)} WOTR\nMinimum receive: ${formatEther(buyQuote.minOut)} WOTR (1% slippage)\nEstimated pool impact: ${(buyQuote.impactBps/100).toFixed(2)}% · BNB block ${buyQuote.block}\nGas is charged separately. Quote expires after 60 seconds.`,`预计收到：${formatEther(buyQuote.out)} WOTR\n最低收到：${formatEther(buyQuote.minOut)} WOTR（1% 滑点）\n预计池子价格影响：${(buyQuote.impactBps/100).toFixed(2)}% · BNB 区块 ${buyQuote.block}\nGas 另计，报价 60 秒后失效。`);
  if (swapQuote) $('journey-swap-quote').textContent = local(`Estimated receive: ${formatEther(swapQuote.out)} native USDC\nMinimum receive: ${formatEther(swapQuote.minOut)} USDC (1% slippage)\nArc wallet: ${formatEther(swapQuote.tokenBalance)} WOTR · ${formatEther(swapQuote.usdcBalance)} USDC for gas\nApproval and gas are separate. Quote expires after 60 seconds.`,`预计收到：${formatEther(swapQuote.out)} 原生 USDC\n最低收到：${formatEther(swapQuote.minOut)} USDC（1% 滑点）\nArc 钱包：${formatEther(swapQuote.tokenBalance)} WOTR · ${formatEther(swapQuote.usdcBalance)} USDC 可支付 Gas\n授权与 Gas 另计，报价 60 秒后失效。`);
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
  const value = amount($('journey-wotr').value.trim());
  assert(value < 2n**128n, 'WOTR amount is too large for this pool.');
  const reader = readers[5042];
  const [network,routerCode,quoterCode,poolCode,tokenCode,tokenBalance,usdcBalance,tokenAllowance,permitAllowance,block] = await Promise.all([
    reader.getNetwork(),reader.getCode(A.router),reader.getCode(A.quoter),reader.getCode(A.poolManager),reader.getCode(A.arcWotr),
    new Contract(A.arcWotr,tokenAbi,reader).balanceOf(account),reader.getBalance(account),
    new Contract(A.arcWotr,tokenAbi,reader).allowance(account,A.permit2),
    new Contract(A.permit2,permitAbi,reader).allowance(account,A.arcWotr,A.router),reader.getBlock('latest'),
  ]);
  assert(network.chainId === 5042n && [routerCode,quoterCode,poolCode,tokenCode].every(code=>code!=='0x'), 'Arc swap contracts are unavailable.');
  assert(tokenBalance >= value, 'Not enough WOTR in this Arc wallet. Wait for bridge arrival.');
  assert(usdcBalance > 0n, 'Arc native USDC is needed for approval and swap gas.');
  const quoter = new Contract(A.quoter,quoterAbi,reader);
  const result = await quoter.quoteExactInputSingle.staticCall({poolKey,zeroForOne:false,exactAmount:value,hookData:'0x'});
  assert(result.amountOut > 0n, 'Arc pool returned no USDC quote.');
  const minOut = result.amountOut*99n/100n;
  const stage = tokenAllowance<value ? 'token' : permitAllowance.amount<value || permitAllowance.expiration<BigInt(block.timestamp+1200) ? 'permit' : 'swap';
  swapQuote = {value,out:result.amountOut,minOut,tokenBalance,usdcBalance,stage,at:Date.now()};
  renderLiveText();
  draw();
}
async function swap() {
  assert(swapQuote && Date.now()-swapQuote.at < 60000, 'Refresh the Arc quote before signing.');
  assert(amount($('journey-wotr').value.trim()) === swapQuote.value, 'Amount changed. Refresh the quote.');
  for (const kind of ['approve-token','approve-permit','swap']) assert(!record(kind) || ['failed','verified'].includes(record(kind).state), 'A prior transaction is being checked. Do not submit again.');
  const token = new Contract(A.arcWotr,tokenAbi,readers[5042]);
  const permit = new Contract(A.permit2,permitAbi,readers[5042]);
  const allowance = await token.allowance(account,A.permit2);
  if (allowance < swapQuote.value) {
    const data = new Interface(tokenAbi).encodeFunctionData('approve',[A.permit2,swapQuote.value]);
    const hash = await tx('approve-token',5042,A.arcWotr,data);
    status('swap',`WOTR approval submitted: ${hash}. Checking receipt…`);
    await readers[5042].waitForTransaction(hash,1,120000).catch(()=>null); await refreshAll(); await quoteSwap().catch(()=>null); return;
  }
  const allowance2 = await permit.allowance(account,A.arcWotr,A.router);
  const now = BigInt((await readers[5042].getBlock('latest')).timestamp);
  if (allowance2.amount < swapQuote.value || allowance2.expiration < now+1200n) {
    const deadline = now+3600n;
    const data = new Interface(permitAbi).encodeFunctionData('approve',[A.arcWotr,A.router,swapQuote.value,deadline]);
    const hash = await tx('approve-permit',5042,A.permit2,data);
    status('swap',`Permit2 approval submitted: ${hash}. Checking receipt…`);
    await readers[5042].waitForTransaction(hash,1,120000).catch(()=>null); await refreshAll(); await quoteSwap().catch(()=>null); return;
  }
  const old = swapQuote;
  await quoteSwap();
  assert(swapQuote.out >= old.minOut && swapQuote.value === old.value, 'Arc price changed. Review a fresh quote.');
  const planner = new V4Planner();
  planner.addSwapAction(Actions.SWAP_EXACT_IN_SINGLE,[{poolKey,zeroForOne:false,amountIn:old.value.toString(),amountOutMinimum:old.minOut.toString(),hookData:'0x'}],URVersion.V2_0);
  planner.addAction(Actions.SETTLE_ALL,[A.arcWotr,old.value.toString()]);
  planner.addAction(Actions.TAKE_ALL,[ZeroAddress,old.minOut.toString()]);
  const deadline = BigInt((await readers[5042].getBlock('latest')).timestamp+900);
  const data = new Interface(routerAbi).encodeFunctionData('execute',['0x10',[planner.finalize()],deadline]);
  await readers[5042].call({from:account,to:A.router,data});
  const hash = await tx('swap',5042,A.router,data,0n,{minOut:old.minOut.toString(),amountIn:old.value.toString()});
  swapQuote = null; status('swap',`Arc swap submitted: ${hash}. Checking the receipt…`); draw();
  await readers[5042].waitForTransaction(hash,1,120000).catch(()=>null); await refreshAll();
}
async function refreshAll() {
  if (!account) return;
  for (const kind of ['buy','approve-token','approve-permit','swap']) {
    try { await verify(kind); } catch (error) { status(kind==='buy'?'buy':'swap',cleanError(error)); }
  }
  const buyRecord = record('buy'), swapRecord = record('swap');
  if (buyRecord?.state === 'verified') status('buy',`Bought ${formatEther(BigInt(buyRecord.received))} WOTR · BNB transaction ${buyRecord.hash}`);
  else if (buyRecord?.state === 'failed') status('buy','Buy transaction failed on-chain. Refresh the quote before retrying.');
  else if (buyRecord) status('buy',`Buy transaction is being checked${buyRecord.hash ? ': '+buyRecord.hash : ''}. Do not submit again.`);
  const permitRecord = record('approve-permit'), tokenRecord = record('approve-token');
  if (swapRecord?.state === 'verified') status('swap',swapRecord.usdcArrivalVerified === true
    ? local(`Arc swap and USDC arrival verified in block ${swapRecord.block} · ${swapRecord.hash}`,`Arc 兑换与 USDC 到账已在区块 ${swapRecord.block} 核验 · ${swapRecord.hash}`)
    : local(`Arc swap confirmed in block ${swapRecord.block}; checking USDC arrival · ${swapRecord.hash}`,`Arc 兑换已在区块 ${swapRecord.block} 确认，正在核验 USDC 到账 · ${swapRecord.hash}`));
  else if (swapRecord?.state === 'failed') status('swap',local('Arc swap failed on-chain. Refresh the quote before retrying.','Arc 兑换链上失败。刷新报价后再试。'));
  else if (swapRecord) status('swap',local(`Arc swap is being checked${swapRecord.hash ? ': '+swapRecord.hash : ''}. Do not submit again.`,`正在核对 Arc 兑换${swapRecord.hash ? '：'+swapRecord.hash : ''}。请勿重复提交。`));
  else if (permitRecord?.state === 'failed') status('swap',local('Swap access approval failed on-chain. Refresh the quote before retrying.','兑换权限授权链上失败。刷新报价后再试。'));
  else if (permitRecord && permitRecord.state !== 'verified') status('swap',local(`Checking swap access approval${permitRecord.hash ? ': '+permitRecord.hash : ''}. Do not submit again.`,`正在核对兑换权限授权${permitRecord.hash ? '：'+permitRecord.hash : ''}。请勿重复提交。`));
  else if (permitRecord?.state === 'verified') status('swap',local('Swap access approval confirmed. Refresh the quote, then swap WOTR for USDC.','兑换权限授权已确认。刷新报价后，即可把 WOTR 兑换为 USDC。'));
  else if (tokenRecord?.state === 'failed') status('swap',local('WOTR approval failed on-chain. Refresh the quote before retrying.','WOTR 授权链上失败。刷新报价后再试。'));
  else if (tokenRecord && tokenRecord.state !== 'verified') status('swap',local(`Checking WOTR approval${tokenRecord.hash ? ': '+tokenRecord.hash : ''}. Do not submit again.`,`正在核对 WOTR 授权${tokenRecord.hash ? '：'+tokenRecord.hash : ''}。请勿重复提交。`));
  else if (tokenRecord?.state === 'verified') status('swap',local('WOTR approval confirmed. Refresh the quote, then approve swap access.','WOTR 授权已确认。刷新报价后，再授权兑换权限。'));
  try { await balances(); } catch { $('journey-balances').textContent = 'Balances are temporarily unavailable. Refresh later.'; }
  draw();
}
function draw() {
  const view = bridgeView();
  account = view.account || null;
  $('header-connect').hidden = Boolean(account);
  $('journey-wallet').textContent = account ? local(`Connected: ${account}`,`已连接：${account}`) : local('Connect your wallet to get started.','连接钱包即可开始。');
  $('journey-wallet').hidden = !account;
  $('journey-connect').hidden = Boolean(account);
  $('journey-buy-action').disabled = busy || !account || !buyQuote || Date.now()-buyQuote.at>60000 || Boolean(record('buy') && !['failed','verified'].includes(record('buy').state));
  $('journey-swap-action').disabled = busy || !account || !swapQuote || Date.now()-swapQuote.at>60000 || ['approve-token','approve-permit','swap'].some(kind=>record(kind) && !['failed','verified'].includes(record(kind).state));
  $('journey-swap-action').textContent = swapQuote?.stage === 'token' ? local('Approve WOTR','授权 WOTR') : swapQuote?.stage === 'permit' ? local('Approve swap access','授权兑换权限') : swapQuote?.stage === 'swap' ? local('Swap WOTR for USDC','兑换 WOTR 为 USDC') : local('Review approval','检查授权');
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
  $('journey-portal').hidden = !portalReady;
  $('journey-portal-title').textContent = local('USDC arrived on Arc','USDC 已到达 Arc');
  $('journey-portal-copy').textContent = local('Your swap is confirmed. Explore what you can do with USDC in Arc Portal. This opens a separate site; nothing is transferred automatically.','兑换已确认。前往 Arc Portal 探索 USDC 的用途。将打开独立网站，不会自动转移资产。');
  $('journey-portal-link').textContent = local('Explore USDC on Arc Portal ↗','前往 Arc Portal 探索 USDC ↗');
  for (const [step,done] of [['buy',record('buy')?.state==='verified'],['bridge',bridgeDone],['swap',record('swap')?.state==='verified']]) {
    $('journey-progress-'+step)?.classList.toggle('done',Boolean(done));
  }
  if (bridgeDone) $('journey-bridge-status').textContent = local('WOTR arrival on Arc is verified in your bridge history.','已在跨链记录中核验 WOTR 到达 Arc。');
  else if (view.assetId==='wotr' && view.records['send-bsc']?.hash) $('journey-bridge-status').textContent = local('BNB transfer submitted; waiting for verified Arc arrival.','BNB 跨链已提交，等待核验 Arc 到账。');
}
async function run(action, kind) {
  if (busy) return;
  busy = true; draw();
  try { await action(); }
  catch (error) { status(kind,cleanError(error)); }
  finally { busy = false; draw(); }
}
$('nav-buy').addEventListener('click',()=>setTab('buy'));
$('nav-bridge').addEventListener('click',()=>setTab('bridge'));
$('nav-swap').addEventListener('click',()=>setTab('swap'));
for (const step of ['buy','bridge','swap']) $(`journey-step-${step}`).addEventListener('click',()=>setStep(step));
$('journey-connect').addEventListener('click',()=>{$('connect').click();});
$('header-connect').addEventListener('click',()=>{$('connect').click();});
$('journey-open-bridge').addEventListener('click',()=>run(async()=>{await chooseAsset('wotr');await chooseDirection('bsc');setTab('bridge');$('asset-picker').scrollIntoView({behavior:'smooth'});},'bridge'));
$('journey-bnb').addEventListener('input',()=>{buyQuote=null;renderLiveText();draw();});
$('journey-wotr').addEventListener('input',()=>{swapQuote=null;renderLiveText();draw();});
$('journey-buy-refresh').addEventListener('click',()=>run(quoteBuy,'buy'));
$('journey-buy-action').addEventListener('click',()=>run(buy,'buy'));
$('journey-swap-refresh').addEventListener('click',()=>run(quoteSwap,'swap'));
$('journey-swap-action').addEventListener('click',()=>run(swap,'swap'));
window.addEventListener('tevumi:bridge-view',()=>{const before=account;draw();if (account!==before){buyQuote=null;swapQuote=null;balanceData=null;renderLiveText();$('journey-balances').textContent=local('Live balances appear here after connection.','连接后将在这里显示实时余额。');draw();if(account)void refreshAll();}});
window.addEventListener('tevumi:locale-change',()=>{renderLiveText();draw();});
setInterval(()=>{if(account && !busy && !document.hidden) void refreshAll();},30000);
draw();
setTab(activeTab);
setStep(activeStep);
