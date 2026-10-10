// Read-only UI checks. RPC is held pending and no wallet is provided.
import {chromium} from '@playwright/test';
const origin=process.env.TEVUMI_BASE_URL || 'http://127.0.0.1:5322/preview/web/preview/';
const browser=await chromium.launch({headless:true});
try {
 for(const [label,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]]) {
  const page=await browser.newPage({viewport});const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route(/https:\/\/(rpc\.mainnet\.arc\.io|bsc[^/]*|bsc-dataseed[^/]*)\//,()=>{});
  const start=new URL(origin);start.searchParams.set('source','refresh-test');start.hash='keep';
  await page.goto(start.href,{waitUntil:'domcontentloaded'});
  for(const tab of ['buy','bridge','swap']) {
   await page.locator('#nav-'+tab).click();
   for(let round=0;round<2;round++) {
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(tab=>document.querySelector('#nav-'+tab)?.getAttribute('aria-current')==='page',tab);
    const url=new URL(page.url());
    if(url.searchParams.get('action')!==tab||url.searchParams.get('source')!=='refresh-test'||url.hash!=='#keep')throw Error('VIEW_URL_NOT_PRESERVED');
    if(await page.locator(tab==='swap'?'#source-swap-card':tab==='bridge'?'#asset-picker':`#journey-${tab}-card`).isHidden())throw Error('WRONG_VISIBLE_VIEW');
   }
  }
  const invalid=new URL(origin);invalid.searchParams.set('action','invalid');
  await page.goto(invalid.href,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#nav-buy').getAttribute('aria-current')==='page');
  const usdc=new URL(new URL(origin).hostname==='127.0.0.1' ? 'usdc/index.html' : '/preview/usdc/index.html',origin);
  await page.goto(usdc.href,{waitUntil:'domcontentloaded'});await page.reload({waitUntil:'domcontentloaded'});
  if(new URL(page.url()).pathname!==usdc.pathname)throw Error('USDC_REFRESH_LEFT_PAGE');
  if(errors.length)throw Error(errors.join(','));
  console.log(JSON.stringify({label,tabReloads:6,usdcReload:true,invalidFallback:true,status:'TAB_REFRESH_OK'}));
  await page.close();
 }
} finally {await browser.close();}
