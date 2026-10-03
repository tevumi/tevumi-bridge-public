import { chromium } from '@playwright/test';

const origin = process.argv.includes('--public') ? 'https://bridge.tevumi.com/' : 'http://127.0.0.1:5190/preview/web/preview/';
const browser = await chromium.launch({headless:true});
try {
  for (const [name, viewport] of [['desktop',{width:1440,height:1024}],['mobile',{width:390,height:844}]]) {
    const page = await browser.newPage({viewport});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    await page.locator('#chain-state').getByText(/BSC：发送/).waitFor({state:'attached',timeout:30000});
    if (await page.locator('#tab-journey').getAttribute('aria-pressed') !== 'true') throw Error(`JOURNEY_DEFAULT_${name}`);
    if (!(await page.locator('#wotr-journey').isVisible()) || await page.locator('#asset-picker').isVisible()) throw Error(`JOURNEY_TAB_${name}`);
    if (await page.locator('#journey-buy-action').isEnabled() || await page.locator('#journey-swap-action').isEnabled()) throw Error(`UNCONNECTED_SIGN_${name}`);
    if (!(await page.locator('#journey-buy-card').isVisible()) || await page.locator('#journey-swap-card').isVisible()) throw Error(`STEP_DEFAULT_${name}`);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error(`JOURNEY_OVERFLOW_${name}`);
    await page.screenshot({path:`.local/wotr-journey-${name}.png`,fullPage:true});
    await page.locator('#journey-step-bridge').click();
    if (!(await page.locator('#journey-bridge-card').isVisible()) || await page.locator('#journey-buy-card').isVisible()) throw Error(`STEP_BRIDGE_${name}`);
    await page.locator('#journey-open-bridge').click();
    await page.locator('#selected-name').getByText('WOTR').waitFor({timeout:30000});
    if (await page.locator('#direction-bsc').getAttribute('aria-pressed') !== 'true' || !(await page.locator('#asset-picker').isVisible())) throw Error(`WOTR_BRIDGE_HANDOFF_${name}`);
    if (errors.length) throw Error(`PAGE_ERRORS_${name}:${errors.join(',')}`);
    await page.close();
  }
  const page = await browser.newPage({viewport:{width:1440,height:1024}});
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    const address='0x67bfb3BeF4f4A3Cb25Bc529E948d40bcfc0874CD';
    window.ethereum={request:async({method})=>{
      if(method==='eth_requestAccounts'||method==='eth_accounts')return[address];
      if(method==='eth_chainId')return'0x38';
      throw Error(`UNEXPECTED_WALLET_METHOD_${method}`);
    }};
  });
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.locator('#tab-journey').click();
  await page.locator('#journey-connect').click();
  await page.locator('#journey-wallet').getByText(/Connected:/).waitFor({timeout:30000});
  await page.locator('#journey-buy-refresh').click();
  await page.locator('#journey-buy-quote').getByText(/Estimated receive:/).waitFor({timeout:30000});
  if (!(await page.locator('#journey-buy-action').isEnabled())) throw Error('LIVE_BUY_QUOTE_DID_NOT_ENABLE');
  await page.locator('#journey-step-swap').click();
  await page.locator('#journey-wotr').fill('1000000000');
  await page.locator('#journey-swap-refresh').click();
  await page.locator('#journey-swap-status').getByText(/Not enough WOTR/).waitFor({timeout:30000});
  if (await page.locator('#journey-swap-action').isEnabled()) throw Error('ARC_SWAP_WITHOUT_WOTR');
  if(errors.length)throw Error(`WALLET_PAGE_ERRORS:${errors.join(',')}`);
  await page.close();
  console.log(JSON.stringify({status:'WOTR_JOURNEY_UI_OK',origin}));
} finally { await browser.close(); }
