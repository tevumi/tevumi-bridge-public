import {test} from 'node:test';
import assert from 'node:assert/strict';
import {network} from 'hardhat';
import {BrowserProvider,ContractFactory,parseEther,zeroPadValue,ZeroAddress} from 'ethers';
import {compile} from '../scripts/compile.mjs';
import {selectAsset,selectedAsset,requirePilotAsset} from '../web/src/assets.js';
test('candidate selection fails closed and never enables real-asset sending',()=>{for(const id of ['cat','binancelife']){selectAsset(id);assert.equal(selectedAsset().enabled,false);assert.throws(requirePilotAsset);}assert.throws(()=>selectAsset('other'));selectAsset('tvpilot');requirePilotAsset();});
test('two real-asset contract pairs reject cross-asset messages and keep collateral independent',async()=>{
 const c=await network.create('local');try{const p=new BrowserProvider(c.provider,undefined,{cacheTimeout:-1}),s=await p.getSigner(),who=await s.getAddress(),build=compile();
 const deploy=async(name,args)=>{const a=Object.values(build).find(f=>f[name])[name];const x=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,s).deploy(...args);await x.waitForDeployment();return x;};
 const source=await deploy('MockEndpoint',[30102]),dest=await deploy('MockEndpoint',[30417]),pairs=[];const n=parseEther('0.000001');
 for(const symbol of ['币安人生','CAT']){const t=await deploy('PilotToken',[who]),a=await deploy('RestrictedAssetAdapter',[await t.getAddress(),await source.getAddress(),who,who,30417,n,n*10n]);const o=await deploy('RestrictedAssetOFTV2',[symbol,symbol,await t.getAddress(),await dest.getAddress(),who,who,30102,n,n*10n]);await(await a.setPeer(30417,zeroPadValue(await o.getAddress(),32))).wait();await(await o.setPeer(30102,zeroPadValue(await a.getAddress(),32))).wait();assert.equal(await o.sourceToken(),await t.getAddress());assert.equal(await o.name(),symbol);assert.equal(await o.symbol(),symbol);assert.equal(await o.totalSupply(),0n);pairs.push({t,a,o});}
 const params=eid=>[eid,zeroPadValue(who,32),n,n,'0x','0x','0x'];
 const send=async(contract,ep,eid)=>{const r=await(await contract.send(params(eid),[0,0],who)).wait();return r.logs.map(l=>{try{return ep.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='Packet').args;};
 const deliver=(ep,target,pkt,eid)=>ep.deliver(target,[eid,zeroPadValue(pkt.sender,32),pkt.nonce],pkt.guid,pkt.message);
 const first=pairs[0],second=pairs[1];await(await first.t.approve(await first.a.getAddress(),n)).wait();const pkt=await send(first.a,source,30417);
 await assert.rejects(deliver(dest,await second.o.getAddress(),pkt,30102));assert.equal(await second.o.totalSupply(),0n);assert.equal(await second.t.balanceOf(await second.a.getAddress()),0n);
 await(await deliver(dest,await first.o.getAddress(),pkt,30102)).wait();assert.equal(await first.o.totalSupply(),n);
 // Restricted sends do not disable ordinary ERC20 transfers; an outsider cannot redeem.
 const outsider=await p.getSigner(1),outside=await outsider.getAddress();
 await(await first.o.transfer(outside,n)).wait();assert.equal(await first.o.balanceOf(outside),n);
 await assert.rejects(first.o.connect(outsider).send(params(30102),[0,0],outside));
 await(await first.o.connect(outsider).transfer(who,n)).wait();
 const back=await send(first.o,dest,30102);
 await assert.rejects(deliver(source,await second.a.getAddress(),back,30417));await(await deliver(source,await first.a.getAddress(),back,30417)).wait();assert.equal(await first.t.balanceOf(await first.a.getAddress()),0n);assert.equal(await first.o.totalSupply(),0n);
 await assert.rejects(deploy('RestrictedAssetOFTV2',['X','X',ZeroAddress,await dest.getAddress(),who,who,30102,n,n]));
 await assert.rejects(deploy('RestrictedAssetOFTV2',['','X',await first.t.getAddress(),await dest.getAddress(),who,who,30102,n,n]));
 assert.equal(first.o.interface.fragments.some(f=>f.type==='function'&&f.name==='mint'),false);
 }finally{await c.close();}
});


test('V2 deployment copies exact original metadata and rejects stale metadata',async()=>{
 const {realDeployment,checkSourceMetadata}=await import('../web/src/real-deployment.js');
 const {Interface}=await import('ethers');const abi=new Interface(['function name() view returns(string)','function symbol() view returns(string)']);
 for(const [asset,name,symbol] of [['binancelife','币安人生','币安人生'],['cat','Simons Cat','CAT']]){
  const plan=await realDeployment(asset,'RestrictedAssetOFTV2');assert.deepEqual(plan.args.slice(0,2),[name,symbol]);
  const rpc=(bad=false)=>({getNetwork:async()=>({chainId:56n}),call:async tx=>{const fn=abi.parseTransaction(tx).name;return abi.encodeFunctionResult(fn,[bad?'wrong':fn==='name'?name:symbol]);}});
  await checkSourceMetadata(plan,rpc());await assert.rejects(checkSourceMetadata(plan,rpc(true)),/已变化/);
 }
});


test('archived peer configuration remains verifiable without accepting arbitrary peers',async()=>{
 const {assertRealConfigRecord,pairFor}=await import('../web/src/real-route.js');const {configurationSteps}=await import('../web/src/bridge.js');const {chains}=await import('../web/src/pilot.js');const {tester}=await import('../web/src/real-deployment.js');const {readFileSync}=await import('node:fs');
 const legacy=JSON.parse(readFileSync('config/real-deployments-legacy.json','utf8'));
 for(const assetId of ['binancelife','cat'])for(const records of [legacy,undefined]){const pair=pairFor(assetId,records);const step=configurationSteps(56,chains[56],pair[56].address,pair[5042].address).find(s=>s.key==='peer');const r={...step,assetId,chainId:56,account:tester,sourceToken:pair[56].sourceToken,value:'0'};assertRealConfigRecord(r);assert.throws(()=>assertRealConfigRecord({...r,data:r.data.slice(0,-40)+'1'.repeat(40)}));}
});

test('parallel V2 identity reads still reject every invalid identity field and RPC failure',async()=>{
 const {realDeployment,verifyRealDeployment,tester}=await import('../web/src/real-deployment.js');
 const {Interface}=await import('ethers');
 const abi=new Interface(['function sourceToken() view returns(address)','function name() view returns(string)','function symbol() view returns(string)']);
 const plan=await realDeployment('binancelife','RestrictedAssetOFTV2');
 const record={...plan,txHash:'0x'+'1'.repeat(64)},address='0x'+'2'.repeat(40);
 const rpc=(bad)=>({
  getNetwork:async()=>({chainId:5042n}),
  getTransactionReceipt:async()=>({status:1,contractAddress:address,blockNumber:1,gasUsed:1n}),
  getTransaction:async()=>({to:null,from:tester,value:0n,data:plan.data}),
  getCode:async()=>bad==='code'?'0x':'0x00',
  call:async tx=>{
   const fn=abi.parseTransaction(tx).name;
   if(bad==='rpc'&&fn==='symbol')throw Error('read failed');
   const value=fn==='sourceToken'?(bad===fn?address:plan.sourceToken):(bad===fn?'wrong':plan.args[fn==='name'?0:1]);
   return abi.encodeFunctionResult(fn,[value]);
  },
 });
 assert.equal((await verifyRealDeployment(record,rpc())).status,'confirmed');
 for(const bad of ['code','sourceToken','name','symbol','rpc'])await assert.rejects(verifyRealDeployment(record,rpc(bad)));
});
