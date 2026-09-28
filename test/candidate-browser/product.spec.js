import {test,expect} from '@playwright/test';
const state=async request=>(await request.get('/__candidate/state')).json();
async function confirm(page){await page.locator('#flow-ack').check();await page.locator('#flow-sign').click();}
async function send(page){await page.locator('#prepare-send').click();await expect(page.locator('#flow-review')).toBeVisible();if(await page.locator('#flow-title').textContent()==='确认精确授权'){await confirm(page);await expect(page.locator('#flow-title')).toHaveText('确认跨链发送');}await confirm(page);await expect(page.locator('#flow-review')).not.toBeVisible();}
test.beforeEach(async({page,request})=>{
 const s=await state(request);expect((await request.post('/__candidate/reset',{headers:{'X-Candidate-Token':s.token},data:{}})).ok()).toBe(true);
 await page.goto('/bridge.html');await expect(page.locator('#prepare-send')).toBeEnabled();
});
test('existing product page runs candidate approval, roundtrip, accounts and mobile layout',async({page,request})=>{
 await expect(page.locator('body')).toHaveClass('product');await expect(page.locator('#token-balance')).toContainText('100.0');
 await send(page);expect((await state(request)).assets[0].balances[0].arc).toBe('1.0');
 await page.locator('#choose-arc').click();await send(page);expect((await state(request)).assets[0].principal).toBe('0.0');
 await page.locator('#choose-bsc').click();await page.locator('#asset-select').selectOption('cat');await page.locator('#account').selectOption('1');await send(page);
 const s=await state(request);expect(s.assets[1].balances[1].arc).toBe('1.0');expect(s.assets[1].balances[0].arc).toBe('0.0');
 await page.screenshot({path:'test-results/candidate-product-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/candidate-product-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>typeof window.ethereum)).toBe('undefined');
});
test('product cancels stale account preview and recovers read interruption and pending delivery',async({page,request})=>{
 await page.locator('#prepare-send').click();await expect(page.locator('#flow-review')).toBeVisible();
 await page.evaluate(()=>{const a=document.getElementById('account');a.value='1';a.dispatchEvent(new Event('input'));});
 await expect(page.locator('#flow-review')).not.toBeVisible();expect((await state(request)).records).toHaveLength(0);
 await page.route('**/__candidate/preview',route=>route.abort());await page.locator('#prepare-send').click();await expect(page.locator('#prepare-send')).toBeEnabled();
 await expect(page.locator('#flow-review')).not.toBeVisible();expect((await state(request)).records).toHaveLength(0);await page.unroute('**/__candidate/preview');
 await page.locator('#auto-deliver').uncheck();await send(page);
 await page.goto('/bridge.html#history');await expect(page.locator('#operations')).toContainText('等待目标到账');
 const pending=(await state(request)).records[0];
 await page.locator('#operations button').click();await expect(page.locator('#operations')).toContainText('目标链到账事件已核验');
 expect((await state(request)).records[0].sourceHash).toBe(pending.sourceHash);
});
test('product blocks changed gas quote and rapid repeated confirmation',async({page,request})=>{
 await page.locator('#prepare-send').click();await expect(page.locator('#flow-review')).toBeVisible();
 const s=await state(request);expect((await request.post('/__candidate/gas-spike',{headers:{'X-Candidate-Token':s.token},data:{}})).ok()).toBe(true);
 await confirm(page);await expect(page.locator('#message')).toContainText('手续费已超过预览上限');expect((await state(request)).assets[0].balances[0].allowance).toBe('0.0');
 await page.locator('#prepare-send').click();await confirm(page);await expect(page.locator('#flow-title')).toHaveText('确认跨链发送');
 await page.locator('#flow-ack').check();await page.evaluate(()=>{const b=document.getElementById('flow-sign');b.click();b.click();});
 await expect(page.locator('#flow-review')).not.toBeVisible();expect((await state(request)).records).toHaveLength(1);
});
