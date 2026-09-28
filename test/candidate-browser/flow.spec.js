import {test,expect} from '@playwright/test';
async function state(request){return (await request.get('/__candidate/state')).json();}
async function prepare(page){await page.locator('#prepare').click();await expect(page.locator('#review')).toBeVisible();}
async function confirm(page){await page.locator('#ack').check();await page.locator('#confirm').click();}
async function send(page){await prepare(page);if(await page.locator('#review-title').textContent()==='确认精确授权'){await confirm(page);await expect(page.locator('#review-title')).toHaveText('确认跨链发送');await expect(page.locator('#ack')).not.toBeChecked();}await confirm(page);await expect(page.locator('#review')).not.toBeVisible();}
test.beforeEach(async({page,request})=>{
 const current=await state(request);expect(current.token).toBeTruthy();
 const reset=await request.post('/__candidate/reset',{headers:{'X-Candidate-Token':current.token},data:{}});expect(reset.ok()).toBeTruthy();
 await page.goto('/');await expect(page.locator('#prepare')).toBeEnabled();
});
test('candidate UI exact approval, cancellation, roundtrip and second account work without a real wallet',async({page,request})=>{
 await expect(page.locator('#balances')).toContainText('BSC 余额 100.0');
 await prepare(page);await expect(page.locator('#review-title')).toHaveText('确认精确授权');await expect(page.locator('#confirm')).toBeDisabled();
 await page.locator('#cancel').click();expect((await state(request)).assets[0].balances[0].allowance).toBe('0.0');
 await prepare(page);await confirm(page);await expect(page.locator('#review-title')).toHaveText('确认跨链发送');await expect(page.locator('#confirm')).toBeDisabled();
 expect((await state(request)).assets[0].balances[0].allowance).toBe('1.0');await page.locator('#cancel').click();expect((await state(request)).records).toHaveLength(0);
 await page.reload();await expect(page.locator('#prepare')).toBeEnabled();await send(page);
 await expect(page.locator('#records')).toContainText('目标链到账事件已核验');let s=await state(request);expect(s.assets[0].balances[0]).toEqual({bsc:'99.0',arc:'1.0',allowance:'0.0'});
 await page.locator('#side').selectOption('arc');await prepare(page);await expect(page.locator('#review-title')).toHaveText('确认跨链发送');await confirm(page);await expect(page.locator('#review')).not.toBeVisible();
 s=await state(request);expect(s.assets[0].principal).toBe('0.0');expect(s.assets[0].supply).toBe('0.0');expect(s.assets[0].balances[0].bsc).toBe('100.0');
 await page.locator('#asset').selectOption('cat');await page.locator('#account').selectOption('1');await page.locator('#side').selectOption('bsc');await page.locator('#amount').fill('2');await send(page);
 s=await state(request);expect(s.assets[1].balances[1].arc).toBe('2.0');expect(s.assets[1].balances[0].arc).toBe('0.0');expect(s.assets[0].principal).toBe('0.0');
 await page.screenshot({path:'test-results/candidate-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/candidate-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>typeof window.ethereum)).toBe('undefined');
});
test('pending delivery survives refresh, retries the same GUID, and failed source send rolls back',async({page,request})=>{
 await page.locator('#pause-receive').check();await page.locator('#faults').click();await expect(page.locator('#message')).toContainText('模拟条件已更新');await send(page);
 await expect(page.locator('#records')).toContainText('等待目标到账');const pending=(await state(request)).records[0];
 await page.reload();await expect(page.locator('#prepare')).toBeEnabled();await page.locator('#prepare').click();await expect(page.locator('#message')).toContainText('还有未到账消息');
 await page.locator('#records button').click();await expect(page.locator('#records')).toContainText('目标投递失败');
 await page.locator('#pause-receive').uncheck();await page.locator('#faults').click();await expect(page.locator('#message')).toContainText('模拟条件已更新');await page.locator('#records button').click();await expect(page.locator('#records')).toContainText('目标链到账事件已核验');
 let s=await state(request);expect(s.records).toHaveLength(1);expect(s.records[0].guid).toBe(pending.guid);expect(s.records[0].sourceHash).toBe(pending.sourceHash);expect(s.assets[0].principal).toBe('1.0');
 await page.locator('#asset').selectOption('cat');await page.locator('#fail-send').check();await page.locator('#faults').click();await expect(page.locator('#message')).toContainText('模拟条件已更新');await send(page);
 await expect(page.locator('#message')).toContainText('本地发送交易回滚');s=await state(request);expect(s.assets[1].principal).toBe('0.0');expect(s.assets[1].balances[0]).toEqual({bsc:'100.0',arc:'0.0',allowance:'1.0'});expect(s.records).toHaveLength(1);
 await page.locator('#fail-send').uncheck();await page.locator('#faults').click();await expect(page.locator('#message')).toContainText('模拟条件已更新');await send(page);expect((await state(request)).assets[1].principal).toBe('1.0');
 await page.locator('#amount').fill('11');await page.locator('#prepare').click();await expect(page.locator('#message')).toContainText('超出当前单笔');await expect(page.locator('#review')).not.toBeVisible();
});
test('local API rejects unauthenticated writes, foreign origin and repeated confirmation',async({request,page})=>{
 expect((await request.post('/__candidate/faults',{data:{failSend:true}})).status()).toBe(403);
 const s=await state(request),headers={'X-Candidate-Token':s.token};
 expect((await request.post('/__candidate/reset',{headers:{...headers,Origin:'https://example.com'},data:{}})).status()).toBe(403);
 const p=await(await request.post('/__candidate/preview',{headers,data:{asset:'cat',account:0,side:'bsc',amount:'1'}})).json();
 const send=()=>request.post('/__candidate/confirm',{headers,data:{id:p.result.id}});
 expect((await send()).ok()).toBe(true);expect((await send()).status()).toBe(400);
 const fresh=await state(request);expect(fresh.records).toHaveLength(0);expect(fresh.assets[1].balances[0].allowance).toBe('1.0');
 await page.locator('#refresh').click();await expect(page.locator('#prepare')).toBeEnabled();
});

test('lost confirmation response recovers from state without duplicate send',async({request,page})=>{
 const initial=await state(request),headers={'X-Candidate-Token':initial.token};
 const post=(path,data)=>request.post('/__candidate/'+path,{headers,data});
 const preview=await(await post('preview',{asset:'cat',account:0,side:'bsc',amount:'1'})).json();
 const approval=await(await post('confirm',{id:preview.result.id})).json();
 // Deliberately discard the send response, as if the browser lost the connection.
 const id=approval.result.next.id;
 const results=await Promise.all([post('confirm',{id,autoDeliver:false}),post('confirm',{id,autoDeliver:false})]);
 expect(results.map(r=>r.status()).sort()).toEqual([200,400]);
 await page.reload();await expect(page.locator('#records')).toContainText('等待目标到账');
 const pending=(await state(request)).records[0];
 expect((await state(request)).records).toHaveLength(1);
 await page.locator('#account').selectOption('1');await page.locator('#asset').selectOption('cat');
 await expect(page.locator('#balances')).toContainText('BSC 余额 100.0');
 await page.locator('#account').selectOption('0');await page.locator('#records button').click();
 await expect(page.locator('#records')).toContainText('目标链到账事件已核验');
 const final=await state(request);expect(final.records).toHaveLength(1);expect(final.records[0].sourceHash).toBe(pending.sourceHash);
 expect(final.assets[1].balances[0].arc).toBe('1.0');expect(final.assets[1].balances[1].arc).toBe('0.0');
});
