import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const base=process.env.TEVUMI_BASE_URL||'http://127.0.0.1:5351/preview/web/preview/usdc/';
const account='0x'+'1'.repeat(40),hash='0x'+'2'.repeat(64),browser=await chromium.launch({headless:true});
try{for(const mobile of [false,true])for(const state of ['pending','error','success','cancelled']){
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:900}}),errors=[],stored=new Map();page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({account,hash,state})=>{
  localStorage.setItem(`tevumi:circle-usdc:mainnet:v1:${account}`,JSON.stringify({id:'test-current',state,account,amount:'2',destination:'Base',createdAt:Date.now(),events:state==='pending'||state==='cancelled'?[]:[{name:'burn',txHash:hash}],result:state==='error'?{state:'error',steps:[{name:'burn',txHash:hash,state:'error'}]}:undefined}));
  const provider={isMetaMask:true,on(){},request:async r=>{if(['eth_accounts','eth_requestAccounts'].includes(r.method))return[account];if(r.method==='eth_chainId')return '0x13b2';throw Error('No signing allowed');}};window.ethereum=provider;
  window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{name:'MetaMask',rdns:'io.metamask'},provider}})));
 },{account,hash,state});
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/operation-results'&&req.method()==='POST'){const record=req.postDataJSON();stored.set(record.id,{...record,reported:true,created_at:Math.floor(Date.now()/1000),source_hash:record.hash,status:'unknown'});return route.fulfill({json:{saved:true}});}
  if(path==='/api/usdc-transfers')return route.fulfill({json:req.method()==='GET'?{items:[...stored.values()],more:false}:{status:'in_transit'}});
  return route.abort();
 });
 await page.goto(base+'index.html');await page.locator('#wallet-button').click();await page.locator('.tevumi-wallet-option').filter({hasText:'MetaMask'}).click();
 await page.locator('#transfer-history summary').click();
 await page.locator('#history-list .history-card').first().waitFor();assert.equal(await page.locator('#history-list .history-card').count(),1);
 assert.equal(await page.locator('#history-list #activity').count(),0);assert.equal(await page.locator('#activity').isVisible(),state!=='cancelled');
 if(state==='pending'||state==='error')assert.equal(await page.locator('#bridge-button').isDisabled(),true);
 if(state==='error')assert.equal(await page.locator('#retry-button').isVisible(),true);
 await page.locator('#lang-zh').click();assert(!(await page.locator('#history-list').textContent()).includes('浏览器'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({mobile,state,serverHistory:true,separateRecovery:true,passed:true}));await page.close();
}}finally{await browser.close();}
