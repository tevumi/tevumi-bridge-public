import {connectWallet} from './wallet-helper.mjs';
import {test,expect} from '@playwright/test';
import {network} from 'hardhat';
import {BrowserProvider,ContractFactory,Contract,zeroPadValue,Interface,MaxUint256} from 'ethers';
import {readFileSync} from 'node:fs';
import {deployment,chains,artifacts} from '../../web/src/pilot.js';
import {routes} from '../../web/src/routes.js';

test('configuration reviews, approval and two-chain receipt verification require explicit wallet actions',async({page})=>{
  test.setTimeout(180000);
  const sides={},records=[],sent=[];let active=56,failRemoteRead=false,alterApproval=true;
  try {
    for(const id of [56,5042]) {
      const local=await network.create({network:'local',override:{chainId:id}});
      const provider=new BrowserProvider(local.provider,undefined,{cacheTimeout:-1}),signer=await provider.getSigner(),account=await signer.getAddress();
      const artifact=JSON.parse(readFileSync('artifacts/build.json')).output.contracts['contracts/test/MockEndpoint.sol'].MockEndpoint;
      const endpoint=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,signer).deploy(chains[id].eid);await endpoint.waitForDeployment();
      await local.provider.request({method:'hardhat_setCode',params:[chains[id].endpoint,await provider.getCode(await endpoint.getAddress())]});
      const r=routes[id];for(const address of [r.sendLibrary,r.receiveLibrary,r.executor,...r.dvns]) await local.provider.request({method:'hardhat_setCode',params:[address,'0x00']});
      sides[id]={local,provider,signer,account,endpoint:new Contract(chains[id].endpoint,artifact.abi,signer)};
      for(const kind of id===56?['PilotToken','PilotAdapter']:['PilotOFT']) {
        const plan=await deployment(kind,account,'0.000001','0.000010',records.find(r=>r.kind==='PilotToken')?.address);
        const tx=await signer.sendTransaction({data:plan.data}),receipt=await tx.wait();
        records.push({...plan,txHash:tx.hash,status:'confirmed',address:receipt.contractAddress});
      }
    }
    await page.exposeFunction('flowWallet',async({method,params=[]})=>{
      if(method==='wallet_switchEthereumChain'){active=Number(params[0].chainId);return null;}
      if(method==='eth_requestAccounts')method='eth_accounts';
      if(method==='eth_sendTransaction' && params[0].data?.startsWith('0x095ea7b3') && alterApproval){const i=new Interface(['function approve(address,uint256)']);const d=i.decodeFunctionData('approve',params[0].data);params[0].data=i.encodeFunctionData('approve',[d[0],MaxUint256]);alterApproval=false;}
      if(method==='eth_sendTransaction')sent.push({chainId:active,...params[0]});
      return sides[active].local.provider.request({method,params});
    });
    await page.addInitScript(records=>{
      if(!localStorage.getItem('tevumi-pilot-deployments-v1'))localStorage.setItem('tevumi-pilot-deployments-v1',JSON.stringify(records));
      const handlers={};window.ethereum={request:async p=>{const result=await window.flowWallet(p);if(p.method==='wallet_switchEthereumChain')handlers.chainChanged?.forEach(f=>f(p.params[0].chainId));return result;},on:(e,f)=>(handlers[e]??=[]).push(f)};
      window.invalidateWallet=()=>handlers.accountsChanged?.forEach(f=>f([]));
    },records);
    for(const id of [56,5042]) for(const url of [chains[id].rpc,chains[id].deliveryRpc].filter(Boolean)) await page.route(url+'/**',async route=>{
      const request=route.request();if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});return;}
      const input=request.postDataJSON();
      if(failRemoteRead){const reject=q=>({id:q.id,jsonrpc:'2.0',error:{code:-32602,message:'Archive requests require a personal token'}});await route.fulfill({json:Array.isArray(input)?input.map(reject):reject(input),headers:{'access-control-allow-origin':'*'}});return;}
      const run=async q=>{try{return {id:q.id,jsonrpc:'2.0',result:await sides[id].local.provider.request({method:q.method,params:q.params??[]})};}catch(e){return {id:q.id,jsonrpc:'2.0',error:{code:-32000,message:e.message}};}};
      await route.fulfill({json:Array.isArray(input)?await Promise.all(input.map(run)):await run(input),headers:{'access-control-allow-origin':'*'}});
    });
    await page.goto('/');await connectWallet(page);
    failRemoteRead=true;await page.locator('#check-route').click();
    await expect(page.locator('#route-state')).toContainText('链上读取失败');
    await expect(page.locator('#check-route')).toBeEnabled();
    await expect(page.locator('#flow-review')).not.toBeVisible();expect(sent).toHaveLength(0);
    failRemoteRead=false;
    await page.locator('#prepare-send').click();await expect(page.locator('#message')).toContainText('配置尚未全部通过');expect(sent).toHaveLength(0);
    const confirm=async()=>{await expect(page.locator('#flow-review')).toBeVisible();await expect(page.locator('#flow-sign')).toBeDisabled();await page.locator('#flow-ack').check();await page.locator('#flow-sign').click();await expect(page.locator('#message')).toContainText('操作已提交');};
    for(const id of [56,5042]) {
      if(id===5042){await page.locator('#switch-arc').click();await expect(page.locator('#network')).toHaveText('Arc Mainnet');}
      for(let i=0;i<6;i++){await page.locator('#prepare-config').click();await confirm();}
    }
    await page.locator('#check-route').click();await expect(page.locator('#route-state')).toContainText('两侧配置与实验方案一致');
    expect(sent).toHaveLength(12);
    await page.locator('#switch-bsc').click();await expect(page.locator('#network')).toHaveText('BSC Mainnet');
    await page.locator('#prepare-send').click();await expect(page.locator('#message')).toContainText('先授权');
    await page.locator('#prepare-approve').click();await confirm();expect(sent).toHaveLength(13);
    await page.locator('#refresh-operations').click();await expect(page.locator('#operations')).toContainText('实际授权额度与预览不符');
    await page.locator('#prepare-send').click();await expect(page.locator('#message')).toContainText('授权额度超过');
    await page.locator('#prepare-approve').click();await expect(page.locator('#flow-title')).toHaveText('修正授权额度');await confirm();expect(sent).toHaveLength(14);
    await page.locator('#prepare-send').click();await expect(page.locator('#flow-review')).toBeVisible();
    // A wallet event closes and invalidates an otherwise valid send preview.
    await page.evaluate(()=>window.invalidateWallet());await expect(page.locator('#flow-review')).not.toBeVisible();expect(sent).toHaveLength(14);
    await connectWallet(page);await page.locator('#prepare-send').click();await confirm();expect(sent).toHaveLength(15);
    await page.locator('#refresh-operations').click();await expect(page.locator('#operations')).toContainText('等待目标链到账');
    await page.locator('#prepare-send').click();await expect(page.locator('#message')).toContainText('未核验到账');expect(sent).toHaveLength(15);
    const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('tevumi-pilot-operations-v1')));
    const source=stored.at(-1),receipt=await sides[56].provider.getTransactionReceipt(source.txHash);
    const packet=receipt.logs.map(l=>{try{return sides[56].endpoint.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='Packet');
    const adapter=records.find(r=>r.kind==='PilotAdapter').address,oft=records.find(r=>r.kind==='PilotOFT').address;
    const receive=await sides[5042].endpoint.deliver(oft,[30102,zeroPadValue(adapter,32),packet.args.nonce],packet.args.guid,packet.args.message);await receive.wait();
    failRemoteRead=true;
    await page.reload();await connectWallet(page);
    await expect(page.locator('#operations')).toContainText('查询暂时失败',{timeout:25000});
    expect(sent).toHaveLength(15);
    failRemoteRead=false;
    await expect(page.locator('#operations')).toContainText('目标链到账事件已核验',{timeout:35000});
    await expect(page.locator('#operations a').filter({hasText:'目标链交易'})).toHaveAttribute('href',chains[5042].explorer+'/tx/'+receive.hash);
    await page.reload();await connectWallet(page);await expect(page.locator('#operations')).toContainText('待重新核验');
    await page.locator('#refresh-operations').click();await expect(page.locator('#operations')).toContainText('目标链到账事件已核验');
    await page.locator('#switch-arc').click();await expect(page.locator('#network')).toHaveText('Arc Mainnet');
    await expect(page.locator('#prepare-approve')).toBeDisabled();await page.locator('#prepare-send').click();await expect(page.locator('#flow-title')).toHaveText('Arc → BSC 赎回');
    await page.screenshot({path:'test-results/bridge-redeem-review.png',fullPage:true});
    await page.locator('#flow-close').click();await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:'test-results/bridge-mobile.png',fullPage:true});
  } finally {for(const s of Object.values(sides))await s.local.close();}
});
