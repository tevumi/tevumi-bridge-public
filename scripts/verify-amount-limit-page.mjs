import {chromium} from '@playwright/test';

const origin=process.argv.includes('--public')?'https://bridge.tevumi.com/deploy-now/limits.html':'http://127.0.0.1:5188/deploy-now/limits.html';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const account='0x489594537CB76aC256079D710B6E18498E1a5402';
  let chainId='0x38';
  window.ethereum={request:async({method,params})=>{
   if(method==='eth_requestAccounts'||method==='eth_accounts')return [account];
   if(method==='eth_chainId')return chainId;
   if(method==='wallet_switchEthereumChain'){chainId=params[0].chainId;return null;}
   if(method==='eth_sendTransaction'){window.__seenTx=params[0];throw {code:4001,message:'User rejected'};}
   throw Error(`Unexpected wallet method ${method}`);
  }};
 });
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 await page.locator('#state-bsc').getByText(/待签署/).waitFor({timeout:60000});
 await page.locator('#state-arc').getByText(/待签署/).waitFor({timeout:60000});
 await page.locator('#connect').click();
 await page.locator('#configure').click();
 await page.locator('#message').getByText(/钱包未提交配置交易/).waitFor({timeout:60000});
 const tx=await page.evaluate(()=>window.__seenTx);
 if(!tx||tx.chainId!=='0x38'||tx.to.toLowerCase()!=='0xb2039d774574d9171e143ca30aab48bb25b3f8e8'||tx.value!=='0x0')throw Error('UNEXPECTED_BSC_TRANSACTION');
 if(await page.locator('#recovery').isVisible())throw Error('REJECTION_MARKED_UNKNOWN');
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('MOBILE_OVERFLOW');
 if(errors.length)throw Error(`PAGE_ERRORS:${errors.join(',').slice(0,200)}`);
 console.log(JSON.stringify({status:'LIMIT_PAGE_OK',origin,walletResult:'REJECTED_WITHOUT_BROADCAST'}));
}finally{await browser.close();}
