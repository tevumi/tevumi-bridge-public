import {chromium} from '@playwright/test';

const browser=await chromium.launch({headless:true});
const errors=[];
try{
 for(const [label,viewport] of [['desktop',{width:1280,height:800}],['mobile',{width:390,height:844}]]){
  const page=await browser.newPage({viewport});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)errors.push(response.status()+' '+response.url());});
  await page.goto('https://bridge.tevumi.com/deploy-beta/',{waitUntil:'networkidle'});
  const actual={title:await page.title(),steps:await page.locator('.step').count(),enabled:await page.locator('#deploy-all:enabled').count()};
  if(actual.title!=='Tevumi · 公网测试版部署签名'||actual.steps!==6||actual.enabled!==0)throw Error('PAGE_STATE_MISMATCH:'+JSON.stringify(actual));
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('HORIZONTAL_OVERFLOW');
  await page.screenshot({path:`.local/beta-deploy-${label}.png`,fullPage:true});
  await page.close();
 }
 if(errors.length)throw Error('BROWSER_ERRORS:'+errors.join(',').slice(0,300));
 console.log(JSON.stringify({status:'LIVE_SIGNING_PAGE_OK',viewports:['1280x800','390x844'],deployments:6,unconnectedSignButtonsEnabled:0,errors:0}));
}finally{await browser.close();}
