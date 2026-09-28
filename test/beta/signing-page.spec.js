import {test,expect} from '@playwright/test';

test('loads six paused deployment steps without enabling a wallet action',async({page})=>{
 await page.goto('/deploy-beta/');
 await expect(page.getByRole('heading',{name:'公网测试版部署'})).toBeVisible();
 await expect(page.locator('.step')).toHaveCount(6);
 await page.getByText('查看逐笔状态与异常恢复').click();
 await expect(page.getByRole('button',{name:'在钱包签署此笔部署'})).toHaveCount(6);
 for(const button of await page.getByRole('button',{name:'在钱包签署此笔部署'}).all())await expect(button).toBeDisabled();
 await expect(page.getByRole('button',{name:'开始 / 继续部署'})).toBeDisabled();
 await expect(page.getByText('所有业务合约暂停')).toBeVisible();
});

test('rejects a different wallet account before enabling deployment',async({page})=>{
 await page.addInitScript(()=>{window.ethereum={request:async({method})=>{
  if(method==='eth_requestAccounts')return ['0x0000000000000000000000000000000000000001'];
  throw Error('UNEXPECTED_'+method);
 },on:()=>{}};});
 await page.goto('/deploy-beta/');
 await page.getByRole('button',{name:'连接部署钱包'}).click();
 await expect(page.locator('#message')).toContainText('指定的部署钱包');
 await page.getByText('查看逐笔状态与异常恢复').click();
 for(const button of await page.getByRole('button',{name:'在钱包签署此笔部署'}).all())await expect(button).toBeDisabled();
 await expect(page.getByRole('button',{name:'开始 / 继续部署'})).toBeDisabled();
});

test('stale nonce stops the one-click flow before a wallet send request',async({page})=>{
 await page.addInitScript(()=>{
  window.sent=[];
  window.ethereum={request:async({method})=>{
   window.sent.push(method);
   if(method==='eth_requestAccounts')return ['0x489594537CB76aC256079D710B6E18498E1a5402'];
   if(method==='eth_chainId')return '0x38';
   if(method==='eth_getCode')return '0x';
   if(method==='eth_getTransactionCount')return '0x0';
   throw Error('UNEXPECTED_'+method);
  },on:()=>{}};
 });
 await page.goto('/deploy-beta/');
 await page.getByRole('button',{name:'连接部署钱包'}).click();
 await expect(page.getByRole('button',{name:'开始 / 继续部署'})).toBeEnabled();
 await page.getByRole('button',{name:'开始 / 继续部署'}).click();
 await expect(page.locator('#message')).toContainText('pending nonce');
 expect(await page.evaluate(()=>window.sent.includes('eth_sendTransaction'))).toBe(false);
});

test('quotes gas independently and sends an explicit fee to the wallet',async({page})=>{
 await page.route('https://bsc-rpc.publicnode.com/',async route=>{
  const method=route.request().postDataJSON().method;
  const result={eth_chainId:'0x38',eth_getTransactionCount:'0x26',eth_estimateGas:'0x1573b4',eth_gasPrice:'0x2faf080',eth_getBalance:'0x100000000000000000'}[method];
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({jsonrpc:'2.0',id:1,result})});
 });
 await page.addInitScript(()=>{
  window.sentDeployment=null;
  window.ethereum={request:async({method,params})=>{
   if(method==='eth_requestAccounts')return ['0x489594537CB76aC256079D710B6E18498E1a5402'];
   if(method==='eth_chainId')return '0x38';
   if(method==='eth_getCode')return '0x';
   if(method==='eth_getTransactionCount')return '0x26';
   if(method==='eth_sendTransaction'){
    window.sentDeployment=params[0];
    throw Object.assign(Error('User rejected'),{code:4001});
   }
   throw Error('UNEXPECTED_'+method);
  },on:()=>{}};
 });
 await page.goto('/deploy-beta/');
 await page.getByRole('button',{name:'连接部署钱包'}).click();
 await page.getByText('查看逐笔状态与异常恢复').click();
 await page.getByRole('button',{name:'在钱包签署此笔部署'}).first().click();
 await expect(page.locator('#message')).toContainText('已在钱包拒绝');
 const sent=await page.evaluate(()=>window.sentDeployment);
 expect(sent).toMatchObject({nonce:'0x26',chainId:'0x38',gasPrice:'0x2faf080'});
 expect(BigInt(sent.gas)).toBeGreaterThan(1405876n);
 expect(BigInt(sent.gas)).toBeLessThan(2000000n);
});
