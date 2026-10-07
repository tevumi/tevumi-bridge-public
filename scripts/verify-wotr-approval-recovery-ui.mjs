import {chromium} from '@playwright/test';

const origin = process.env.TEVUMI_BASE_URL || (process.argv.includes('--public') ? 'https://bridge.tevumi.com/' : 'http://127.0.0.1:5190/preview/web/preview/');
const address = '0x67bfb3BeF4f4A3Cb25Bc529E948d40bcfc0874CD';
const approval = {
  state:'submitted', chainId:5042, nonce:11,
  to:'0x70Cedd901366ad932203BBB08B22DcD4d4510028', value:'0',
  data:'0x095ea7b3000000000000000000000000000000000022d473030f116ddee9f6b43ac78ba300000000000000000000000000000000000000000000001b1ae4d6e2ef500000',
  hash:'0x2279e699dd311618479db226186629db44c3ba9e61554f9200dd42c8d1e99845',
};
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage({viewport:{width:1440,height:1024}});
  const errors=[];
  const rpcErrors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',async response=>{if(!response.url().includes('rpc.mainnet.arc.io'))return;try{const body=await response.json();if(body.error)rpcErrors.push({method:response.request().postDataJSON()?.method,error:body.error});}catch{/* ignore non-JSON */}});
  await page.addInitScript(({address,approval})=>{
    localStorage.setItem(`tevumi-journey-v1:${address.toLowerCase()}:approve-token`,JSON.stringify(approval));
    window.ethereum={request:async({method})=>{
      if (method==='eth_requestAccounts'||method==='eth_accounts') return [address];
      if (method==='eth_chainId') return '0x13b2';
      throw Error(`UNEXPECTED_WALLET_METHOD_${method}`);
    }};
  },{address,approval});
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.locator('#nav-swap').click();
  await page.locator('#header-connect').click();
  await page.locator('.tevumi-wallet-other').click();
  await page.locator('#journey-swap-status').getByText(/WOTR approval confirmed/).waitFor({timeout:45000});
  await page.locator('#journey-wotr').fill('500');
  await page.locator('#journey-swap-refresh').click();
  await page.waitForFunction(() => /Not enough WOTR/.test(document.querySelector('#journey-swap-status')?.textContent || '') || document.querySelector('#journey-swap-action')?.textContent === 'Approve and swap' && !document.querySelector('#journey-swap-action').disabled,{timeout:30000});
  const insufficient = /Not enough WOTR/.test(await page.locator('#journey-swap-status').textContent());
  if (!insufficient && !(await page.locator('#journey-swap-action').isEnabled())) throw Error('NEXT_APPROVAL_NOT_ENABLED');
  if (errors.length) throw Error(`PAGE_ERRORS:${errors.join(',')}`);
  console.log(JSON.stringify({status:'WOTR_APPROVAL_RECOVERY_UI_OK',origin,approval:approval.hash}));
} finally {await browser.close();}
