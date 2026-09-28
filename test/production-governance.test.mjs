import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {network} from 'hardhat';
import {BrowserProvider,ContractFactory,ZeroHash,id,zeroPadValue,keccak256} from 'ethers';
import {inspectGovernance} from '../scripts/production-preflight.mjs';
import {compile} from '../scripts/compile.mjs';
let build;const connections=[],DAY=86400;
before(()=>{build=compile();});after(async()=>{await Promise.all(connections.map(c=>c.close()));});
async function fixture(){
 const local=await network.create('local');connections.push(local);
 const p=new BrowserProvider(local.provider,undefined,{cacheTimeout:-1});
 const deployer=await p.getSigner(0),proposer=await p.getSigner(1),guardian=await p.getSigner(2),outsider=await p.getSigner(3);
 const prop=await proposer.getAddress(),guard=await guardian.getAddress(),other=await outsider.getAddress();
 const deploy=async(n,args)=>{const art=Object.values(build).find(f=>f[n])?.[n];const c=await new ContractFactory(art.abi,'0x'+art.evm.bytecode.object,deployer).deploy(...args);await c.waitForDeployment();return c;};
 const tl=await deploy('BridgeTimelock',[DAY,prop]),ta=await tl.getAddress();
 const ep=await deploy('MockEndpoint',[30102]),token=await deploy('PilotToken',[await deployer.getAddress()]);
 const adapter=await deploy('GovernedAdapter',[await token.getAddress(),await ep.getAddress(),ta,guard,100n*10n**12n,[20,100,100],[20,100,100]]);
 const oft=await deploy('GovernedOFT',['Test','TEST',await token.getAddress(),await ep.getAddress(),ta,guard,[20,100,100],[20,100,100]]);
 let count=0;
 const schedule=async(c,method,args)=>{
  const target=await c.getAddress(),data=c.interface.encodeFunctionData(method,args),salt=id('op'+count++);
  await (await tl.connect(proposer).schedule(target,0,data,ZeroHash,salt,DAY)).wait();
  const execute=()=>tl.connect(proposer).execute(target,0,data,ZeroHash,salt);
  return {execute,target,data,salt};
 };
 const advance=async()=>{await local.provider.request({method:'evm_increaseTime',params:[DAY]});await local.provider.request({method:'evm_mine',params:[]});};
 return {p,deploy,deployer,proposer,guardian,outsider,prop,guard,other,tl,ta,ep,adapter,oft,schedule,advance};
}
test('owner and endpoint delegate start at self-administered timelock; deployer has no administrative role',async()=>{
 const f=await fixture();
 for(const c of [f.adapter,f.oft]){
  assert.equal(await c.owner(),f.ta);assert.equal(await f.ep.delegates(await c.getAddress()),f.ta);
 }
 assert.equal(await f.tl.hasRole(ZeroHash,await f.deployer.getAddress()),false);
 assert.equal(await f.tl.hasRole(ZeroHash,f.prop),false);assert.equal(await f.tl.hasRole(ZeroHash,f.ta),true);
 await assert.rejects(f.tl.grantRole(await f.tl.PROPOSER_ROLE(),f.other));
 await assert.rejects(f.tl.connect(f.proposer).updateDelay(0));
 await assert.rejects(f.deploy('BridgeTimelock',[DAY-1,f.prop]));
});
test('guardian pause is monotonic; unpause and guardian replacement require delayed execution on both assets',async()=>{
 const f=await fixture();
 for(const c of [f.adapter,f.oft]){
  const op=await f.schedule(c,'setPauses',[false,false]);await assert.rejects(op.execute());await f.advance();await (await op.execute()).wait();
  await (await c.connect(f.guardian).pause(true,false)).wait();
  await (await c.connect(f.guardian).pause(false,false)).wait();
  assert.equal(await (c===f.adapter?c.depositsPaused():c.sendsPaused()),true);
  assert.equal(await c.receivesPaused(),false);
  await (await c.connect(f.guardian).pause(false,true)).wait();assert.equal(await c.receivesPaused(),true);
  await assert.rejects(c.connect(f.guardian).setPauses(false,false));await assert.rejects(c.connect(f.outsider).pause(true,true));
  const replace=await f.schedule(c,'setGuardian',[f.other]);await f.advance();await (await replace.execute()).wait();
  await assert.rejects(c.connect(f.guardian).pause(true,true));await (await c.connect(f.outsider).pause(true,true)).wait();
 }
});
test('all inherited configuration and endpoint library/config entry points reject deployer, proposer and guardian directly',async()=>{
 const f=await fixture();
 for(const signer of [f.deployer,f.proposer,f.guardian])for(const c of [f.adapter,f.oft]){
  const x=c.connect(signer),remote=c===f.adapter?30417:30102;
  for(const fn of [()=>x.setPeer(remote,zeroPadValue(f.other,32)),()=>x.setDelegate(f.other),()=>x.setMsgInspector(f.other),()=>x.setPreCrime(f.other),()=>x.setEnforcedOptions([]),()=>x.transferOwnership(f.other),()=>x.renounceOwnership(),()=>x.configureLimit(true,1,2,3),()=>x.setGuardian(f.other)])await assert.rejects(fn());
  const ep=f.ep.connect(signer),addr=await c.getAddress();
  await assert.rejects(ep.setSendLibrary(addr,remote,f.other));
  await assert.rejects(ep.setReceiveLibrary(addr,remote,f.other,0));
  await assert.rejects(ep.setConfig(addr,f.other,[]));
 }
 const op=await f.schedule(f.ep,'setSendLibrary',[await f.adapter.getAddress(),30417,f.other]);
 await assert.rejects(op.execute());await f.advance();await (await op.execute()).wait();
 assert.equal(await f.ep.getSendLibrary(await f.adapter.getAddress(),30417),f.other);
});
test('scheduled operations can be cancelled; outsiders cannot schedule or execute; delay changes require old delay',async()=>{
 const f=await fixture(),op=await f.schedule(f.adapter,'setCapacity',[50n*10n**12n]);
 await assert.rejects(f.tl.connect(f.outsider).schedule(op.target,0,op.data,ZeroHash,id('bad'),DAY));
 const hash=await f.tl.hashOperation(op.target,0,op.data,ZeroHash,op.salt);
 await (await f.tl.connect(f.proposer).cancel(hash)).wait();await f.advance();await assert.rejects(op.execute());
 const change=await f.schedule(f.tl,'updateDelay',[DAY*2]);await assert.rejects(change.execute());
 await f.advance();await (await change.execute()).wait();assert.equal(await f.tl.getMinDelay(),BigInt(DAY*2));
 await assert.rejects(f.tl.connect(f.outsider).execute(change.target,0,change.data,ZeroHash,change.salt));
});
test('delayed delegate reassignment can weaken future controls and must be treated as governance migration',async()=>{
 const f=await fixture(),addr=await f.adapter.getAddress();
 const op=await f.schedule(f.adapter,'setDelegate',[f.other]);await assert.rejects(op.execute());
 await f.advance();await (await op.execute()).wait();
 assert.equal(await f.ep.delegates(addr),f.other);
 // Explicit trust boundary: owner remaining timelock does not protect an EOA delegate.
 await (await f.ep.connect(f.outsider).setSendLibrary(addr,30417,f.other)).wait();
 assert.equal(await f.adapter.owner(),f.ta);
 assert.equal(await f.ep.getSendLibrary(addr,30417),f.other);
});
test('read-only snapshot detects unexpected roles, delegate, limits and code hash',async()=>{
 const f=await fixture(),app=await f.adapter.getAddress(),endpoint=await f.ep.getAddress();
 const policy={app,endpoint,timelock:f.ta,chainId:31337,kind:'adapter',guardian:f.guard,remoteEid:30417,peer:ZeroHash,delay:DAY,sendPaused:true,receivePaused:true,capacityLD:100n*10n**12n,outbound:[20,100,100],inbound:[20,100,100],roles:{admin:[f.ta],proposer:[f.prop],executor:[f.prop],canceller:[f.prop]},codeHashes:{}};
 for(const name of ['app','timelock','endpoint'])policy.codeHashes[name]=keccak256(await f.p.getCode(policy[name]));
 assert.equal((await inspectGovernance(f.p,policy)).ready,true);
 assert.equal((await inspectGovernance(f.p,{...policy,capacityLD:1})).ready,false);
 assert.equal((await inspectGovernance(f.p,{...policy,codeHashes:{...policy.codeHashes,app:ZeroHash}})).ready,false);
 const role=await f.schedule(f.tl,'grantRole',[await f.tl.PROPOSER_ROLE(),f.other]);await f.advance();await (await role.execute()).wait();
 assert.equal((await inspectGovernance(f.p,policy)).ready,false);
 const delegate=await f.schedule(f.adapter,'setDelegate',[f.other]);await f.advance();await (await delegate.execute()).wait();
 const report=await inspectGovernance(f.p,policy);assert.equal(report.checks.find(c=>c.label==='delegate').ok,false);
});
