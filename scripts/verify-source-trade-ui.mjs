// Synthetic wallet/RPC only; the real local order file is never modified.
import {chromium} from '@playwright/test';
import {Interface,AbiCoder,ZeroAddress,parseEther,zeroPadValue} from 'ethers';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {BUY,helperAbi} from '../web/preview/buy-plan.js';
import {candidateAppAbi} from '../web/src/production-transfer.js';
import {USDC,ROUTERS,bridgeType} from '../web/src/funding-validation.js';
import {wotrRoutes} from '../web/src/wotr-routes.js';
import {assertJournalUpdate} from '../web/source-trade/order.js';
const origin=process.env.TEVUMI_SOURCE_TRADE_URL||'http://127.0.0.1:5345/',user='0x'+'1'.repeat(40),pad=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),hex=n=>'0x'+BigInt(n).toString(16);
const iface=new Interface([...helperAbi,...candidateAppAbi,'function decimals() view returns(uint8)','function allowance(address,address) view returns(uint256)']);
const browser=await chromium.launch({headless:true});const report=[];
try{for(const mode of ['quote','reject','unknown-reload','mobile-zh','save-failure','seven-decimals','large-amount','journal-corrupt','quote-gateway','quote-gateway-zh']){
 const page=await browser.newPage({viewport:mode==='mobile-zh'?{width:390,height:844}:{width:1440,height:1000}}),errors=[];let chain=5042,sends=0,orders=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('testWallet',async req=>{if(req.method==='eth_accounts'||req.method==='eth_requestAccounts')return[user];if(req.method==='eth_chainId')return hex(chain);if(req.method==='wallet_switchEthereumChain'){chain=Number(BigInt(req.params[0].chainId));return null;}if(req.method==='eth_sendTransaction'){sends++;return {error:mode==='unknown-reload'?-32000:4001};}throw Error(req.method);});
 await page.addInitScript(corrupt=>{if(corrupt)localStorage.setItem('tevumi:source-trade:orders:v1','{broken');const provider={isMetaMask:true,on(){},request:async req=>{const r=await window.testWallet(req);if(r?.error)throw Object.assign(Error('Synthetic wallet rejection'),{code:r.error});return r;}};window.ethereum=provider;window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{name:'MetaMask',rdns:'io.metamask'},provider}})));},mode==='journal-corrupt');
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());let result;
  if(url.pathname==='/api/orders'){
   if(route.request().method()==='GET')result=orders;
   else{const o=route.request().postDataJSON(),previous=orders.find(v=>v.id===o.id);if(mode==='save-failure'&&o.transactions.length){await route.fulfill({status:502,json:{error:'Synthetic disk failure'}});return;}assertJournalUpdate(previous,o);orders=orders.filter(v=>v.id!==o.id);orders.unshift(o);result={saved:true};}
  }else if(url.pathname==='/api/lifi/quote'){
   if(mode.startsWith('quote-gateway')){await route.fulfill({status:502,json:{error:'Read service temporarily unavailable'}});return;}
   const from=Number(url.searchParams.get('fromChain')),to=Number(url.searchParams.get('toChain')),amount=BigInt(url.searchParams.get('fromAmount'));
   const b=[pad(1),'relaydepository','',ZeroAddress,from===5042?USDC:ZeroAddress,user,amount,to,false,false];
   result={tool:'relaydepository',action:{fromChainId:from,toChainId:to,fromAddress:user,toAddress:user,fromAmount:String(amount),fromToken:{address:from===5042?USDC:ZeroAddress,decimals:from===5042?6:18},toToken:{address:to===5042?USDC:ZeroAddress,decimals:to===5042?6:18}},estimate:{toAmount:String(parseEther('0.0013')),toAmountMin:String(parseEther('0.00129')),approvalAddress:ROUTERS[from],feeCosts:[],gasCosts:[]},transactionRequest:{to:ROUTERS[from],from:user,chainId:from,value:'0',data:'0x12345678'+AbiCoder.defaultAbiCoder().encode([bridgeType],[b]).slice(2)}};
  }else if(url.pathname.startsWith('/api/rpc/')){
   const req=route.request().postDataJSON(),network=Number(url.pathname.split('/').pop());let value;
   if(req.method==='eth_chainId')value=hex(network);else if(req.method==='eth_getCode')value='0x6000';else if(req.method==='eth_getBalance')value=hex(parseEther('100'));else if(req.method==='eth_getTransactionCount')value='0x1';else if(req.method==='eth_blockNumber')value='0x65';else if(req.method==='eth_getTransactionReceipt'||req.method==='eth_getTransactionByHash')value=null;
   else if(req.method==='eth_estimateGas')value=hex(100000);else if(req.method==='eth_gasPrice'||req.method==='eth_maxPriorityFeePerGas')value='0xf4240';
   else if(req.method==='eth_getBlockByNumber')value={number:'0x65',hash:pad(101),parentHash:pad(100),timestamp:hex(1791510000),nonce:'0x0000000000000000',difficulty:'0x0',gasLimit:'0x1c9c380',gasUsed:'0x5208',miner:user,extraData:'0x',transactions:[],baseFeePerGas:'0xf4240'};
   else if(req.method==='eth_call'){
    let decoded;try{decoded=iface.parseTransaction({data:req.params[0].data})}catch{}
    if(!decoded)value='0x';else{let values;const n=decoded.name;
     if(n==='getTokenInfo')values=[2n,BUY.manager,ZeroAddress,4000000000n,100n,0n,0n,parseEther('800000000'),parseEther('800000000'),0n,parseEther('13.9'),false];
     else if(n==='tryBuy'){const budget=decoded.args[2];values=[BUY.manager,ZeroAddress,parseEther('1000000'),budget*100n/101n,budget/101n,budget,0n,budget];}
     else if(n==='quoteSend')values=[[parseEther('0.00034'),0n]];
     else if(n==='allowance')values=[orders[0]?BigInt(orders[0].input):1000000n];
     else if(n==='balanceOf')values=[parseEther('1000')];else throw Error('Unexpected test read '+n);
     value=iface.encodeFunctionResult(n,values);
    }
   }else throw Error('Unexpected RPC '+req.method);
   result={jsonrpc:'2.0',id:req.id,result:value};
  }else throw Error('Unexpected API '+url.pathname);
  await route.fulfill({json:result});
 });
 await page.goto(origin,{waitUntil:'networkidle'});
 if(mode==='journal-corrupt'){await page.waitForFunction(()=>document.querySelector('#message').textContent.length>0);assert(await page.locator('#send').isDisabled());assert.equal(sends,0);}
 else{
  await page.locator('#connect').click();await page.locator('.tevumi-wallet-option').first().click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  if(mode==='mobile-zh'||mode==='quote-gateway-zh')await page.locator('#language').click();
  if(mode==='seven-decimals'||mode==='large-amount')await page.locator('#amount').fill(mode==='seven-decimals'?'1.0000001':'1000001');
  await page.locator('#refresh').click();
  if(mode.startsWith('quote-gateway')){await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('has not submitted')||document.querySelector('#message').textContent.includes('尚未提交交易'));assert(await page.locator('#send').isDisabled());assert.equal(sends,0);assert.equal(orders[0].transactions.length,0);}
  else if(mode==='seven-decimals'){await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('Details'));assert(await page.locator('#send').isDisabled());}
  else{
   await page.waitForFunction(()=>!document.querySelector('#send').disabled);
   assert((await page.locator('#asset').textContent()).includes(wotrRoutes.current.arc));
   assert((await page.locator('#quote').textContent()).includes('BNB'));
   if(['reject','unknown-reload','save-failure'].includes(mode)){
    await page.locator('#send').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('cancelled')||document.querySelector('#message').textContent.includes('Details'));
    assert.equal(sends,mode==='save-failure'?0:1);
    if(mode==='unknown-reload'){await page.reload({waitUntil:'networkidle'});await page.locator('#connect').click();await page.locator('.tevumi-wallet-option').first().click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('original transaction hash'));await page.locator('#refresh').click();await page.waitForTimeout(400);assert(await page.locator('#send').isDisabled());assert.equal(sends,1);}
    if(mode==='reject'){await page.locator('#refresh').click();await page.waitForFunction(()=>!document.querySelector('#send').disabled);assert.equal(sends,1);}
   }
   if(mode==='mobile-zh'){assert((await page.locator('#intro').textContent()).includes('成交'));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);mkdirSync('.local/source-trade-ui',{recursive:true});await page.screenshot({path:'.local/source-trade-ui/mobile-zh.png',fullPage:true});}
  }
 }
 assert.deepEqual(errors,[]);report.push({mode,passed:true,walletRequests:sends});console.log(JSON.stringify(report.at(-1)));await page.close();
}}finally{await browser.close();}
console.log(JSON.stringify(report));
