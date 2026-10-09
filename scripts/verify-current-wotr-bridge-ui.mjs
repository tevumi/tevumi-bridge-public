// Synthetic RPC/wallet: validates private test-page identity, amounts and recovery.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {chromium} from '@playwright/test';
import {AbiCoder,Interface,ZeroAddress,parseEther,zeroPadValue} from 'ethers';
import {endpointAbi,ulnType} from '../web/src/bridge.js';
import {candidateAppAbi,candidateTokenAbi} from '../web/src/production-transfer.js';
import {routes} from '../web/src/routes.js';
import {wotrRoutes} from '../web/src/wotr-routes.js';
const account='0x'+'1'.repeat(40),plan={account:'0x489594537CB76aC256079D710B6E18498E1a5402',sourceToken:wotrRoutes.current.sourceToken,batches:[{side:'bsc',chainId:56,admin:'0xD43448999ce7fA1FFE4783aB9D2D623FC9AC32db',endpoint:'0x1a44076050125825900e736c501f859c50fe728c',apps:{wotr:wotrRoutes.current.bsc},remoteApps:{wotr:wotrRoutes.current.arc}},{side:'arc',chainId:5042,admin:'0x95A128fbdc89f20b16b735b06bFBe0DF92AA68Df',endpoint:'0x6f475642a6e85809b1c36fa62763669b1b48dd5b',apps:{wotr:wotrRoutes.current.arc},remoteApps:{wotr:wotrRoutes.current.bsc}}]};
const origin=process.env.TEVUMI_BASE_URL||'http://127.0.0.1:5341/preview/web/preview/';
const iface=new Interface([...endpointAbi,...candidateAppAbi,...candidateTokenAbi,'function owner() view returns(address)','function guardian() view returns(address)','function enforcedOptions(uint32,uint16) view returns(bytes)','function msgInspector() view returns(address)']);
const coder=AbiCoder.defaultAbiCoder(),browser=await chromium.launch({headless:true}),report=[];
try{
 for(const mode of ['amounts','wrong-token','insufficient-balance','approve-reject','send-reject','unknown-reload','arc-independent','history-mobile']){
  const page=await browser.newPage({viewport:mode==='history-mobile'?{width:390,height:844}:{width:1440,height:1000}}),errors=[],sent=[];let walletChain=56;page.on('pageerror',e=>errors.push(e.message));
  const answer=(req,chain)=>{
   const {method,params=[]}=req,item=plan.batches.find(i=>i.chainId===chain),r=routes[chain];let result;
   if(method==='eth_chainId')result='0x'+chain.toString(16);
   else if(method==='eth_getCode')result='0x6000';
   else if(method==='eth_blockNumber')result='0x100';
   else if(method==='eth_getTransactionCount')result='0x1';
   else if(method==='eth_getBalance')result='0x'+parseEther('100').toString(16);
   else if(method==='eth_estimateGas')result='0x50000';
   else if(method==='eth_gasPrice')result='0x2faf080';
   else if(method==='eth_getLogs')result=[];
   else if(method==='eth_getBlockByNumber')result={number:'0x100',hash:'0x'+'a'.repeat(64),parentHash:'0x'+'b'.repeat(64),timestamp:'0x1',nonce:'0x0000000000000000',difficulty:'0x0',gasLimit:'0x1c9c380',gasUsed:'0x5208',miner:account,extraData:'0x',transactions:[],baseFeePerGas:'0x2faf080'};
   else if(method==='eth_maxPriorityFeePerGas')result='0x1';
   else if(method==='eth_call'){
    let call;try{call=iface.parseTransaction({data:params[0].data})}catch{}if(!call)return {jsonrpc:'2.0',id:req.id,result:'0x'+'0'.repeat(64)};const name=call.name;let values;
    if(name==='owner')values=[params[0].to.toLowerCase()===item.admin.toLowerCase()?plan.account:item.admin];
    else if(name==='guardian')values=[plan.account];
    else if(name==='token'||name==='sourceToken')values=[mode==='wrong-token'?ZeroAddress:plan.sourceToken];
    else if(name==='endpoint')values=[item.endpoint];
    else if(name==='eid')values=[chain===56?30102:30417];
    else if(name==='peers')values=[zeroPadValue(item.remoteApps.wotr,32)];
    else if(name==='outbound'||name==='inbound')values=[1000000000000000n,18446744073709551614n,18446744073709551615n,0n,0n,true];
    else if(name==='depositsPaused'||name==='sendsPaused'||name==='receivesPaused'||name==='isDefaultSendLibrary')values=[false];
    else if(name==='getSendLibrary')values=[r.sendLibrary];
    else if(name==='getReceiveLibrary')values=[r.receiveLibrary,false];
    else if(name==='getConfig')values=[Number(call.args[3])===1?coder.encode(['tuple(uint32 maxMessageSize,address executor)'],[[r.maxMessageSize,r.executor]]):coder.encode([ulnType],[[call.args[1].toLowerCase()===r.sendLibrary.toLowerCase()?r.sendConfirmations:r.receiveConfirmations,2,0,0,r.dvns,[]]])];
    else if(name==='enforcedOptions')values=['0x'];
    else if(name==='msgInspector')values=[ZeroAddress];
    else if(name==='balanceOf')values=[mode==='insufficient-balance'?0n:parseEther('2000000')];
    else if(name==='allowance')values=[mode==='approve-reject'?0n:parseEther('100')];
    else if(name==='decimals')values=[18];
    else if(name==='capacityLD')values=[parseEther('1000000000')];
    else if(name==='principalLD')values=[0n];
    else if(name==='availableOutboundSD'||name==='availableInboundSD')values=[18446744073709551614n];
    else if(name==='quoteSend')values=[[parseEther(chain===56?'0.00034':'0.27'),0n]];
    else throw Error('Unexpected live call '+name);
    result=iface.encodeFunctionResult(name,values);
   }else throw Error('Unexpected live RPC '+method);
   return {jsonrpc:'2.0',id:req.id,result};
  };
  await page.exposeFunction('testRpc',async req=>{
   if(req.method==='eth_accounts'||req.method==='eth_requestAccounts')return [account];
   if(req.method==='wallet_switchEthereumChain'){walletChain=Number(BigInt(req.params[0].chainId));return null}
   if(req.method==='eth_sendTransaction'){sent.push(req.params[0]);return {testError:mode==='unknown-reload'?-32000:4001}}
   return answer({...req,id:1},walletChain).result;
  });
  await page.addInitScript(address=>{localStorage.setItem('tevumi-immediate-wotr-live-v1:'+address,JSON.stringify({'send-bsc':{hash:'0x'+'a'.repeat(64)}}));window.ethereum={isMetaMask:true,on(){},request:async req=>{const r=await window.testRpc(req);if(r?.testError)throw Object.assign(Error('Synthetic wallet error'),{code:r.testError});return r}};window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{name:'MetaMask',rdns:'io.metamask'},provider:window.ethereum}})));},account);
  await page.route(/https:\/\/.*/,async route=>{if(route.request().method()!=='POST')return route.continue();const req=route.request().postDataJSON(),chain=route.request().url().includes('arc.io')?5042:56;await route.fulfill({json:Array.isArray(req)?req.map(q=>answer(q,chain)):answer(req,chain)})});
  await page.route('**/api/**',r=>r.fulfill({json:{items:r.request().url().includes('/transfers?')?[{asset:'wotr-four',chain:56,target_chain:5042,status:'arrived',amount_ld:String(parseEther('1000')),created_at:1,source_token:wotrRoutes.current.sourceToken},{asset:'wotr',chain:56,target_chain:5042,status:'arrived',amount_ld:String(parseEther('1000')),created_at:1,source_token:wotrRoutes.historical.sourceToken}]:[],more:false}}));
  await page.goto(origin,{waitUntil:'networkidle'});await page.locator('#nav-bridge').click();
  await page.locator('#header-connect').click();await page.locator('.tevumi-wallet-option').first().click();await page.waitForFunction(()=>!document.querySelector('#send-bsc').disabled);await page.locator('#send-amount').fill('100');
  if(mode==='amounts'){
   for(const value of ['0.000001','0.1','1001','1000001']){await page.locator('#send-amount').fill(value);assert(await page.locator('#send-bsc').isEnabled())}
   await page.locator('#send-amount').fill('0');assert(await page.locator('#send-bsc').isDisabled());
   await page.locator('#send-amount').fill('1.0000001');assert(await page.locator('#send-bsc').isDisabled());
   assert.equal(sent.length,0);
  }else if(mode==='history-mobile'){
   await page.locator('[data-language="zh-CN"]').click();await page.locator('#history-panel summary').click();await page.waitForFunction(()=>document.querySelector('#history-list').textContent.includes('历史合约'));assert((await page.locator('#history-list').textContent()).includes(wotrRoutes.current.sourceToken));await page.locator('#nav-swap').click();await page.waitForURL('**/preview/trade/index.html*');await page.waitForFunction(()=>document.querySelector('#asset')?.textContent.length>0);assert((await page.locator('#asset').textContent()).includes(wotrRoutes.current.arc));await page.reload({waitUntil:'networkidle'});assert(await page.locator('#heading').isVisible());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }else{
   if(mode==='arc-independent')await page.locator('#reverse-direction').click();
   await page.locator(mode==='arc-independent'?'#send-arc':'#send-bsc').click();await page.waitForFunction(()=>!document.querySelector('#send-bsc').disabled);
   if(mode==='wrong-token'||mode==='insufficient-balance'){assert.equal(sent.length,0);assert.match(await page.locator('#message').textContent(),mode==='wrong-token'?/绑定|binding/i:/余额不足|balance/i)}
   else{
    assert.equal(sent.length,1);const tx=sent[0];
    if(mode==='approve-reject'){assert.equal(tx.to.toLowerCase(),plan.sourceToken.toLowerCase());const decoded=iface.decodeFunctionData('approve',tx.data);assert.equal(decoded[0].toLowerCase(),plan.batches[0].apps.wotr.toLowerCase());assert.equal(decoded[1],parseEther('100'))}
    else{const side=mode==='arc-independent'?'arc':'bsc',batch=plan.batches.find(b=>b.side===side);assert.equal(tx.to.toLowerCase(),batch.apps.wotr.toLowerCase());const decoded=iface.decodeFunctionData('send',tx.data);assert.equal(decoded[0].amountLD,parseEther('100'));assert.equal(decoded[0].minAmountLD,parseEther('100'));assert.equal(decoded[0].to.toLowerCase(),zeroPadValue(account,32).toLowerCase());assert.equal(BigInt(tx.value),decoded[1].nativeFee)}
    if(mode==='unknown-reload'){await page.reload({waitUntil:'networkidle'});await page.waitForTimeout(500);assert.equal(sent.length,1);assert(await page.locator('#send-bsc').isHidden());}
   }
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({mode,passed:true}));report.push({mode,passed:true,walletRequests:sent.length});await page.close();
 }
}finally{await browser.close()}
console.log(JSON.stringify(report));
