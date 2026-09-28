import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {network} from 'hardhat';
import {BrowserProvider,ContractFactory,zeroPadValue,id,solidityPacked} from 'ethers';
import {compile} from '../scripts/compile.mjs';
import {collectSnapshot} from '../scripts/production-monitor.mjs';
import {reconcile} from '../scripts/production-reconcile.mjs';
import {openLogIndex} from '../scripts/production-log-index.mjs';
import {mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const U=10n**12n,connections=[];let build;
before(()=>{build=compile();});
after(async()=>{await Promise.all(connections.map(c=>c.close()));});
async function fixture(){
 const sides=[];
 for(const eid of [30102,30417]){
  const local=await network.create('local');connections.push(local);
  const p=new BrowserProvider(local.provider,undefined,{cacheTimeout:-1});
  const admin=await p.getSigner(0),alice=await p.getSigner(1),bob=await p.getSigner(2);
  const deploy=async(name,args)=>{const art=Object.values(build).find(f=>f[name])?.[name];const c=await new ContractFactory(art.abi,'0x'+art.evm.bytecode.object,admin).deploy(...args);await c.waitForDeployment();return c;};
  sides.push({p,admin,alice,bob,deploy,ep:await deploy('MockEndpoint',[eid])});
 }
 const [b,a]=sides,alice=await b.alice.getAddress(),bob=await b.bob.getAddress(),admin=await b.admin.getAddress();
 const token=await b.deploy('PilotToken',[admin]);
 const adapter=await b.deploy('ProductionAdapterHarness',[await token.getAddress(),await b.ep.getAddress(),admin,100n*U,[20,100,100],[20,100,100]]);
 const oft=await a.deploy('ProductionOFTHarness',[await token.name(),await token.symbol(),await token.getAddress(),await a.ep.getAddress(),admin,[20,100,100],[20,100,100]]);
 const ba=await adapter.getAddress(),aa=await oft.getAddress();
 await (await adapter.setPeer(30417,zeroPadValue(aa,32))).wait();await (await oft.setPeer(30102,zeroPadValue(ba,32))).wait();
 await (await token.transfer(alice,100n*U)).wait();await (await token.connect(b.alice).approve(ba,100n*U)).wait();
 const params=(n,dst,to)=>[dst,zeroPadValue(to,32),n*U,n*U,'0x','0x','0x'];
 const send=async(returning=false,n=10n)=>{
  const c=returning?oft.connect(a.bob):adapter.connect(b.alice),ep=returning?a.ep:b.ep;
  const receipt=await (await c.send(params(n,returning?30102:30417,returning?bob:alice),[0,0],returning?bob:alice)).wait();
  return receipt.logs.map(l=>{try{return ep.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='Packet').args;
 };
 const deliver=async(packet,returning=false)=>{await (await (returning?b.ep:a.ep).deliver(returning?ba:aa,[returning?30417:30102,zeroPadValue(returning?aa:ba,32),packet.nonce],packet.guid,packet.message)).wait();};
 const enable=async()=>{await (await adapter.setPauses(false,false)).wait();await (await oft.setPauses(false,false)).wait();};
 const invariant=async(f=0n,r=0n,donation=0n)=>{
  const s=await oft.totalSupply(),n=await adapter.principalLD();
  assert.equal(n,s+(f+r)*U);assert.equal(await token.balanceOf(ba),n+donation*U);
 };
 return {b,a,token,adapter,oft,ba,aa,alice,bob,params,send,deliver,enable,invariant};
}
test('two isolated chains preserve collateral through transit, transfer to a new holder and redemption',async()=>{
 const f=await fixture();assert.equal(await f.oft.totalSupply(),0n);
 assert.equal(await f.oft.sourceToken(),await f.token.getAddress());assert.equal(await f.oft.name(),await f.token.name());
 assert.equal(f.oft.interface.fragments.some(x=>x.type==='function'&&x.name==='mint'),false);
 await f.enable();await f.invariant();const out=await f.send();await f.invariant(10n);
 await f.deliver(out);await f.invariant();
 const credit=await f.oft.availableOutboundSD();
 await (await f.oft.connect(f.a.alice).transfer(f.bob,10n*U)).wait();assert.equal(await f.oft.availableOutboundSD(),credit);
 const ret=await f.send(true);await f.invariant(0n,10n);
 await (await f.adapter.setPauses(true,false)).wait();await f.deliver(ret,true);await f.invariant();
 assert.equal(await f.token.balanceOf(f.bob),10n*U);
 await assert.rejects(f.deliver(out));await assert.rejects(f.deliver(ret,true));await f.invariant();
});
test('a second funded wallet can deposit and redeem without a tester allowlist',async()=>{
 const f=await fixture();await f.enable();
 await (await f.token.transfer(f.bob,10n*U)).wait();
 await (await f.token.connect(f.b.bob).approve(f.ba,10n*U)).wait();
 const receipt=await (await f.adapter.connect(f.b.bob).send(f.params(10n,30417,f.bob),[0,0],f.bob)).wait();
 const packet=receipt.logs.map(log=>{try{return f.b.ep.interface.parseLog(log);}catch{return null;}}).find(event=>event?.name==='Packet')?.args;
 assert.ok(packet);await f.deliver(packet);assert.equal(await f.oft.balanceOf(f.bob),10n*U);
 const back=await f.send(true);await f.deliver(back,true);
 assert.equal(await f.token.balanceOf(f.bob),10n*U);assert.equal(await f.adapter.principalLD(),0n);
});
test('Arc pause and receive limits preserve pending source collateral; original GUID can be retried',async()=>{
 const f=await fixture();await f.enable();const out=await f.send();
 await (await f.oft.setPauses(false,true)).wait();await assert.rejects(f.deliver(out));await f.invariant(10n);
 await (await f.oft.setPauses(false,false)).wait();await (await f.oft.configureLimit(true,5,100,100)).wait();
 await assert.rejects(f.deliver(out));assert.equal(await f.oft.availableInboundSD(),100n);
 await (await f.oft.configureLimit(true,20,100,100)).wait();await f.deliver(out);await f.invariant();
 assert.equal(await f.oft.availableInboundSD(),90n);
});
test('failed return submission restores burn and quota; BSC receive pause retains in-flight liability',async()=>{
 const f=await fixture();await f.enable();await f.deliver(await f.send());
 await (await f.oft.connect(f.a.alice).transfer(f.bob,10n*U)).wait();
 await (await f.a.ep.setFailSend(true)).wait();
 await assert.rejects(async()=>{await (await f.oft.connect(f.a.bob).send(f.params(10n,30102,f.bob),[0,0],f.bob,{gasLimit:1000000})).wait();});
 assert.equal(await f.oft.balanceOf(f.bob),10n*U);assert.equal(await f.oft.availableOutboundSD(),100n);await f.invariant();
 await (await f.a.ep.setFailSend(false)).wait();const ret=await f.send(true);await f.invariant(0n,10n);
 await (await f.adapter.setPauses(false,true)).wait();await assert.rejects(f.deliver(ret,true));await f.invariant(0n,10n);
 await (await f.adapter.setPauses(false,false)).wait();await f.deliver(ret,true);await f.invariant();
});
test('Arc rejects unauthenticated/malformed mint and invalid return without changing supply or credits',async()=>{
 const f=await fixture();await f.enable();await f.deliver(await f.send());
 await (await f.oft.connect(f.a.alice).transfer(f.bob,10n*U)).wait();
 for(const p of [f.params(0n,30102,f.bob),f.params(1n,30102,f.bob).with(2,U+1n),f.params(1n,999,f.bob),f.params(1n,30102,f.bob).with(5,'0x01'),f.params(1n,30102,f.bob).with(6,'0x01')])
  await assert.rejects(f.oft.connect(f.a.bob).send(p,[0,0],f.bob));
 const peer=zeroPadValue(f.ba,32),msg=solidityPacked(['bytes32','uint64'],[zeroPadValue(f.alice,32),10]);
 await assert.rejects(f.oft.lzReceive([30102,peer,1],id('direct'),msg,f.alice,'0x'));
 await assert.rejects(f.a.ep.deliver(f.aa,[30102,zeroPadValue(f.bob,32),1],id('wrong'),msg));
 for(const bad of ['0x00',msg+'00',solidityPacked(['bytes32','uint64'],[zeroPadValue(f.aa,32),10]),solidityPacked(['bytes32','uint64'],['0x'+'ff'.repeat(32),10])])
  await assert.rejects(f.a.ep.deliver(f.aa,[30102,peer,1],id(bad),bad));
 await assert.rejects(f.oft.connect(f.a.bob).setPauses(false,false));
 assert.equal(await f.oft.availableOutboundSD(),100n);assert.equal(await f.oft.availableInboundSD(),90n);await f.invariant();
});
test('source rejects remote bridge as recipient before locking or burning, in both directions',async()=>{
 const f=await fixture();await f.enable();
 const rejected=async(c,p,refund)=>{
  await assert.rejects(c.send.staticCall(p,[0,0],refund),e=>e.data===c.interface.getError('UnsupportedMessage').selector);
  await assert.rejects(async()=>{await (await c.send(p,[0,0],refund,{gasLimit:1000000})).wait();});
 };
 await rejected(f.adapter.connect(f.b.alice),f.params(10n,30417,f.aa),f.alice);
 assert.equal(await f.token.balanceOf(f.alice),100n*U);
 assert.equal(await f.token.allowance(f.alice,f.ba),100n*U);
 assert.equal(await f.adapter.availableOutboundSD(),100n);await f.invariant();
 await f.deliver(await f.send());
 await (await f.oft.connect(f.a.alice).transfer(f.bob,10n*U)).wait();
 await rejected(f.oft.connect(f.a.bob),f.params(10n,30102,f.ba),f.bob);
 assert.equal(await f.oft.balanceOf(f.bob),10n*U);
 assert.equal(await f.oft.availableOutboundSD(),100n);await f.invariant();
 await f.deliver(await f.send(true),true);await f.invariant();
 assert.equal(await f.token.balanceOf(f.bob),10n*U);
});

test('multiple in-flight messages delivered out of order maintain accounting with donations',async()=>{
 const f=await fixture();await f.enable();await (await f.token.transfer(f.ba,7n*U)).wait();
 const first=await f.send(false,5n),second=await f.send(false,10n);await f.invariant(15n,0n,7n);
 await f.deliver(second);await f.invariant(5n,0n,7n);await f.deliver(first);await f.invariant(0n,0n,7n);
 await (await f.oft.connect(f.a.alice).transfer(f.bob,15n*U)).wait();
 const r1=await f.send(true,5n),r2=await f.send(true,10n);await f.invariant(0n,15n,7n);
 await f.deliver(r2,true);await f.invariant(0n,5n,7n);await f.deliver(r1,true);await f.invariant(0n,0n,7n);
});

test('read-only scanner reconstructs deployed pair, pending delivery, recovery and reorg from actual logs',async()=>{
 const f=await fixture();await f.enable();
 const policy={sourceToken:await f.token.getAddress(),chunkSize:5};
 for(const [key,c] of [['bsc',f.adapter],['arc',f.oft]])policy[key]={chainId:31337,app:await c.getAddress(),deploymentBlock:(await c.deploymentTransaction().wait()).blockNumber,confirmations:1,maxBlockAgeSeconds:10000};
 const providers={bsc:f.b.p,arc:f.a.p};
 const scan=async()=>{
  for(const p of Object.values(providers))await p.send('evm_mine',[]);
  const now=Math.max(...await Promise.all(Object.values(providers).map(async p=>(await p.getBlock('latest')).timestamp)));
  const snapshot=await collectSnapshot(providers,policy,now);
  return reconcile(snapshot,{pendingSeconds:1,nowSeconds:now});
 };
 const checkpoint=await f.b.p.send('evm_snapshot',[]);
 const packet=await f.send();const pending=await scan();assert.equal(pending.totals.forward,String(10n*U));
 await f.deliver(packet);assert.equal((await scan()).status,'ok');
 await (await f.oft.connect(f.a.alice).transfer(f.bob,10n*U)).wait();await f.deliver(await f.send(true),true);
 assert.equal((await scan()).totals.principal,'0');
 // Roll back only BSC. Arc history has receipts without sends: report incomplete.
 await f.b.p.send('evm_revert',[checkpoint]);
 assert.equal((await scan()).status,'incomplete');
 const now=Math.max(...await Promise.all(Object.values(providers).map(async p=>(await p.getBlock('latest')).timestamp)));
 const failing=new Proxy(f.b.p,{get(target,key){if(key==='getLogs')return async()=>{throw new Error('SIMULATED_RPC_FAILURE');};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 await assert.rejects(collectSnapshot({...providers,bsc:failing},policy,now),/SIMULATED_RPC_FAILURE/);
 let reads=0;
 const changing=new Proxy(f.b.p,{get(target,key){if(key==='getBlock')return async(...args)=>{const h=await target.getBlock(...args);return ++reads>1?{...h,hash:id('replaced-block')}:h;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 await assert.rejects(collectSnapshot({...providers,bsc:changing},policy,now),/REORG_DURING_SCAN/);
 const bad={...policy,bsc:{...policy.bsc,deploymentBlock:policy.bsc.deploymentBlock+1}};
 await assert.rejects(collectSnapshot(providers,bad,Math.floor(Date.now()/1000)+100),/INVALID_DEPLOYMENT_BOUNDARY/);
});

test('persistent index matches full actual-log rebuild before and after rollback',async()=>{
 const f=await fixture();await f.enable();const dir=await mkdtemp(join(tmpdir(),'tevumi-chain-index-')),path=join(dir,'index.json');
 try{
  const policy={sourceToken:await f.token.getAddress(),chunkSize:2};
  for(const [key,c] of [['bsc',f.adapter],['arc',f.oft]])policy[key]={chainId:31337,app:await c.getAddress(),deploymentBlock:(await c.deploymentTransaction().wait()).blockNumber,confirmations:1,maxBlockAgeSeconds:10000};
  const providers={bsc:f.b.p,arc:f.a.p},checkpoint=await f.b.p.send('evm_snapshot',[]);
  await f.deliver(await f.send());
  const scan=async()=>{
   for(const p of Object.values(providers))await p.send('evm_mine',[]);
   const now=Math.max(...await Promise.all(Object.values(providers).map(async p=>(await p.getBlock('latest')).timestamp)));
   const index=await openLogIndex(path,'test-pair');
   const actual=await collectSnapshot(providers,policy,now,index),full=await collectSnapshot(providers,policy,now);
   assert.deepEqual(actual,full);return index.stats;
  };
  assert.ok((await scan()).fetchedChunks>0);assert.ok((await scan()).reusedChunks>0);
  await f.b.p.send('evm_revert',[checkpoint]);
  // Produce a different branch to the same/higher height, with a different amount.
  await f.send(false,5n);for(let i=0;i<8;i++)await f.b.p.send('evm_mine',[]);
  assert.ok((await scan()).discardedChunks>0);
 }finally{for(const file of [path,path+'.tmp'])try{await unlink(file);}catch(e){if(e.code!=='ENOENT')throw e;}await rmdir(dir);}
});
