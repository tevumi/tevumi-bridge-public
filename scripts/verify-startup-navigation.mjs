// Keep RPC requests pending to check navigation during wallet restoration.
import {chromium} from '@playwright/test';
const origin=process.env.TEVUMI_BASE_URL || 'http://127.0.0.1:5323/preview/web/preview/';
const startUrl=new URL(origin);startUrl.searchParams.set('action','swap');
const browser=await chromium.launch({headless:true});
try {
 for(const [label,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]]){
  const page=await browser.newPage({viewport});
  const errors=[];let blocked=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(/https:\/\/(rpc\.mainnet\.arc\.io|bsc[^/]*|bsc-dataseed[^/]*)\//,()=>{blocked++;});
  await page.addInitScript(()=>{
   const account='0x67bfb3BeF4f4A3Cb25Bc529E948d40bcfc0874CD';
   sessionStorage.setItem('tevumi:wallet-session:v1',JSON.stringify({kind:'metamask',name:'MetaMask',rdns:'io.metamask',account}));
   const provider={isMetaMask:true,on:()=>{},removeListener:()=>{},request:async({method})=>{
    if(method==='eth_accounts')return[account];
    if(method==='eth_chainId')return'0x38';
    throw Error('UNEXPECTED_WALLET_REQUEST_'+method);
   }};
   window.ethereum=provider;
   window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{name:'MetaMask',rdns:'io.metamask'},provider}})));
  });
  for(let round=0;round<2;round++){
   if(round)await page.reload({waitUntil:'domcontentloaded'});else await page.goto(startUrl.href,{waitUntil:'domcontentloaded'});
   await page.locator('#header-connect.tevumi-active-wallet').waitFor({timeout:10000});
   if(!blocked)throw Error('RPC_NOT_PENDING');
   for(const tab of ['bridge','swap','buy']){
    const start=Date.now();
    if(!await page.locator('#nav-'+tab).isEnabled())throw Error('NAV_DISABLED_DURING_RESTORE_'+tab);
    await page.locator('#nav-'+tab).click({timeout:1500});
    if(await page.locator('#nav-'+tab).getAttribute('aria-current')!=='page')throw Error('NAV_DID_NOT_SWITCH_'+tab);
    if(Date.now()-start>1500)throw Error('NAV_WAITED_FOR_RPC');
    if(tab==='bridge' && await page.locator('#send-bsc').isEnabled())throw Error('BRIDGE_SEND_ENABLED_BEFORE_ROUTE_VERIFICATION');
   }
   await page.locator('#nav-swap').click();
   if(!await page.locator('#journey-swap-direction').isEnabled())throw Error('SWAP_DIRECTION_BLOCKED_BY_BRIDGE_READS');
   await page.locator('#journey-swap-direction').click({timeout:1500});
   if(!(await page.locator('#journey-swap-direction').textContent()).includes('USDC → WOTR'))throw Error('SWAP_DIRECTION_DID_NOT_SWITCH');
   await page.locator('[data-language="zh-CN"]').click({timeout:1500});
   if(await page.locator('#journey-swap-direction').textContent()!=='⇄ USDC → WOTR')throw Error('LANGUAGE_SWITCH_CHANGED_DIRECTION');
   await page.locator('[data-language="en"]').click({timeout:1500});
   if(await page.locator('#journey-swap-action').isEnabled())throw Error('UNQUOTED_SWAP_ENABLED');
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('MOBILE_OVERFLOW');
  }
  if(errors.length)throw Error(errors.join(','));
  console.log(JSON.stringify({label,reloads:2,blockedRpcRequests:blocked,status:'STARTUP_NAVIGATION_OK'}));
  await page.close();
 }
}finally{await browser.close();}
