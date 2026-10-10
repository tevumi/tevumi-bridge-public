// Synthetic data and wallet only. Never signs or broadcasts an asset transaction.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {createOrder,stringify} from '../web/source-trade/order.js';
const base=process.env.TEVUMI_BASE_URL||'http://127.0.0.1:5351/preview/web/preview/';
const account='0x'+'1'.repeat(40),hash='0x'+'2'.repeat(64),localHash='0x'+'3'.repeat(64);
const browser=await chromium.launch({headless:true});
try{for(const mode of ['buy','bridge','swap','usdc'])for(const failed of [false,true]){
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const remote=createOrder('sell',account,'1000','server-only-order'),poison=createOrder('buy',account,'7','browser-poison-order');
 await page.addInitScript(({account,localHash,poison})=>{
  localStorage.setItem('tevumi:language:v1','zh-CN');
  localStorage.setItem(`tevumi:sale-history:v1:${account}`,JSON.stringify([{hash:localHash,state:'verified',createdAt:Date.now(),amountIn:'1234567000000000000000000',received:'1',direction:'sell',chainId:56}]));
  localStorage.setItem(`tevumi:circle-usdc:history:v1:${account}`,JSON.stringify([{id:'browser-poison',state:'success',amount:'1234567',destination:'Ethereum',createdAt:Date.now(),events:[{name:'burn',txHash:localHash}]}]));
  localStorage.setItem(`tevumi:source-trade:orders:v2:${account}`,JSON.stringify([poison]));
  const provider={isMetaMask:true,on(){},request:async r=>{if(['eth_accounts','eth_requestAccounts'].includes(r.method))return[account];if(r.method==='eth_chainId')return '0x13b2';if(r.method==='personal_sign')return '0x'+'1'.repeat(130);throw Error('No transaction signing allowed');}};
  window.ethereum=provider;window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{name:'MetaMask',rdns:'io.metamask'},provider}})));
 },{account,localHash,poison:JSON.parse(stringify(poison))});
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(req.method()==='POST'&&path.endsWith('/operation-results'))return route.fulfill({status:503,json:{error:'Simulated storage outage'}});
  if(path.endsWith('/auth/challenge'))return route.fulfill({json:{id:'test',message:'Synthetic login'}});
  if(path.endsWith('/auth/login'))return route.fulfill({json:{account}});
  if(req.method()==='GET'&&/journey-transfers|usdc-transfers|\/transfers$|\/orders$|operation-results/.test(path)){
   if(failed)return route.fulfill({status:503,json:{error:'Simulated history outage'}});
   const item=path.endsWith('/journey-transfers')?{tx_hash:hash,input_asset:'WOTR',output_asset:'BNB',input_amount:'9876000000000000000000',output_amount:'1000000000000000',status:'verified',created_at:1791600000,token_address:'0xe2a0ce4be658ee9b09e461f5283c718a20984444'}:path.endsWith('/usdc-transfers')?{source_hash:hash,amount:'1000000',target_chain:'Base',status:'arrived',created_at:1791600000}:{source_hash:hash,chain:56,target_chain:5042,asset:'wotr-four',amount_ld:'9876000000000000000000',status:'arrived',created_at:1791600000};
   return route.fulfill({json:path.endsWith('/orders')?[JSON.parse(stringify(remote))]:{items:path.endsWith('/operation-results')?[]:[item],more:false}});
  }
  return route.abort();
 });
 await page.goto(base+(mode==='usdc'?'usdc/index.html':'index.html?action='+mode));
 await page.locator(mode==='usdc'?'#wallet-button':'#header-connect').click();
 await page.locator('.tevumi-wallet-option').filter({hasText:'MetaMask'}).click();
 const panel=mode==='buy'?'#journey-buy-history':mode==='bridge'?'#history-panel':mode==='swap'?'#source-orders': '#transfer-history';
 if(mode!=='swap'){await page.locator(panel).locator('summary').click();}
 else {await page.waitForTimeout(1000);const connect=page.locator('#source-connect');if(await connect.isVisible())await connect.click();await page.locator('.source-history summary').click();}
 const list=mode==='buy'?page.locator('#journey-buy-history .history-list'):mode==='bridge'?page.locator('#history-list'):mode==='swap'?page.locator('#source-orders'):page.locator('#history-list');
 if(failed){await page.waitForTimeout(1500);assert.equal(await list.locator('.history-card,.order').count(),0);}
 else {await list.locator(mode==='swap'?'.order':'.history-card').first().waitFor();assert.equal(await list.locator(mode==='swap'?'.order':'.history-card').count(),1);}
 const contents=await list.textContent();assert(!contents.includes('1234567'));assert(!contents.includes('此浏览器记录'));assert(!contents.includes('浏览器保存'));assert.equal(await list.locator(`a[href*="${localHash}"]`).count(),0);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({mode,serverUnavailable:failed,serverOnly:true,passed:true}));await page.close();
}}finally{await browser.close();}
