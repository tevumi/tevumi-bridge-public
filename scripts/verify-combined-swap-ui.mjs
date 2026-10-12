// Original embedded Swap UI, disposable wallet and in-memory API interception.
// Does not load production credentials, persistent journals or mainnet providers.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {Interface} from 'ethers';
import {combinedWalletRig} from '../test/helpers/combined-wallet-rig.mjs';
import {assertJournalUpdate,createCombinedOrder} from '../web/source-trade/order.js';
import {tokenInterface} from '../web/source-trade/proofs.js';
const origin=process.env.TEVUMI_COMBINED_UI_URL||'http://127.0.0.1:5357/preview/web/preview/index.html?action=swap';
assert(['127.0.0.1','localhost'].includes(new URL(origin).hostname),'UI fixture must run on loopback.');
const browser=await chromium.launch({headless:true}),report=[];
const hex=n=>'0x'+BigInt(n).toString(16),pad=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const balanceInterface=new Interface(['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)']);
mkdirSync('.local/combined-swap-ui',{recursive:true});
try{for(const mode of ['buy-en','sell-zh-mobile','sell-approved','reject','unknown-reload','save-failure','pause-reload','refresh-pending','double-click']){
 const r=await combinedWalletRig({kind:mode.startsWith('sell')?'sell':'buy',approved:mode==='sell-approved',reject:mode==='reject',unknown:mode==='unknown-reload',pending:['pause-reload','refresh-pending','double-click'].includes(mode)});
 const context=await browser.newContext({viewport:mode==='sell-zh-mobile'?{width:390,height:844}:{width:1440,height:1050}}),page=await context.newPage(),errors=[];
 let orders=[],loginSignatures=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('isolatedWallet',async request=>{
  if(request.method==='personal_sign'){loginSignatures++;return '0x'+'1'.repeat(130);}
  try{return await r.walletRequest(request);}catch(e){return {error:e.code};}
 });
 await page.addInitScript(()=>{
  const provider={isMetaMask:true,on(){},async request(req){const result=await window.isolatedWallet(req);if(result?.error)throw Object.assign(Error('Isolated wallet stopped'),{code:result.error});return result;}};
  window.ethereum=provider;window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{name:'MetaMask',rdns:'io.metamask'},provider}})));
 });
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname.replace('/api/source-trade/','/api/'),req=route.request();let data;
  try{
   if(path==='/api/orders'){
    if(req.method()==='GET')data=orders;
    else{
     const o=req.postDataJSON();if(mode==='save-failure'&&o.transactions.length)return route.fulfill({status:503,json:{error:'Isolated persistence failure'}});
     assertJournalUpdate(orders.find(v=>v.id===o.id),o);orders=orders.filter(v=>v.id!==o.id);orders.unshift(o);r.setJournal(o);data={saved:true};
    }
   }else if(path==='/api/combined/config')data={enabled:true,uiReady:true,deployment:r.deployment};
   else if(path==='/api/combined/preview'){
    const value=req.postDataJSON();createCombinedOrder(value.kind,r.account,value.input,'readonly-ui-preview',r.deployment);
    data={version:2,previewOnly:true,estimatedReceive:value.kind==='buy'?'101000000000000000000':'2000000',at:Date.now()};
   }else if(path==='/api/combined/verify'){
    const o=orders.find(v=>v.id===req.postDataJSON().id);assert(o);data=r.verify(o);
   }else if(path==='/api/combined/quote'){
    const o=orders.find(v=>v.id===req.postDataJSON().id);assert(o);data=await r.quote(o,Object.keys(r.verify(o).results).length);
   }else if(path==='/api/auth/challenge')data={id:'isolated-login',message:'Isolated browser login fixture.'};
   else if(path==='/api/auth/login')data={account:r.account};
   else if(path==='/api/operation-results')data={items:[]};
   else if(path.startsWith('/api/rpc/')){
    const body=req.postDataJSON(),chain=Number(path.split('/').pop());let result;
    if(body.method==='eth_chainId')result=hex(chain);
    else if(body.method==='eth_getCode')result='0x6001';
    else if(body.method==='eth_getBalance')result=hex(100n*10n**18n);
    else if(body.method==='eth_blockNumber')result='0x65';
    else if(body.method==='eth_getTransactionCount')result=hex(r.counts().financialConfirmations);
    else if(body.method==='eth_estimateGas')result=hex(100000);
    else if(body.method==='eth_gasPrice'||body.method==='eth_maxPriorityFeePerGas')result='0xf4240';
    else if(body.method==='eth_getBlockByNumber')result={number:'0x65',hash:pad(101),parentHash:pad(100),timestamp:hex(Math.floor(Date.now()/1000)),nonce:'0x0000000000000000',difficulty:'0x0',gasLimit:'0x1c9c380',gasUsed:'0x5208',miner:r.account,extraData:'0x',transactions:[],baseFeePerGas:'0xf4240'};
    else if(body.method==='eth_call'){
     let c;try{c=balanceInterface.parseTransaction(body.params[0]);}catch{}
     result=c?.name==='allowance'?await r.providers[56].call(body.params[0]):c?.name==='balanceOf'?'0x'+(1000n*10n**18n).toString(16).padStart(64,'0'):'0x';
    }else if(body.method==='eth_getTransactionReceipt'||body.method==='eth_getTransactionByHash')result=null;
    else result=[];
    data={jsonrpc:'2.0',id:body.id,result};
   }else data={items:[],events:[]};
   return route.fulfill({json:data});
  }catch(e){return route.fulfill({status:409,json:{error:e.message}});}
 });
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 await page.locator('#header-connect').click();await page.locator('.tevumi-wallet-option').first().click();
 await page.waitForFunction(()=>document.querySelector('#source-connect')&&!document.querySelector('#source-refresh').disabled);
 if(await page.locator('#source-connect').isVisible())await page.locator('#source-connect').click();
 if(mode==='sell-zh-mobile')await page.locator('[data-language=zh-CN]').click();
 if(mode.startsWith('sell')){await page.locator('#source-reverse').click();await page.locator('#source-amount').fill('1');}
 await page.waitForFunction(()=>!document.querySelector('#source-send').disabled);
 assert.equal(orders.length,0,'Readonly preview must not create a server order.');
 const before=await page.locator('#source-swap-card').innerText();assert(!/Four\.meme|PancakeSwap|LayerZero|0x[0-9a-f]{40}/i.test(before),'Technical execution text must not appear.');
 await page.screenshot({path:`.local/combined-swap-ui/${mode}-ready.png`,fullPage:true});
 await page.locator('#source-send').click();
 if(['pause-reload','refresh-pending','double-click'].includes(mode)){
  await page.waitForFunction(()=>document.querySelector('#source-message').textContent.includes('Waiting for'));
  assert.equal(r.counts().financialConfirmations,1);
  if(mode==='double-click'){
   await page.evaluate(()=>{const button=document.querySelector('#source-send');for(let i=0;i<5;i++)button.click();});
   assert.equal(orders.length,1,'Repeated clicks must not create another server order.');
   assert.equal(r.counts().financialConfirmations,1,'Repeated clicks must not send another payment.');
  }
  if(mode==='pause-reload'){
   await page.locator('#source-pause').click();
   await page.waitForFunction(()=>document.querySelector('#source-pause').hidden,{},{timeout:12000});
  }
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#source-orders').textContent.includes('Progress')||document.querySelector('#source-message').textContent.includes('Waiting'),{},{timeout:20000});
  assert.equal(r.counts().financialConfirmations,1,'Reload during pending arrival must not send another payment.');
  r.release();
  await page.waitForFunction(()=>!document.querySelector('#source-send').disabled,{},{timeout:20000});assert.equal(r.counts().financialConfirmations,1,'Refresh must not trigger a wallet request.');
  await page.locator('#source-send').click();
 }
 if(['reject','unknown-reload','save-failure'].includes(mode)){
  await page.waitForFunction(()=>document.querySelector('#source-pause').hidden);
  assert.equal(r.counts().financialConfirmations,mode==='save-failure'?0:1);
  if(mode==='unknown-reload'){await page.reload();await page.waitForFunction(()=>document.querySelector('#source-message').textContent.length>0);assert.equal(r.counts().financialConfirmations,1);assert(await page.locator('#source-send').isDisabled());}
 }else{
  await page.waitForFunction(()=>document.querySelector('#source-orders').textContent.includes('Completed')||document.querySelector('#source-orders').textContent.includes('已完成'),{},{timeout:25000});
  assert.equal(r.counts().financialConfirmations,mode==='sell-zh-mobile'?3:2);assert.equal(orders[0].state,'COMPLETED');
  assert(await page.locator('#source-send').isHidden(),'A completed order must not offer another Continue action.');
  assert.notEqual(await page.locator('#source-output').textContent(),'—');
 }
 if(mode==='sell-zh-mobile'){
  await page.screenshot({path:'.local/combined-swap-ui/sell-zh-mobile-completed.png',fullPage:true});
  await page.reload();await page.waitForFunction(()=>document.documentElement.lang==='zh-CN'&&document.querySelector('#source-orders').textContent.includes('已完成'));
  assert.equal(r.counts().financialConfirmations,3);
 }
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);await page.screenshot({path:`.local/combined-swap-ui/${mode}-result.png`,fullPage:true});
 report.push({mode,passed:true,...r.counts(),loginSignatures});console.log(JSON.stringify(report.at(-1)));await context.close();
}}finally{await browser.close();writeFileSync('.local/combined-swap-ui/report.json',JSON.stringify(report,null,2));}
