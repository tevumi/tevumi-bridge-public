import {test,expect} from '@playwright/test';

test('shows two timelock schedules and keeps signing disabled until wallet connection',async({page})=>{
 await page.goto('/deploy-beta/config.html');
 await expect(page.getByRole('heading',{name:'安排双链配置'})).toBeVisible();
 await expect(page.locator('.step')).toHaveCount(2);
 await expect(page.getByRole('button',{name:'开始 / 继续安排配置'})).toBeDisabled();
 await expect(page.getByText('本页不会解除暂停或发送资产')).toBeVisible();
});

test('rejects another account before a schedule transaction',async({page})=>{
 await page.addInitScript(()=>{window.ethereum={request:async({method})=>{
  if(method==='eth_requestAccounts')return ['0x0000000000000000000000000000000000000001'];
  throw Error('UNEXPECTED_'+method);
 },on:()=>{}};});
 await page.goto('/deploy-beta/config.html');
 await page.getByRole('button',{name:'连接部署钱包'}).click();
 await expect(page.locator('#message')).toContainText('指定的部署钱包');
 await expect(page.getByRole('button',{name:'开始 / 继续安排配置'})).toBeDisabled();
});

test('quotes explicit gas and sends only the schedule call to the timelock',async({page})=>{
 await page.route('https://bsc-rpc.publicnode.com/',async route=>{
  const method=route.request().postDataJSON().method;
  const result={eth_chainId:'0x38',eth_getTransactionCount:'0x29',eth_estimateGas:'0x2bf20',eth_gasPrice:'0x2faf080',eth_getBalance:'0x100000000000000000'}[method];
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({jsonrpc:'2.0',id:1,result})});
 });
 await page.addInitScript(()=>{window.sentSchedule=null;window.ethereum={request:async({method,params})=>{
  if(method==='eth_requestAccounts')return ['0x489594537CB76aC256079D710B6E18498E1a5402'];
  if(method==='eth_accounts')return ['0x489594537CB76aC256079D710B6E18498E1a5402'];
  if(method==='eth_chainId')return '0x38';
  if(method==='eth_getCode')return '0x1234';
  if(method==='eth_call')return '0x'+'0'.repeat(64);
  if(method==='eth_getTransactionCount')return '0x29';
  if(method==='eth_sendTransaction'){window.sentSchedule=params[0];throw Object.assign(Error('User rejected'),{code:4001});}
  throw Error('UNEXPECTED_'+method);
 },on:()=>{}};});
 await page.goto('/deploy-beta/config.html');
 await page.getByRole('button',{name:'连接部署钱包'}).click();
 await page.getByRole('button',{name:'开始 / 继续安排配置'}).click();
 await expect(page.locator('#message')).toContainText('已在钱包拒绝');
 const sent=await page.evaluate(()=>window.sentSchedule);
 expect(sent).toMatchObject({to:'0x01dba01e9E6f40669d8D3036316967221Bc0081C',nonce:'0x29',chainId:'0x38',gasPrice:'0x2faf080'});
 expect(sent.data.slice(0,10)).toBe('0x8f2a0bb0');
 expect(BigInt(sent.gas)).toBeGreaterThan(180000n);
});
