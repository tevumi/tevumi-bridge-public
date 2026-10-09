// UI orchestration only: synthetic engine/wallet and in-memory orders, no real assets.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {assertJournalUpdate} from '../web/source-trade/order.js';
const origin='http://127.0.0.1:5345/',user='0x'+'1'.repeat(40),hash=n=>'0x'+n.toString(16).padStart(64,'0');
const stub=`export class TradeEngine {
 constructor({persist,onChange=()=>{}}){this.persist=persist;this.onChange=onChange;this.results={};}
 setOrder(o){this.order=o;this.results={};}
 async verify(){
  this.results={};
  for(const t of this.order.transactions){
   if(t.state==='REJECTED')continue;
   if(!t.hash)throw Error('Recover the original transaction hash first.');
   if(t.state!=='VERIFIED'&&window.holdArrival)throw Object.assign(Error('Pending arrival'),{code:'WAITING_PROOF'});
   if(t.state!=='VERIFIED'){t.state='VERIFIED';t.proof={gas:'1000',destination:{hash:t.hash,received:this.order.kind==='buy'?'100000000000000000000':'400000'}};await this.persist(this.order);}
   if(t.kind!=='approval')this.results[t.leg]={received:'100000000000000000000',destination:{received:this.order.kind==='buy'?'100000000000000000000':'400000'}};
  }
  if(Object.keys(this.results).length===3&&this.order.state!=='COMPLETED'){this.order.state='COMPLETED';await this.persist(this.order);}
  return this.results;
 }
 async quote(){await this.verify();const leg=Object.keys(this.results).length,kind=(this.order.kind==='buy'?['funding','buy','bridge']:['bridge','sell','funding'])[leg];
  return {kind,leg,chain:kind==='funding'&&this.order.kind==='buy'?5042:56,targetChain:5042,amount:1000000n,at:Date.now(),value:1000n,quote:{route:'curve',out:100000000000000000000n,minOut:99000000000000000000n,minGross:99000000000000000000n,estimate:{toAmount:'400000',toAmountMin:'398000',feeCosts:[],gasCosts:[]}}};
 }
 async transact(wallet,q){
  const needsApproval=(q.kind==='funding'&&this.order.kind==='buy'||q.kind==='sell')&&!this.order.transactions.some(t=>t.leg===q.leg&&t.kind==='approval'&&t.state==='VERIFIED');
  const t={kind:needsApproval?'approval':q.kind,leg:q.leg,chain:q.chain,targetChain:q.targetChain,amount:String(q.amount),to:'0x'+'2'.repeat(40),data:'0x1234',value:'0',nonce:this.order.transactions.length,state:'AWAITING_WALLET',hash:null};
  this.order.transactions.push(t);await this.persist(this.order);
  try{t.hash=await wallet.request({method:'eth_sendTransaction',params:[]});t.state='SUBMITTED';await this.persist(this.order);}catch(e){t.state=e.code===4001?'REJECTED':'UNCERTAIN';await this.persist(this.order);throw e;}
 }
}`;
const browser=await chromium.launch({headless:true});
try{for(const mode of ['buy-en','sell-zh-mobile','pause-reload','reject','unknown']){
 const context=await browser.newContext({viewport:mode==='sell-zh-mobile'?{width:390,height:844}:{width:1360,height:900}});const page=await context.newPage();let sends=0,orders=[];const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('mockWallet',async r=>{if(r.method==='eth_accounts'||r.method==='eth_requestAccounts')return [user];if(r.method==='eth_sendTransaction'){sends++;if(mode==='reject'||mode==='unknown')return {error:mode==='reject'?4001:-32000};return hash(sends);}throw Error(r.method);});
 await page.addInitScript(hold=>{window.holdArrival=hold;const provider={isMetaMask:true,on(){},async request(r){const result=await window.mockWallet(r);if(result?.error)throw Object.assign(Error('Synthetic wallet stop'),{code:result.error});return result;}};window.ethereum=provider;window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{name:'MetaMask',rdns:'io.metamask'},provider}})));},mode==='pause-reload');
 await page.route('**/engine.js*',route=>route.fulfill({contentType:'application/javascript',body:stub}));
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());let result;
  if(url.pathname==='/api/orders'){if(route.request().method()==='GET')result=orders;else{const o=route.request().postDataJSON();assertJournalUpdate(orders.find(v=>v.id===o.id),o);orders=orders.filter(v=>v.id!==o.id);orders.unshift(o);result={saved:true};}}
  else if(url.pathname.startsWith('/api/rpc/')){const r=route.request().postDataJSON();result={jsonrpc:'2.0',id:r.id,result:r.method==='eth_chainId'?'0x'+Number(url.pathname.split('/').pop()).toString(16):r.method==='eth_getBalance'?'0x56bc75e2d63100000':'0x'+'0'.repeat(64)};}
  else throw Error('Unexpected intercepted API '+url.pathname);
  await route.fulfill({json:result});
 });
 await page.goto(origin);await page.locator('#connect').click();await page.locator('.tevumi-wallet-option').first().click();
 if(mode==='sell-zh-mobile'){await page.locator('#language').click();await page.locator('#direction').selectOption('sell');await page.locator('#amount').fill('1000');}
 await page.waitForFunction(()=>!document.querySelector('#send').disabled);
 assert.equal(orders.length,0,'Automatic quote must not create an order');
 await page.locator('#send').click();
 if(mode==='pause-reload'){
  await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('Waiting for'));
  assert.equal(sends,1);assert.equal(await page.evaluate(()=>navigator.locks.request('tevumi-source-trade:'+'0x'+'1'.repeat(40),{ifAvailable:true},lock=>Boolean(lock))),false);
  await page.locator('#language').click();await page.locator('#pause').click();
  await page.waitForFunction(()=>document.querySelector('#pause').hidden);assert.equal(sends,1);
  await page.reload();await page.locator('#connect').click();await page.locator('.tevumi-wallet-option').first().click();
  await page.evaluate(()=>window.holdArrival=false);await page.waitForTimeout(9000);assert.equal(sends,1,'Reload/checks must never open another wallet prompt');
  await page.waitForFunction(()=>!document.querySelector('#send').disabled);await page.locator('#send').click();await page.waitForFunction(()=>document.querySelector('#orders').textContent.includes('Completed'),{},{timeout:20000});assert.equal(sends,4);
 }else if(mode==='reject'||mode==='unknown'){
  await page.waitForFunction(()=>document.querySelector('#pause').hidden);assert.equal(sends,1);assert.equal(orders[0].transactions[0].state,mode==='reject'?'REJECTED':'UNCERTAIN');
 }else{
  await page.waitForFunction(()=>document.querySelector('#orders').textContent.includes('Completed')||document.querySelector('#orders').textContent.includes('已完成'),{},{timeout:20000});assert.equal(sends,4);assert.equal(orders[0].state,'COMPLETED');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({mode,passed:true,walletRequests:sends}));await context.close();
}}finally{await browser.close();}
