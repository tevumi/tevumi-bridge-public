import {connectWallet} from './wallet-helper.mjs';
import {Interface} from 'ethers';
import {chains} from '../../web/src/pilot.js';
import {test,expect} from '@playwright/test';
import {network} from 'hardhat';
import {BrowserProvider,ContractFactory} from 'ethers';
import {readFileSync} from 'node:fs';
const owner='0x489594537CB76aC256079D710B6E18498E1a5402';
test('real deployment isolates assets, invalidates reviews, verifies receipts and recovers by hash on local EVM',async({page})=>{
 const local=await network.create({network:'local',override:{chainId:5042}}),p=new BrowserProvider(local.provider),sent=[];
 try{
  const a=JSON.parse(readFileSync('artifacts/build.json')).output.contracts['contracts/test/MockEndpoint.sol'].MockEndpoint;
  const ep=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,await p.getSigner()).deploy(30417);await ep.waitForDeployment();
  await local.provider.request({method:'hardhat_setCode',params:['0x6f475642a6e85809b1c36fa62763669b1b48dd5b',await p.getCode(await ep.getAddress())]});
  await local.provider.request({method:'hardhat_impersonateAccount',params:[owner]});
  await local.provider.request({method:'hardhat_setBalance',params:[owner,'0x56bc75e2d63100000']});
  await page.exposeFunction('realLocal',async({method,params=[]})=>{
   if(['eth_accounts','eth_requestAccounts'].includes(method))return [owner];
   if(method==='eth_sendTransaction')sent.push(params[0]);
   return local.provider.request({method,params});
  });
  await page.addInitScript(()=>{const listeners={};window.ethereum={request:p=>window.realLocal(p),on:(e,f)=>(listeners[e]??=[]).push(f)};window.invalidateWallet=()=>listeners.accountsChanged?.forEach(f=>f([]));});
  await page.route(chains[56].rpc+'/**',async route=>{const req=route.request();if(req.method()==='OPTIONS'){await route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});return;}const abi=new Interface(['function name() view returns(string)','function symbol() view returns(string)']);const run=q=>{let result='0x38';if(q.method==='eth_call'){const call=abi.parseTransaction({data:q.params[0].data});const cat=q.params[0].to.toLowerCase().startsWith('0x6894');result=abi.encodeFunctionResult(call.name,[cat?(call.name==='name'?'Simons Cat':'CAT'):'币安人生']);}return {jsonrpc:'2.0',id:q.id,result};};const q=req.postDataJSON();await route.fulfill({json:Array.isArray(q)?q.map(run):run(q),headers:{'access-control-allow-origin':'*'}});});
  await page.goto('/bridge.html#about');await page.locator('.advanced>summary').click();await connectWallet(page);
  await page.locator('#real-kind').selectOption('RestrictedAssetOFTV2');
  await page.locator('#real-prepare').click();await expect(page.locator('#real-review')).toBeVisible();expect(sent).toHaveLength(0);
  await expect(page.locator('#real-sign')).toBeDisabled();await page.locator('#real-ack').check();
  await page.evaluate(()=>window.invalidateWallet());await expect(page.locator('#real-review')).not.toBeVisible();expect(sent).toHaveLength(0);
  await connectWallet(page);await page.locator('#real-prepare').click();await expect(page.locator('#real-review')).toBeVisible();
  await page.locator('#real-ack').check();await page.locator('#real-sign').click();await expect(page.locator('#real-message')).toContainText('已提交');expect(sent).toHaveLength(1);
  await page.locator('#real-refresh').click();await expect(page.locator('#real-records')).toContainText('部署已核验');await expect(page.locator('#real-prepare')).toBeDisabled();
  await page.locator('#real-asset').selectOption('cat');await expect(page.locator('#real-prepare')).toBeEnabled();
  const hash=await page.evaluate(()=>JSON.parse(localStorage.getItem('tevumi-real-deployments-v1'))[0].txHash);
  await page.getByText('恢复已有部署交易',{exact:true}).click();await page.locator('#real-hash').fill(hash);await page.locator('#real-recover').click();await expect(page.locator('#real-message')).toContainText('不匹配');expect(sent).toHaveLength(1);
  await page.reload();await page.locator('.advanced>summary').click();await connectWallet(page);await expect(page.locator('#real-records')).toContainText('需链上核验');
  await page.locator('#real-refresh').click();await expect(page.locator('#real-records')).toContainText('部署已核验');
  await page.evaluate(()=>localStorage.removeItem('tevumi-real-deployments-v1'));await page.reload();await page.locator('.advanced>summary').click();await connectWallet(page);
  await page.locator('#real-kind').selectOption('RestrictedAssetOFTV2');await page.getByText('恢复已有部署交易',{exact:true}).click();await page.locator('#real-hash').fill(hash);await page.locator('#real-recover').click();await expect(page.locator('#real-message')).toContainText('已从链上恢复');await expect(page.locator('#real-prepare')).toBeDisabled();
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/real-deployment-mobile.png',fullPage:true});expect(sent).toHaveLength(1);
 }finally{p.destroy();await local.close();}
});
