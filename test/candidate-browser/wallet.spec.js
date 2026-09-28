import {test,expect} from '@playwright/test';
const state=async request=>(await request.get('/__candidate/state')).json();
async function prepare(page){await page.locator('#prepare-send').click();await expect(page.locator('#flow-review')).toBeVisible();}
async function confirm(page){await page.locator('#flow-ack').check();await page.locator('#flow-sign').click();}
test.beforeEach(async({page,request})=>{
 const s=await state(request),headers={'X-Candidate-Token':s.token};
 await request.post('/__candidate/reset',{headers,data:{}});const fresh=await state(request);
 await page.exposeFunction('localWalletSend',async tx=>{
  const snapshot=await state(request),r=snapshot.walletRequests.findLast(r=>r.status==='unknown');
  const response=await request.post('/__candidate/wallet-broadcast',{headers,data:{id:r.id,tx}});
  const body=await response.json();if(!response.ok())throw Error(body.error);return body.result;
 });
 await page.addInitScript(({accounts})=>{
  const handlers={};let account=accounts[0],chain='0x7a69',connected=false;
  window.walletChange=(event,value)=>{if(event==='accountsChanged')account=value[0];if(event==='chainChanged')chain=value;if(event==='disconnect')connected=false;for(const f of handlers[event]??[])f(value);};
  window.walletSends=0;window.walletNext='';
  window.ethereum={on:(e,f)=>(handlers[e]??=[]).push(f),request:async({method,params})=>{
   if(method==='eth_requestAccounts'){connected=true;return [account];}
   if(method==='eth_accounts')return connected?[account]:[];
   if(method==='eth_chainId')return chain;
   if(method==='wallet_switchEthereumChain'){if(window.walletNext==='rejectSwitch'){window.walletNext='';throw {code:4001};}if(window.walletNext==='missingNetwork'){window.walletNext='';throw {code:4902};}window.walletChange('chainChanged',params[0].chainId);return null;}
   if(method==='wallet_addEthereumChain'){window.addedNetwork=params[0];return null;}
   if(method==='eth_sendTransaction'){
    window.walletSends++;const mode=window.walletNext;window.walletNext='';
    if(mode==='reject')throw {code:4001};
    if(mode==='never')return new Promise(()=>{});
    if(mode==='late')await new Promise(resolve=>setTimeout(resolve,1800));
    const hash=await window.localWalletSend(params[0]);
    if(mode==='lost')throw Error('simulated transport loss after broadcast');
    if(mode==='change')window.walletChange('accountsChanged',[accounts[1]]);
    if(mode==='disconnect')window.walletChange('disconnect',{});
    return hash;
   }
   throw Error('Unsupported local test wallet method');
  }};
 },{accounts:fresh.accounts});
 await page.goto('/bridge.html?wallet=1&walletTimeout=1000');await expect(page.locator('#prepare-send')).toBeEnabled();await page.locator('#connect').click();
});
test('wallet interface approves then sends and switches chain for return',async({page,request})=>{
 await prepare(page);await confirm(page);await expect(page.locator('#flow-title')).toHaveText('确认跨链发送');await confirm(page);await expect(page.locator('#flow-review')).not.toBeVisible();
 expect(await page.evaluate(()=>window.walletSends)).toBe(2);expect((await state(request)).assets[0].balances[0].arc).toBe('1.0');
 await page.locator('#choose-arc').click();await expect(page.locator('#source-label')).toContainText('Arc');await prepare(page);await confirm(page);await expect(page.locator('#flow-review')).not.toBeVisible();
 expect((await state(request)).assets[0].principal).toBe('0.0');
});
test('wallet rejection and refused chain switch do not send or change direction',async({page,request})=>{
 await page.evaluate(()=>window.walletNext='rejectSwitch');await page.locator('#choose-arc').click();await expect(page.locator('#message')).toContainText('切链未完成');await expect(page.locator('#source-label')).toContainText('BSC');
 await prepare(page);await page.evaluate(()=>window.walletNext='reject');await confirm(page);await expect(page.locator('#message')).toContainText('已取消钱包操作');
 const s=await state(request);expect(s.walletRequests[0].status).toBe('rejected');expect(s.assets[0].balances[0].allowance).toBe('0.0');
 await prepare(page);await page.evaluate(()=>window.walletChange('chainChanged','0x38'));await expect(page.locator('#flow-review')).not.toBeVisible();await page.locator('#prepare-send').click();await expect(page.locator('#message')).toContainText('账户或网络已变化');
 expect(await page.evaluate(()=>window.walletSends)).toBe(1);
});
test('unknown local network is added with the restricted loopback RPC',async({page})=>{
 await page.evaluate(()=>window.walletNext='missingNetwork');await page.locator('#choose-arc').click();
 await expect(page.locator('#source-label')).toContainText('Arc');
 expect(await page.evaluate(()=>window.addedNetwork)).toMatchObject({chainId:'0x7a6a',rpcUrls:['http://127.0.0.1:5174/__candidate/rpc/arc']});
});
test('unknown non-broadcast timeout remains blocked after reload',async({page,request})=>{
 await prepare(page);await page.evaluate(()=>window.walletNext='never');await confirm(page);await expect(page.locator('#message')).toContainText('广播结果待核验');
 await page.reload();await page.locator('#connect').click();await expect(page.locator('#prepare-send')).toBeEnabled();await page.locator('#prepare-send').click();await expect(page.locator('#message')).toContainText('不能重复发送');
 expect((await state(request)).walletRequests[0].status).toBe('unknown');expect(await page.evaluate(()=>window.walletSends)).toBe(0);
});
test('lost wallet hash is recovered by nonce and payload without another send',async({page,request})=>{
 await prepare(page);await confirm(page);await expect(page.locator('#flow-title')).toHaveText('确认跨链发送');await page.evaluate(()=>window.walletNext='lost');await confirm(page);await expect(page.locator('#flow-review')).not.toBeVisible();
 await page.reload();await expect(page.locator('#prepare-send')).toBeEnabled();const s=await state(request);
 expect(s.walletRequests.every(r=>r.status==='confirmed')).toBe(true);expect(s.records).toHaveLength(1);expect(s.assets[0].balances[0].arc).toBe('1.0');expect(await page.evaluate(()=>window.walletSends)).toBe(0);
});
test('account change after approval records the transaction but stops continuation',async({page,request})=>{
 await prepare(page);await page.evaluate(()=>window.walletNext='change');await confirm(page);await expect(page.locator('#message')).toContainText('钱包状态已变化');await expect(page.locator('#flow-review')).not.toBeVisible();
 expect((await state(request)).assets[0].balances[0].allowance).toBe('1.0');expect((await state(request)).records).toHaveLength(0);expect(await page.evaluate(()=>window.walletSends)).toBe(1);
});
test('late wallet broadcast after timeout is recovered without automatic continuation',async({page,request})=>{
 await prepare(page);await page.evaluate(()=>window.walletNext='late');await confirm(page);await expect(page.locator('#message')).toContainText('广播结果待核验');
 await expect.poll(async()=>(await state(request)).assets[0].balances[0].allowance).toBe('1.0');
 await expect(page.locator('#flow-review')).not.toBeVisible();await page.locator('#refresh-balances').click();await expect(page.locator('#prepare-send')).toBeEnabled();
 expect((await state(request)).walletRequests[0].status).toBe('confirmed');expect((await state(request)).records).toHaveLength(0);expect(await page.evaluate(()=>window.walletSends)).toBe(1);
});
test('disconnect after approval reconciles but never opens the next confirmation',async({page,request})=>{
 await prepare(page);await page.evaluate(()=>window.walletNext='disconnect');await confirm(page);await expect(page.locator('#message')).toContainText('钱包状态已变化');await expect(page.locator('#flow-review')).not.toBeVisible();
 expect((await state(request)).walletRequests[0].status).toBe('confirmed');expect((await state(request)).records).toHaveLength(0);
 await page.locator('#prepare-send').click();await expect(page.locator('#message')).toContainText('账户或网络已变化');expect(await page.evaluate(()=>window.walletSends)).toBe(1);
});
test('network change while preview is loading cannot reopen a stale confirmation',async({page})=>{
 await page.route('**/__candidate/preview',async route=>{
  const response=await route.fetch();await page.evaluate(()=>window.walletChange('chainChanged','0x38'));await route.fulfill({response});
 });
 await page.locator('#prepare-send').click();await expect(page.locator('#message')).toContainText('账户或网络已变化');await expect(page.locator('#flow-review')).not.toBeVisible();expect(await page.evaluate(()=>window.walletSends)).toBe(0);
});
