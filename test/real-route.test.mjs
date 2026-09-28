import {test} from 'node:test';
import assert from 'node:assert/strict';
import {network} from 'hardhat';
import {BrowserProvider,ContractFactory,JsonRpcSigner,Contract,AbiCoder,keccak256,toBeHex,zeroPadValue} from 'ethers';
import {readFileSync} from 'node:fs';
import {chains} from '../web/src/pilot.js';
import {routes} from '../web/src/routes.js';
import {realDeployment,tester,realAssets} from '../web/src/real-deployment.js';
import {inspectRealPair,pairFor,assertRealConfigRecord} from '../web/src/real-route.js';
import {assertRealOperation,realOperationPair} from '../web/src/real-transfer.js';
import {verifyOperation,transferPlan,verifyDelivery} from '../web/src/bridge.js';
test('real-asset configuration binds both deployed originals and rejects cross-asset records',async()=>{
 const sides={},records=[];try{
 const build=JSON.parse(readFileSync('artifacts/build.json')).output.contracts;
 for(const id of [56,5042]){
  const local=await network.create({network:'local',override:{chainId:id}}),p=new BrowserProvider(local.provider,undefined,{cacheTimeout:-1});sides[id]={local,p};
  const signer=await p.getSigner(),a=build['contracts/test/MockEndpoint.sol'].MockEndpoint;
  const ep=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(chains[id].eid);await ep.waitForDeployment();
  await local.provider.request({method:'hardhat_setCode',params:[chains[id].endpoint,await p.getCode(await ep.getAddress())]});
  for(const addr of [routes[id].sendLibrary,routes[id].receiveLibrary,routes[id].executor,...routes[id].dvns])await local.provider.request({method:'hardhat_setCode',params:[addr,'0x00']});
  if(id===56){const token=build['contracts/pilot/PilotToken.sol'].PilotToken;const t=await new ContractFactory(token.abi,'0x'+token.evm.bytecode.object,signer).deploy(tester);await t.waitForDeployment();for(const asset of realAssets)await local.provider.request({method:'hardhat_setCode',params:[asset.sourceToken,await p.getCode(await t.getAddress())]});}
  await local.provider.request({method:'hardhat_impersonateAccount',params:[tester]});await local.provider.request({method:'hardhat_setBalance',params:[tester,'0x56bc75e2d63100000']});
  sides[id].signer=new JsonRpcSigner(p,tester);
  for(const asset of realAssets){const plan=await realDeployment(asset.id,id===56?'RestrictedAssetAdapter':'RestrictedAssetOFT'),tx=await sides[id].signer.sendTransaction({data:plan.data}),receipt=await tx.wait();records.push({...plan,txHash:tx.hash,address:receipt.contractAddress});}
 }
 const rpc=id=>sides[id].p;
 const balanceSlot=keccak256(AbiCoder.defaultAbiCoder().encode(['address','uint256'],[tester,0]));
 for(const asset of realAssets)await sides[56].local.provider.request({method:'hardhat_setStorageAt',params:[asset.sourceToken,balanceSlot,toBeHex(10n**18n,32)]});
 for(const assetId of ['binancelife','cat']){
  const pair=pairFor(assetId,records),before=await inspectRealPair(assetId,rpc,records);assert.equal(before[56].ready,false);
  for(const id of [56,5042])for(const step of before[id].steps){
   const record={...step,assetId,account:tester,sourceToken:pair[id].sourceToken};assertRealConfigRecord(record,records);
   assert.throws(()=>assertRealConfigRecord({...record,assetId:assetId==='cat'?'binancelife':'cat'},records));
   const tx=await sides[id].signer.sendTransaction({to:step.to,data:step.data,value:0n});await tx.wait();assert.equal((await verifyOperation({...record,txHash:tx.hash},rpc(id))).status,'confirmed');
  }
  const after=await inspectRealPair(assetId,rpc,records);assert.equal(after[56].ready,true);assert.equal(after[5042].ready,true);
  await realOperationPair(assetId,rpc,records);
  const metadata=id=>({assetId,account:tester,sourceToken:pair[56].sourceToken,sourceEid:chains[id].eid,destinationEid:chains[id].remote,destinationChainId:id===56?5042:56,destinationAddress:pair[id===56?5042:56].address});
  for(const id of [56,5042]){
   const mine=pair[id].address,token=id===56?pair[56].sourceToken:mine;
   if(id===56){
    const approval={...await transferPlan(rpc(id),id,chains[id],mine,token,tester,'0.000001',true),...metadata(id)};
    assertRealOperation(approval,records);assert.throws(()=>assertRealOperation({...approval,assetId:assetId==='cat'?'binancelife':'cat'},records));
    await(await sides[id].signer.sendTransaction({to:approval.to,data:approval.data})).wait();
   }
   const plan={...await transferPlan(rpc(id),id,chains[id],mine,token,tester,'0.000001',false),...metadata(id)};assertRealOperation(plan,records);
   assert.throws(()=>assertRealOperation({...plan,destinationAddress:tester},records));assert.throws(()=>assertRealOperation({...plan,amount:'2000000000000'},records));
   const tx=await sides[id].signer.sendTransaction({to:plan.to,data:plan.data,value:BigInt(plan.value)}),receipt=await tx.wait();
   const source=await verifyOperation({...plan,txHash:tx.hash},rpc(id));assert.equal(source.status,'sent');
   const epArtifact=build['contracts/test/MockEndpoint.sol'].MockEndpoint;
   const ep=new Contract(chains[id].endpoint,epArtifact.abi,sides[id].signer);
   const packet=receipt.logs.map(l=>{try{return ep.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='Packet').args;
   const dest=id===56?5042:56,remote=new Contract(chains[dest].endpoint,epArtifact.abi,sides[dest].signer);
   const delivery=await remote.deliver(pair[dest].address,[chains[id].eid,zeroPadValue(mine,32),packet.nonce],packet.guid,packet.message);await delivery.wait();
   assert.equal((await verifyDelivery(source,rpc(dest),delivery.hash)).status,'delivered');
  }
  assert.equal(await new Contract(pair[56].sourceToken,['function balanceOf(address) view returns(uint256)'],rpc(56)).balanceOf(pair[56].address),0n);
  if(assetId==='binancelife')assert.equal((await inspectRealPair('cat',rpc,records))[56].matches.peer,false);
 }
 const tampered=records.map(r=>r.assetId==='cat'&&r.chainId===5042?{...r,sourceToken:records[0].sourceToken}:r);assert.throws(()=>pairFor('cat',tampered));
 }finally{for(const s of Object.values(sides)){s.p.destroy();await s.local.close();}}
});
