import {connectWallet} from './wallet-helper.mjs';
import {test,expect} from '@playwright/test';
import {network} from 'hardhat';
import {BrowserProvider,ContractFactory,JsonRpcSigner} from 'ethers';
import {readFileSync} from 'node:fs';
import {chains} from '../../web/src/pilot.js';
import {routes} from '../../web/src/routes.js';
import {realDeployment,tester,realAssets} from '../../web/src/real-deployment.js';
test('real configuration review requires consent, rechecks chain state and keeps assets separate',async({page})=>{
 const sides={},records=[],sent=[];let active=56,authorized=false;try{
 const build=JSON.parse(readFileSync('artifacts/build.json')).output.contracts;
 for(const id of [56,5042]){
  const local=await network.create({network:'local',override:{chainId:id}}),p=new BrowserProvider(local.provider,undefined,{cacheTimeout:-1});sides[id]={local,p};
  const signer=await p.getSigner(),a=build['contracts/test/MockEndpoint.sol'].MockEndpoint;
  const ep=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(chains[id].eid);await ep.waitForDeployment();
  await local.provider.request({method:'hardhat_setCode',params:[chains[id].endpoint,await p.getCode(await ep.getAddress())]});
  for(const addr of [routes[id].sendLibrary,routes[id].receiveLibrary,routes[id].executor,...routes[id].dvns])await local.provider.request({method:'hardhat_setCode',params:[addr,'0x00']});
  if(id===56){const token=build['contracts/pilot/PilotToken.sol'].PilotToken;const t=await new ContractFactory(token.abi,'0x'+token.evm.bytecode.object,signer).deploy(tester);await t.waitForDeployment();for(const asset of realAssets)await local.provider.request({method:'hardhat_setCode',params:[asset.sourceToken,await p.getCode(await t.getAddress())]});}
  await local.provider.request({method:'hardhat_impersonateAccount',params:[tester]});await local.provider.request({method:'hardhat_setBalance',params:[tester,'0x56bc75e2d63100000']});
  const owner=new JsonRpcSigner(p,tester);
  for(const asset of realAssets){const plan=await realDeployment(asset.id,id===56?'RestrictedAssetAdapter':'RestrictedAssetOFT'),tx=await owner.sendTransaction({data:plan.data}),receipt=await tx.wait();records.push({...plan,txHash:tx.hash,address:receipt.contractAddress});}
 }
 await page.route('**/config/real-deployments.json*',route=>route.fulfill({contentType:'text/javascript',body:'export default '+JSON.stringify(records)}));
 await page.exposeFunction('cfgWallet',async({method,params=[]})=>{if(method==='eth_requestAccounts'){authorized=true;return [tester];}if(method==='eth_accounts')return authorized?[tester]:[];if(method==='eth_sendTransaction')sent.push(params[0]);return sides[active].local.provider.request({method,params});});
 await page.addInitScript(()=>{const h={};window.ethereum={request:p=>window.cfgWallet(p),on:(e,f)=>(h[e]??=[]).push(f)};window.invalidateCfg=()=>h.accountsChanged?.forEach(f=>f([]));});
 for(const id of [56,5042])await page.route(chains[id].rpc+'/**',async route=>{const req=route.request();if(req.method()==='OPTIONS'){await route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});return;}const run=async q=>({jsonrpc:'2.0',id:q.id,result:await sides[id].local.provider.request({method:q.method,params:q.params??[]})});const q=req.postDataJSON();await route.fulfill({json:Array.isArray(q)?await Promise.all(q.map(run)):await run(q),headers:{'access-control-allow-origin':'*'}});});
 await page.goto('/bridge.html#about');await page.locator('.advanced>summary').click();await expect(page.locator('#config-prepare')).toBeDisabled();await connectWallet(page);
 await page.locator('#config-prepare').click();await expect(page.locator('#config-review')).toBeVisible();await expect(page.locator('#config-sign')).toBeDisabled();expect(sent).toHaveLength(0);
 await page.evaluate(()=>window.invalidateCfg());await expect(page.locator('#config-review')).not.toBeVisible();await connectWallet(page);
 await page.locator('#config-prepare').click();await expect(page.locator('#config-review')).toBeVisible();await page.locator('#config-ack').check();await page.locator('#config-sign').click();await expect(page.locator('#config-message')).toContainText('交易已提交');expect(sent).toHaveLength(1);
 await page.locator('#config-check').click();await expect(page.locator('#config-states')).toContainText('✓ 设置对端可信合约');await expect(page.locator('#config-records')).toContainText('交易已核验');
 await page.locator('#config-prepare').click();await expect(page.locator('#config-title')).toHaveText('设置发送消息库');await page.locator('#config-close').click();
 await page.locator('#config-asset').selectOption('cat');await expect(page.locator('#config-records')).toBeEmpty();await page.locator('#config-prepare').click();await expect(page.locator('#config-title')).toHaveText('设置对端可信合约');await page.locator('#config-close').click();
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/real-config-mobile.png',fullPage:true});expect(sent).toHaveLength(1);
 }finally{for(const s of Object.values(sides)){s.p.destroy();await s.local.close();}}
});
