import {connectWallet} from './wallet-helper.mjs';
import {test,expect} from '@playwright/test';
import {network} from 'hardhat';
import {BrowserProvider,ContractFactory,JsonRpcSigner,Contract,AbiCoder,keccak256,toBeHex,zeroPadValue} from 'ethers';
import {readFileSync} from 'node:fs';
import {chains} from '../../web/src/pilot.js';
import {routes} from '../../web/src/routes.js';
import {realDeployment,tester,realAssets} from '../../web/src/real-deployment.js';
import {configurationSteps} from '../../web/src/bridge.js';
import {pairFor} from '../../web/src/real-route.js';

test('real asset product approves exact amount, sends, detects delivery and isolates the next asset',async({page})=>{
 test.setTimeout(60000);
 const sides={},records=[],sent=[],deploymentReads=[],receiptReads=[];let active=56,failArcReads=false;
 const countRead=(id,method,params)=>{if(method==='eth_getTransactionReceipt')receiptReads.push(params[0]);if(method==='eth_getTransactionReceipt'&&records.some(r=>r.chainId===id&&r.txHash===params[0]))deploymentReads.push(id);};try{
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
 await page.exposeFunction('cfgWallet',async({method,params=[]})=>{if(['eth_accounts','eth_requestAccounts'].includes(method))return [tester];if(method==='eth_sendTransaction')sent.push(params[0]);countRead(active,method,params);return sides[active].local.provider.request({method,params});});
 await page.addInitScript(()=>{const h={};window.ethereum={request:p=>{if(p.method==='eth_getTransactionReceipt'&&window.holdRecordedReceipt&&p.params[0]===window.lastSubmittedHash)return Promise.resolve(null);if(p.method==='eth_sendTransaction'&&window.rejectNextSignature){window.rejectNextSignature=false;return Promise.reject(Object.assign(new Error('User rejected'),{code:4001}));}return window.cfgWallet(p).then(result=>{if(p.method==='eth_sendTransaction')window.lastSubmittedHash=result;return result;});},on:(e,f)=>(h[e]??=[]).push(f)};window.invalidateCfg=()=>h.accountsChanged?.forEach(f=>f([]));});
 for(const id of [56,5042])await page.route(chains[id].rpc+'/**',async route=>{const req=route.request();if(req.method()==='OPTIONS'){await route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});return;}const run=async q=>{if(failArcReads&&id===5042&&q.method==='eth_call')return {jsonrpc:'2.0',id:q.id,error:{code:-32000,message:'local simulated read failure',data:'0x'}};countRead(id,q.method,q.params??[]);return {jsonrpc:'2.0',id:q.id,result:await sides[id].local.provider.request({method:q.method,params:q.params??[]})};};const q=req.postDataJSON();await route.fulfill({json:Array.isArray(q)?await Promise.all(q.map(run)):await run(q),headers:{'access-control-allow-origin':'*'}});});
 const balanceSlot=keccak256(AbiCoder.defaultAbiCoder().encode(['address','uint256'],[tester,0]));
 for(const asset of realAssets){
  await sides[56].local.provider.request({method:'hardhat_setStorageAt',params:[asset.sourceToken,balanceSlot,toBeHex(10n**18n,32)]});
  const pair=pairFor(asset.id,records);
  for(const id of [56,5042])for(const step of configurationSteps(id,chains[id],pair[id].address,pair[id===56?5042:56].address))await(await new JsonRpcSigner(sides[id].p,tester).sendTransaction({to:step.to,data:step.data})).wait();
 }
 await page.goto('/bridge.html');await connectWallet(page);await page.locator('#asset-select').selectOption('binancelife');
 await expect(page.locator('#token-balance')).toContainText('1.0 币安人生');await expect(page.locator('#asset-status')).toContainText('已通过新版小额往返验证');
 failArcReads=true;
 await page.locator('#prepare-send').click();await expect(page.locator('#message')).toContainText('未取得明确回退原因');
 expect(sent).toHaveLength(0);await expect(page.locator('#flow-review')).not.toBeVisible();
 const failedTrace=await page.evaluate(()=>JSON.parse(localStorage.getItem('tevumi-flow-timing-v1')).at(-1));
 expect(failedTrace.errorCode).toBe('CALL_FAILED');
 expect(failedTrace.reads.some(r=>r.status==='error'&&r.label.startsWith('5042:call:'))).toBe(true);
 failArcReads=false;
 await page.locator('#prepare-send').click();await expect(page.locator('#flow-review')).toBeVisible();await expect(page.locator('#flow-details')).toContainText('币安人生');await expect(page.locator('#flow-sign')).toBeDisabled();expect(sent).toHaveLength(0);
 await page.evaluate(()=>window.rejectNextSignature=true);
 await page.locator('#flow-ack').check();await page.locator('#flow-sign').click();await expect(page.locator('#message')).toContainText('已取消钱包操作');expect(sent).toHaveLength(0);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('tevumi-pilot-operations-v1')||'[]'))).toHaveLength(0);
 await page.locator('#prepare-send').click();await expect(page.locator('#flow-review')).toBeVisible();
 await page.locator('#flow-ack').check();await page.locator('#flow-sign').click();await expect(page.locator('#message')).toContainText('授权已确认',{timeout:15000});expect(sent).toHaveLength(1);await expect(page.locator('#flow-title')).toContainText('确认跨链');await expect(page.locator('#flow-ack')).not.toBeChecked();await expect(page.locator('#flow-sign')).toBeDisabled();await page.locator('#flow-close').click();
 const diagnostics=await page.evaluate(()=>JSON.parse(localStorage.getItem('tevumi-flow-timing-v1')));
 expect(diagnostics.some(r=>r.marks.some(m=>m.label==='预览框已显示'))).toBe(true);
 expect(diagnostics.some(r=>r.marks.some(m=>m.label==='已向钱包提交 eth_sendTransaction 请求'))).toBe(true);
 expect(diagnostics.some(r=>r.reads.some(m=>m.label.includes('含用户确认及广播')&&m.durationMs>=0))).toBe(true);
 expect(JSON.stringify(diagnostics)).not.toContain(tester);
 expect(JSON.stringify(diagnostics)).not.toContain('https://');
 await expect(page.locator('#flow-timing summary')).toHaveText('查看 / 复制耗时诊断');

 deploymentReads.length=0;
 await page.locator('#prepare-send').click();await expect(page.locator('#flow-review')).toBeVisible();expect(deploymentReads.filter(id=>id===56)).toHaveLength(1);expect(deploymentReads.filter(id=>id===5042)).toHaveLength(1);await expect(page.locator('#receive-estimate')).toHaveText('0.000001 币安人生');await expect(page.locator('#fee-estimate')).toContainText('BNB');await page.locator('#flow-ack').check();await page.locator('#flow-sign').click();await expect(page.locator('#message')).toContainText('操作已提交');expect(sent).toHaveLength(2);
 const ops=await page.evaluate(()=>JSON.parse(localStorage.getItem('tevumi-pilot-operations-v1'))),record=ops.at(-1);expect(record.assetId).toBe('binancelife');
 const pair=pairFor('binancelife',records),receipt=await sides[56].p.getTransactionReceipt(record.txHash),epAbi=build['contracts/test/MockEndpoint.sol'].MockEndpoint.abi;
 const ep=new Contract(chains[56].endpoint,epAbi,sides[56].p),packet=receipt.logs.map(l=>{try{return ep.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='Packet').args;
 const target=new Contract(chains[5042].endpoint,epAbi,new JsonRpcSigner(sides[5042].p,tester));const delivery=await target.deliver(pair[5042].address,[30102,zeroPadValue(pair[56].address,32),packet.nonce],packet.guid,packet.message);await delivery.wait();
 await page.goto('/bridge.html#history');await connectWallet(page);await page.locator('#refresh-operations').click();await expect(page.locator('#operations')).toContainText('目标链到账事件已核验');
 await expect(page.locator('#operations a').filter({hasText:'目标链交易'})).toHaveAttribute('href',chains[5042].explorer+'/tx/'+delivery.hash);

 // Many completed rows must not add historical RPC work to either authorization click.
 await page.evaluate(()=>{const k='tevumi-pilot-operations-v1',rows=JSON.parse(localStorage.getItem(k));localStorage.setItem(k,JSON.stringify([...rows,...Array.from({length:100},()=>({...rows[0]}))]));});
 await page.goto('/bridge.html');await connectWallet(page);await page.locator('#asset-select').selectOption('binancelife');
 receiptReads.length=0;deploymentReads.length=0;
 await page.locator('#prepare-send').click();await expect(page.locator('#flow-review')).toBeVisible();
 for(const old of ops)expect(receiptReads).not.toContain(old.txHash);
 expect(deploymentReads.filter(id=>id===56)).toHaveLength(1);expect(deploymentReads.filter(id=>id===5042)).toHaveLength(1);
 await page.evaluate(()=>window.rejectNextSignature=true);receiptReads.length=0;
 await page.locator('#flow-ack').check();await page.locator('#flow-sign').click();
 await expect(page.locator('#message')).toContainText('已取消钱包操作');
 for(const old of ops)expect(receiptReads).not.toContain(old.txHash);
 expect(sent).toHaveLength(2);
 await page.goto('/bridge.html');await connectWallet(page);await page.locator('#asset-select').selectOption('cat');await page.locator('#prepare-send').click();await expect(page.locator('#flow-review')).toBeVisible();await expect(page.locator('#flow-details')).toContainText('CAT');await expect(page.locator('#flow-details')).toContainText(pairFor('cat',records)[5042].address);expect(sent).toHaveLength(2);
 await page.locator('#flow-close').click();await expect(page.locator('#receive-estimate')).toHaveText('预览核验后显示');await expect(page.locator('#token-balance')).toContainText('CAT');await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);

 // Closing the waiting step must stop continuation even though the approval was broadcast.
 await page.locator('#prepare-send').click();await expect(page.locator('#flow-review')).toBeVisible();
 await page.evaluate(()=>window.holdRecordedReceipt=true);await page.locator('#flow-ack').check();await page.locator('#flow-sign').click();
 await expect(page.locator('#flow-title')).toHaveText('等待授权确认');expect(sent).toHaveLength(3);
 await page.locator('#flow-close').click();await expect(page.locator('#prepare-send')).toBeEnabled({timeout:8000});
 await expect(page.locator('#flow-review')).not.toBeVisible();expect(sent).toHaveLength(3);
 await page.screenshot({path:'test-results/continuous-flow-mobile.png',fullPage:true});
 // A current-asset pending transaction still blocks a new preview.
 await page.evaluate(({record})=>{const k='tevumi-pilot-operations-v1',rows=JSON.parse(localStorage.getItem(k)).filter(r=>r.assetId!=='cat');rows.push({...record,txHash:'0x'+'9'.repeat(64),status:'pending'});localStorage.setItem(k,JSON.stringify(rows));},{record});
 await page.goto('/bridge.html');await connectWallet(page);await page.locator('#asset-select').selectOption('binancelife');
 await page.locator('#prepare-send').click();await expect(page.locator('#message')).toContainText('还有等待确认的操作');
 await expect(page.locator('#flow-review')).not.toBeVisible();expect(sent).toHaveLength(3);
 }finally{for(const s of Object.values(sides)){s.p.destroy();await s.local.close();}}
});
