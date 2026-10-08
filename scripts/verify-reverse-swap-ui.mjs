// Simulated wallet/RPC only. No real authorization or transaction broadcast.
import {chromium} from '@playwright/test';
import {Interface,parseEther} from 'ethers';
const origin=process.env.TEVUMI_BASE_URL || 'http://127.0.0.1:5322/preview/web/preview/';
const user='0x67bfb3BeF4f4A3Cb25Bc529E948d40bcfc0874CD';
const token='0x70Cedd901366ad932203BBB08B22DcD4d4510028';
const permit='0x000000000022D473030F116dDEE9F6B43aC78BA3';
const router='0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1';
const ti=new Interface(['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)']);
const pi=new Interface(['function allowance(address,address,address) view returns(uint160,uint48,uint48)','function approve(address,address,uint160,uint48)']);
const qi=new Interface(['function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData)) returns(uint256 amountOut,uint256 gasEstimate)']);
const pool=new Interface(['event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)']);
const transfers=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const manager='0x8366a39CC670B4001A1121B8F6A443A643e40951';
const poolId='0x0b98404b6f6df1c01ecb4a44b8c7e0c11b722585f91c5bc77dc9e7d294d278b4';
const hex=n=>'0x'+BigInt(n).toString(16), pad=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const browser=await chromium.launch({headless:true});
try {
 for(const mode of ['reverse-ready','reverse-reject','reverse-low-gas','reverse-pending','reverse-zh-mobile']) {
  const page=await browser.newPage({viewport:mode==='reverse-zh-mobile'?{width:390,height:844}:{width:1440,height:900}});
  let tokenAllowance=mode==='both'||mode==='failed-approval'?0n:parseEther('1000');
  let permitAllowance=mode==='ready'?parseEther('1000'):0n;
  let quoteOut=parseEther('190');
  const txs=new Map(), requests=[], errors=[];
  const swapLogs=[{address:manager,...pool.encodeEventLog('Swap',[poolId,router,-parseEther('0.01'),parseEther('190'),1,1,0,3000])},{address:token,...transfers.encodeEventLog('Transfer',[manager,user,parseEther('190')])}].map((log,index)=>({...log,index,transactionIndex:0,transactionHash:pad(1),blockHash:pad(101),blockNumber:101,removed:false}));
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>route.fulfill({json:{items:route.request().url().includes('kind=swap') ? [
    {kind:'swap',tx_hash:pad(1),input_asset:'USDC',output_asset:'WOTR',input_amount:parseEther('0.01').toString(),output_amount:parseEther('190').toString(),status:'verified',created_at:1791350000},
    {kind:'swap',tx_hash:pad(2),input_amount:parseEther('500').toString(),output_amount:parseEther('0.026').toString(),status:'verified',created_at:1791349000},
  ] : [],more:false}}));
  await page.exposeFunction('testWalletSend',async tx=>{
   const kind=tx.to.toLowerCase()===token.toLowerCase()?'token':tx.to.toLowerCase()===permit.toLowerCase()?'permit':'swap';
   requests.push(kind);
   if(mode==='reverse-reject'&&kind==='swap') return {rejected:true};
   const hash=pad(txs.size+1);
   txs.set(hash,{...tx,kind});
   if(mode!=='failed-approval') {
    if(kind==='token')tokenAllowance=parseEther('1000');
    if(kind==='permit')permitAllowance=parseEther('1000');
   }
   if(mode==='price-drop')quoteOut=parseEther('0.01');
   return {hash};
  });
  await page.addInitScript(address=>{
   const timeout=window.setTimeout.bind(window);
   window.setTimeout=(fn,ms,...args)=>timeout(fn,ms===350||ms===4000?10:ms,...args);
   const provider={isMetaMask:true,on:()=>{},removeListener:()=>{},request:async({method,params})=>{
    if(method==='eth_accounts'||method==='eth_requestAccounts')return[address];
    if(method==='eth_chainId')return'0x13b2';
    if(method==='eth_sendTransaction'){const r=await window.testWalletSend(params[0]);if(r.rejected)throw Object.assign(Error('Rejected'),{code:4001});return r.hash;}
    throw Error('UNEXPECTED_WALLET_METHOD_'+method);
   }};
   window.ethereum=provider;
   window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{name:'MetaMask',rdns:'io.metamask'},provider}})));
  },user);
  await page.route(/https:\/\/(rpc\.mainnet\.arc\.io|bsc[^/]*|bsc-dataseed[^/]*)\//,async route=>{
   const req=route.request().postDataJSON(), chain=route.request().url().includes('arc.io')?5042:56;
   const block={number:'0x65',hash:pad(101),parentHash:pad(100),timestamp:hex(1791350000),nonce:'0x0000000000000000',difficulty:'0x0',gasLimit:'0x1c9c380',gasUsed:'0x5208',miner:user,extraData:'0x',transactions:[],baseFeePerGas:hex(1000000000)};
   let result;
   switch(req.method){
    case 'eth_chainId':result=hex(chain);break;
    case 'eth_blockNumber':result='0x65';break;
    case 'eth_getBlockByNumber':result=block;break;
    case 'eth_getCode':result='0x6000';break;
    case 'eth_getBalance':result=hex(parseEther(mode==='reverse-low-gas' ? '0.01001' : '60'));break;
    case 'eth_getTransactionCount':result=hex(txs.size);break;
    case 'eth_estimateGas':result='0x186a0';break;
    case 'eth_gasPrice':case 'eth_maxPriorityFeePerGas':result=hex(1000000000);break;
    case 'eth_getLogs':result=[];break;
    case 'eth_getTransactionReceipt':{
     const t=txs.get(req.params[0]);
     result=t?{transactionHash:req.params[0],transactionIndex:'0x0',blockHash:pad(101),blockNumber:'0x65',from:user,to:t.to,cumulativeGasUsed:'0x186a0',gasUsed:'0x186a0',effectiveGasPrice:hex(1000000000),logs:t.kind==='swap' ? swapLogs : [],logsBloom:'0x'+'0'.repeat(512),status:mode==='failed-approval'?'0x0':'0x1',type:'0x2',contractAddress:null}:null;break;
    }
    case 'eth_getTransactionByHash':{
     const t=txs.get(req.params[0]);result=t?{hash:req.params[0],blockHash:pad(101),blockNumber:'0x65',transactionIndex:'0x0',from:user,to:t.to,input:t.data,value:t.value,nonce:'0x0',gas:t.gas,gasPrice:hex(1000000000),maxFeePerGas:hex(2000000000),maxPriorityFeePerGas:'0x0',type:'0x2',chainId:hex(chain),v:'0x0',r:pad(1),s:pad(1)}:null;break;
    }
    case 'eth_call':{
     const c=req.params[0], selector=c.data.slice(0,10), to=c.to.toLowerCase();
     if(selector===qi.getFunction('quoteExactInputSingle').selector)result=qi.encodeFunctionResult('quoteExactInputSingle',[quoteOut,100000]);
     else if(selector===ti.getFunction('balanceOf').selector)result=ti.encodeFunctionResult('balanceOf',[parseEther('2000')]);
     else if(selector===ti.getFunction('allowance').selector&&to!==permit.toLowerCase())result=ti.encodeFunctionResult('allowance',[tokenAllowance]);
     else if(selector===pi.getFunction('allowance').selector&&to===permit.toLowerCase())result=pi.encodeFunctionResult('allowance',[permitAllowance,1791353600,0]);
     else if(selector===ti.getFunction('approve').selector)result=pad(1);
     else result=pad(0);
     break;
    }
    default:throw Error('UNHANDLED_RPC_'+req.method);
   }
   await route.fulfill({json:{jsonrpc:'2.0',id:req.id,result}});
  });
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.locator('#header-connect').click();
  await page.locator('.tevumi-wallet-option').first().click();
  if(mode==='reverse-zh-mobile')await page.locator('[data-language="zh-CN"]').click();
  await page.locator('#nav-swap').click();
  await page.locator('#journey-swap-direction').click();
  if (!(await page.locator('#journey-swap-card h3').textContent()).includes('USDC')) throw Error('MISSING_REVERSE_LABEL');
  await page.locator('#journey-wotr').fill('0.01');
  await page.locator('#journey-swap-refresh').click();
  await page.waitForFunction(()=>!document.querySelector('#journey-swap-action').disabled,{timeout:45000});
  if(mode==='reverse-ready') {
    await page.locator('#journey-swap-direction').click();
    if(await page.locator('#journey-wotr').inputValue() || await page.locator('#journey-swap-action').isEnabled())throw Error('DIRECTION_REUSED_OLD_QUOTE');
    await page.locator('#journey-swap-direction').click();
    await page.locator('#journey-wotr').fill('0.01');
    await page.locator('#journey-swap-refresh').click();
    await page.waitForFunction(()=>!document.querySelector('#journey-swap-action').disabled);
  }
  if(mode==='reverse-zh-mobile'&&await page.locator('#journey-swap-action').textContent()!=='兑换 USDC 为 WOTR')throw Error('CHINESE_ACTION_LABEL');
  await page.locator('#journey-swap-action').click();
  await page.waitForFunction(()=>!document.querySelector('#journey-wotr').disabled,{timeout:90000});
  const expected=['swap'];
  const status=await page.locator('#journey-swap-status').textContent();
  if(mode==='reverse-low-gas') {
    if(requests.length || !status.includes('lacks native coin')) throw Error('INSUFFICIENT_GAS_NOT_BLOCKED:'+status);
  } else if(JSON.stringify(requests)!==JSON.stringify(expected)) throw Error('REVERSE_REQUESTS:'+JSON.stringify(requests)+':'+status);
  if(mode==='reverse-reject' && !status.includes('did not submit'))throw Error('REJECTION_MISSING');
  if(txs.size) {
    const tx=[...txs.values()][0];
    if(BigInt(tx.value)!==parseEther('0.01'))throw Error('WRONG_NATIVE_PAYMENT');
    const stored=await page.evaluate(address=>JSON.parse(localStorage.getItem(`tevumi-journey-v1:${address.toLowerCase()}:swap`)),user);
    if(stored.direction!=='usdc-to-wotr')throw Error('WRONG_SAVED_DIRECTION');
  }
  if(mode==='reverse-ready' || mode==='reverse-zh-mobile') {
    await page.waitForFunction(address=>JSON.parse(localStorage.getItem(`tevumi-journey-v1:${address.toLowerCase()}:swap`))?.outputVerified===true,user,{timeout:45000});
    if((await page.locator('#journey-portal-title').textContent()).includes('arrived'))throw Error('REVERSE_SHOWED_USDC_ARRIVAL');
    await page.locator('#journey-swap-history summary').click();
    await page.waitForFunction(()=>document.querySelectorAll('#journey-swap-history .history-card').length===2);
    const cards=await page.locator('#journey-swap-history .history-card').allTextContents();
    if(!cards[0].includes('USDC → WOTR') || !cards[0].includes('0.01 USDC → 190.0 WOTR') || !cards[1].includes('WOTR → USDC'))throw Error('WRONG_HISTORY_DIRECTION:'+cards.join('|'));
  }
  if(mode==='reverse-pending') {
    await page.evaluate(address=>{const key=`tevumi-journey-v1:${address.toLowerCase()}:swap`;const saved=JSON.parse(localStorage.getItem(key));saved.state='unknown';delete saved.hash;delete saved.outputVerified;localStorage.setItem(key,JSON.stringify(saved));},user);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#nav-swap').click();
    await page.waitForFunction(()=>document.querySelector('#journey-swap-direction').disabled);
    if(requests.length!==1)throw Error('RELOADED_PENDING_RESUBMITTED');
  }
  if(mode==='reverse-zh-mobile' && await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('MOBILE_OVERFLOW');
  if(errors.length)throw Error(errors.join(','));
  await page.screenshot({path:`.local/reverse-swap-${mode}.png`,fullPage:true});
  console.log(JSON.stringify({mode,requests,status,passed:true}));
  await page.close();
 }
}finally{await browser.close();}
