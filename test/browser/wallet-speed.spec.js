import {test,expect} from '@playwright/test';
const address='0x489594537CB76aC256079D710B6E18498E1a5402';
for(const restored of [false,true])test(`wallet identity is usable while balance and deployment RPC are stalled: restore=${restored}`,async({page})=>{
 await page.addInitScript(({address,restored})=>{let authorized=restored;window.requests=[];window.ethereum={on:()=>{},request:async({method})=>{window.requests.push(method);if(method==='eth_requestAccounts'){authorized=true;return[address];}if(method==='eth_accounts')return authorized?[address]:[];if(method==='eth_chainId')return '0x38';if(method==='eth_getBalance'||method==='eth_getTransactionReceipt')return new Promise(()=>{});if(method==='eth_blockNumber')return '0x1';throw Error('Unexpected '+method);}};localStorage.setItem('tevumi-pilot-deployments-v1',JSON.stringify([{kind:'PilotToken',chainId:56,account:address,address:'0x1111111111111111111111111111111111111111',txHash:'0x'+'1'.repeat(64)}]));},{address,restored});
 await page.goto('/bridge.html');if(!restored)await page.locator('#connect').click();
 await expect(page.locator('#account')).toHaveText(address,{timeout:2000});await expect(page.locator('#connect')).toBeEnabled({timeout:2000});await expect(page.locator('#asset-select')).toBeEnabled();await expect(page.locator('#state-PilotToken')).not.toContainText('已核验部署');expect(await page.evaluate(()=>window.requests)).not.toContain('eth_sendTransaction');
});
test('manual connect immediately requests wallet permission even when silent account read hangs',async({page})=>{
 await page.addInitScript(({address})=>{window.requests=[];window.ethereum={on:()=>{},request:async({method})=>{window.requests.push(method);if(method==='eth_accounts')return new Promise(()=>{});if(method==='eth_chainId')return '0x38';if(method==='eth_requestAccounts')return[address];throw Error('Unexpected '+method);}};},{address});await page.goto('/bridge.html');await page.waitForFunction(()=>window.requests.includes('eth_accounts'));
 await expect(page.locator('#connect')).toBeEnabled({timeout:1000});const before=Date.now();await page.locator('#connect').click();await page.waitForFunction(()=>window.requests.includes('eth_requestAccounts'),{},{timeout:1000});expect(Date.now()-before).toBeLessThan(1000);
});

for(const failureCode of [null,'SERVER_ERROR'])test('approval progress restores on failure '+failureCode,async({page})=>{
 await page.addInitScript(({address,failureCode})=>{
  if(failureCode)localStorage.setItem('tevumi-pilot-operations-v1',JSON.stringify([{account:address,chainId:56,assetId:'binancelife',key:'approve',txHash:'0x'+'1'.repeat(64)}]));
  window.requests=[];window.ethereum={on:()=>{},request:async({method})=>{
   window.requests.push(method);
   if(method==='eth_accounts'){
    if(window.holdApproval)return new Promise((resolve,reject)=>{window.failApproval=()=>reject(failureCode?Object.assign(new Error('private RPC URL must not appear'),{code:failureCode}):new Error('钱包读取失败，请重试。'));});
    return[address];
   }
   if(method==='eth_chainId')return '0x38';
   if(method==='eth_getBalance')return '0x0';
   if(method==='eth_blockNumber')return '0x1';
   throw Error('Unexpected '+method);
  }};
 },{address,failureCode});
 await page.goto('/bridge.html');
 await expect(page.locator('#prepare-send')).toBeEnabled();
 if(failureCode)await page.locator('#asset-select').selectOption('binancelife');
 await page.evaluate(()=>window.holdApproval=true);
 await page.locator('#prepare-send').click();
 await expect(page.locator('#prepare-send')).toHaveText('正在准备跨链…',{timeout:1000});
 await expect(page.locator('#prepare-send')).toBeDisabled();
 await expect(page.locator('#flow-progress')).toBeVisible();
 await expect(page.locator('#flow-progress')).toContainText('正在核验');
 await expect(page.locator('#flow-review')).not.toBeVisible();
 await page.waitForFunction(()=>!!window.failApproval);
 await page.evaluate(()=>{window.holdApproval=false;window.failApproval();});
 await expect(page.locator('#prepare-send')).toBeEnabled();
 await expect(page.locator('#prepare-send')).not.toHaveText('正在准备跨链…');
 await expect(page.locator('#flow-progress')).toContainText(failureCode?'RPC 服务未正常响应':'本次操作未完成');
 if(failureCode){await expect(page.locator('#message')).toContainText('RPC 服务未正常响应');await expect(page.locator('#message')).not.toContainText('private RPC');}
 expect(await page.evaluate(()=>window.requests)).not.toContain('eth_sendTransaction');
});
