import {chromium} from '@playwright/test';

const origin = process.env.TEVUMI_BASE_URL || 'http://127.0.0.1:5321/preview/web/preview/';
const wallet = '0x67bfb3BeF4f4A3Cb25Bc529E948d40bcfc0874CD';
const browser = await chromium.launch({headless:true});
try {
  for (const [label,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]]) {
    const page=await browser.newPage({viewport});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(address=>{
      const provider={isMetaMask:true,on:()=>{},removeListener:()=>{},request:async ({method})=>{
        if (method==='eth_requestAccounts') {
          sessionStorage.setItem('tevumi-test-wallet-prompts',String(Number(sessionStorage.getItem('tevumi-test-wallet-prompts') || 0)+1));
          return [address];
        }
        if (method==='eth_accounts') return [address];
        if (method==='eth_chainId') return '0x13b2';
        throw Error(`UNEXPECTED_WALLET_METHOD_${method}`);
      }};
      window.ethereum=provider;
      window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{name:'MetaMask',rdns:'io.metamask'},provider}})));
    },wallet);
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    await page.locator('#header-connect').click();
    await page.locator('.tevumi-wallet-option').first().click();
    await page.locator('#header-connect.tevumi-active-wallet').waitFor();
    await page.locator('#nav-swap').click();
    if (new URL(origin).hostname === '127.0.0.1') await page.goto(new URL('usdc/index.html',origin).href,{waitUntil:'domcontentloaded'});
    else await page.locator('#journey-usdc-link').click();
    await page.locator('#wallet-button.tevumi-active-wallet').waitFor({timeout:30000});
    if (!(await page.locator('#transfer-history').isVisible())) throw Error(`USDC_HISTORY_NOT_CONNECTED_${label}`);
    if (Number(await page.evaluate(()=>sessionStorage.getItem('tevumi-test-wallet-prompts'))) !== 1) throw Error(`USDC_REQUESTED_SECOND_CONNECTION_${label}`);
    if (new URL(origin).hostname === '127.0.0.1') await page.goto(origin,{waitUntil:'domcontentloaded'});
    else await page.locator('#back-link').click();
    await page.locator('#header-connect.tevumi-active-wallet').waitFor({timeout:30000});
    if (Number(await page.evaluate(()=>sessionStorage.getItem('tevumi-test-wallet-prompts'))) !== 1) throw Error(`HOME_REQUESTED_SECOND_CONNECTION_${label}`);
    if (errors.length) throw Error(`PAGE_ERRORS_${label}:${errors.join(',')}`);
    await page.close();
  }
  const guest=await browser.newPage();
  await guest.addInitScript(address=>{
    sessionStorage.setItem('tevumi:wallet-session:v1',JSON.stringify({kind:'metamask',name:'MetaMask',rdns:'io.metamask',account:address}));
    const provider={isMetaMask:true,request:async ({method})=>method==='eth_accounts' ? [] : (()=>{throw Error(`UNEXPECTED_PERMISSION_REQUEST_${method}`);})()};
    window.ethereum=provider;
    window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{name:'MetaMask',rdns:'io.metamask'},provider}})));
  },wallet);
  await guest.goto(new URL(origin).hostname==='127.0.0.1' ? new URL('usdc/index.html',origin).href : new URL('/preview/usdc/index.html',origin).href,{waitUntil:'domcontentloaded'});
  await guest.waitForTimeout(500);
  if (await guest.locator('#wallet-button.tevumi-active-wallet').count()) throw Error('RESTORED_WITHOUT_WALLET_AUTHORIZATION');
  await guest.close();
  console.log(JSON.stringify({status:'WALLET_NAVIGATION_OK',origin}));
} finally { await browser.close(); }
