import { test } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { BrowserProvider, ContractFactory, parseEther, zeroPadValue, AbiCoder, MaxUint256 } from 'ethers';
import { compile } from '../scripts/compile.mjs';
import { configurationSteps, inspectConfiguration, transferPlan, verifyOperation, verifyDelivery, parseAmount, ulnType, endpointAbi } from '../web/src/bridge.js';
import { Contract } from 'ethers';
import { routes } from '../web/src/routes.js';

test('reviewed configuration, exact approval, authentic event matching, and reverse redemption on two local EVMs', async () => {
  const build=compile(), connections=[];
  const deploy=async(name,args,signer)=>{
    const a=Object.values(build).find(f=>f[name])[name];
    const c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;
  };
  try {
    const sides={};
    for (const id of [56,5042]) {
      const local=await network.create({network:'local',override:{chainId:id}});connections.push(local);
      const provider=new BrowserProvider(local.provider,undefined,{cacheTimeout:-1}),signer=await provider.getSigner(),account=await signer.getAddress();
      const chain={eid:id===56?30102:30417,remote:id===56?30417:30102};
      const endpoint=await deploy('MockEndpoint',[chain.eid],signer);chain.endpoint=await endpoint.getAddress();
      const token=id===56?await deploy('PilotToken',[account],signer):null;
      const args=[chain.endpoint,account,account,chain.remote,parseEther('0.000002'),parseEther('0.000010')];
      const app=await deploy(id===56?'PilotAdapter':'PilotOFT',token?[await token.getAddress(),...args]:args,signer);
      const r=routes[id];
      for (const addr of [r.sendLibrary,r.receiveLibrary,r.executor,...r.dvns]) await local.provider.request({method:'hardhat_setCode',params:[addr,'0x00']});
      sides[id]={local,provider,signer,account,chain,endpoint,token:token??app,app,address:await app.getAddress()};
    }
    const inspect=async id=>{const s=sides[id],p=sides[id===56?5042:56];return inspectConfiguration(s.provider,id,s.chain,s.address,p.address,s.account,await s.token.getAddress(),'0.000002','0.000010');};
    for (const id of [56,5042]) {
      const s=sides[id],peer=sides[id===56?5042:56];
      assert.equal((await inspect(id)).ready,false);
      for (const step of configurationSteps(id,s.chain,s.address,peer.address)) await (await s.signer.sendTransaction({...step,value:0n})).wait();
      assert.equal((await inspect(id)).ready,true);
    }
    const b=sides[56],a=sides[5042];
    await assert.rejects(()=>transferPlan(b.provider,56,b.chain,b.address,awaitAddress(b.token),b.account,'0.000001'),/授权/);
    // Invalid precision and excess amounts are rejected before a wallet request.
    assert.throws(()=>parseAmount('0.0000001'),/6 位/);
    await assert.rejects(()=>transferPlan(b.provider,56,b.chain,b.address,awaitAddress(b.token),b.account,'0.000003'),/额度/);
    const approval=await transferPlan(b.provider,56,b.chain,b.address,await b.token.getAddress(),b.account,'0.000001',true);
    const altered=await b.token.approve(b.address,MaxUint256);await altered.wait();
    const mismatch=await verifyOperation({...approval,account:b.account,txHash:altered.hash},b.provider);
    assert.equal(mismatch.status,'approval-mismatch');
    assert.equal(mismatch.actualAmount,String(MaxUint256));
    await assert.rejects(()=>verifyOperation({...approval,account:b.account,txHash:altered.hash,data:b.token.interface.encodeFunctionData('approve',[a.address,1])},b.provider),/授权对象/);
    await assert.rejects(()=>transferPlan(b.provider,56,b.chain,b.address,awaitAddress(b.token),b.account,'0.000001'),/超过本次数量/);
    const correction=await transferPlan(b.provider,56,b.chain,b.address,await b.token.getAddress(),b.account,'0.000001',true);
    assert.equal(correction.label,'修正授权额度');
    assert.equal(correction.data,approval.data);
    await (await b.signer.sendTransaction({...correction,value:0n})).wait();
    assert.equal(await b.token.allowance(b.account,b.address),parseEther('0.000001'));
    const send=async(s,d)=>{
      const plan=await transferPlan(s.provider,Number((await s.provider.getNetwork()).chainId),s.chain,s.address,await s.token.getAddress(),s.account,'0.000001');
      const tx=await s.signer.sendTransaction({...plan,value:BigInt(plan.value)}),receipt=await tx.wait();
      const record={...plan,txHash:tx.hash,account:s.account,destinationEid:d.chain.eid,sourceEid:s.chain.eid,destinationChainId:Number((await d.provider.getNetwork()).chainId),destinationAddress:d.address};
      const verified=await verifyOperation(record,s.provider);assert.equal(verified.status,'sent');
      await assert.rejects(()=>verifyDelivery(verified,d.provider,tx.hash),/确认|匹配/);
      const packet=receipt.logs.map(l=>{try{return s.endpoint.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='Packet');
      const delivery=await d.endpoint.deliver(d.address,[s.chain.eid,zeroPadValue(s.address,32),packet.args.nonce],packet.args.guid,packet.args.message);await delivery.wait();
      await assert.rejects(()=>verifyDelivery({...verified,amount:String(parseEther('0.000002'))},d.provider,delivery.hash),/不包含匹配/);
      const delivered=await verifyDelivery(verified,d.provider,delivery.hash);assert.equal(delivered.status,'delivered');
      return delivered;
    };
    await send(b,a);
    assert.equal(await a.token.balanceOf(a.account),parseEther('0.000001'));
    await send(a,b);
    assert.equal(await b.token.balanceOf(b.address),0n);
    assert.equal(await a.token.totalSupply(),0n);
    assert.equal(await b.token.balanceOf(b.account),parseEther('1000'));
    // A changed peer and altered DVN threshold cannot remain "ready".
    await (await b.app.setPeer(b.chain.remote,zeroPadValue(b.account,32))).wait();
    assert.equal((await inspect(56)).matches.peer,false);
    const endpoint=new Contract(b.chain.endpoint,endpointAbi,b.signer),r=routes[56];
    const bad=AbiCoder.defaultAbiCoder().encode([ulnType],[[20,1,255,0,[r.dvns[0]],[]]]);
    await (await endpoint.setConfig(b.address,r.sendLibrary,[[b.chain.remote,2,bad]])).wait();
    assert.equal((await inspect(56)).matches.sendDVN,false);
    await assert.rejects(()=>inspectConfiguration(b.provider,56,b.chain,b.address,a.address,a.address,awaitAddress(b.token),'0.000002','0.000010'),/管理员/);
  } finally {for(const c of connections) await c.close();}
});
function awaitAddress(contract) { return contract.target; }
