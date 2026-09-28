import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {network} from 'hardhat';
import {BrowserProvider,ContractFactory,zeroPadValue,solidityPacked,id} from 'ethers';
import {compile} from '../scripts/compile.mjs';
const U=10n**12n,connections=[];let build;
before(()=>{build=compile();});
after(async()=>{await Promise.all(connections.map(c=>c.close()));});
async function fixture(tax=false){
 const local=await network.create('local');connections.push(local);
 const p=new BrowserProvider(local.provider,undefined,{cacheTimeout:-1});
 const owner=await p.getSigner(0),user=await p.getSigner(1),recipient=await p.getSigner(2);
 const a=await owner.getAddress(),u=await user.getAddress(),r=await recipient.getAddress();
 const deploy=async(name,args)=>{const art=Object.values(build).find(f=>f[name])?.[name];const c=await new ContractFactory(art.abi,'0x'+art.evm.bytecode.object,owner).deploy(...args);await c.waitForDeployment();return c;};
 const token=await deploy(tax?'TaxToken':'PilotToken',[a]),ep=await deploy('MockEndpoint',[30102]);
 const adapter=await deploy('ProductionAdapterHarness',[await token.getAddress(),await ep.getAddress(),a,20n*U,[10,30,30],[10,30,30]]);
 const addr=await adapter.getAddress(),peer=zeroPadValue(await (await p.getSigner(3)).getAddress(),32);
 await (await adapter.setPeer(30417,peer)).wait();
 await (await token.transfer(u,100n*U)).wait();await (await token.connect(user).approve(addr,100n*U)).wait();
 const params=(n=10n)=>[30417,zeroPadValue(r,32),n*U,n*U,'0x','0x','0x'];
 const send=async(n=10n)=>{await (await adapter.connect(user).send(params(n),[0,0],u)).wait();};
 const deliver=async(n=10n,key='one',dest=r)=>ep.deliver(addr,[30417,peer,1],id(key),solidityPacked(['bytes32','uint64'],[zeroPadValue(dest,32),n]));
 const enable=async()=>{await (await adapter.setPauses(false,false)).wait();};
 return {local,p,owner,user,token,ep,adapter,addr,u,r,peer,params,send,deliver,enable};
}
test('multi-user lock/redeem tracks principal; donations never raise capacity or redeemable principal',async()=>{
 const f=await fixture();await f.enable();await f.send();
 await (await f.token.transfer(f.addr,50n*U)).wait();
 assert.equal(await f.adapter.principalLD(),10n*U);
 await f.send();await assert.rejects(f.send(1n));
 await (await f.deliver(10n,'first')).wait();
 assert.equal(await f.token.balanceOf(f.r),10n*U);assert.equal(await f.adapter.principalLD(),10n*U);
 await (await f.deliver(10n,'second')).wait();
 assert.equal(await f.adapter.principalLD(),0n);assert.equal(await f.token.balanceOf(f.addr),50n*U);
 await assert.rejects(f.deliver(1n,'donation'));await assert.rejects(f.deliver(10n,'first'));
 await f.send();assert.equal(await f.adapter.principalLD(),10n*U);
});
test('initial pause, dust, route/payload/recipient and outsider configuration are rejected',async()=>{
 const f=await fixture();await assert.rejects(f.send());await f.enable();
 await assert.rejects(f.adapter.connect(f.user).setCapacity(U));
 for(const param of [f.params().with(2,U+1n),f.params().with(2,0),f.params().with(0,999),f.params().with(5,'0x01'),f.params().with(6,'0x01'),f.params().with(1,'0x'+'ff'.repeat(32))])
   await assert.rejects(f.adapter.connect(f.user).send(param,[0,0],f.u));
 await assert.rejects(f.adapter.setPeer(999,f.peer));
 assert.equal(await f.adapter.principalLD(),0n);assert.equal(await f.adapter.availableOutboundSD(),30n);
});
test('failed endpoint send rolls back lock, allowance, principal and outbound credit',async()=>{
 const f=await fixture();await f.enable();await (await f.ep.setFailSend(true)).wait();
 const balance=await f.token.balanceOf(f.u),allowance=await f.token.allowance(f.u,f.addr);
 await assert.rejects(async()=>{await (await f.adapter.connect(f.user).send(f.params(),[0,0],f.u,{gasLimit:1000000})).wait();});
 assert.equal(await f.token.balanceOf(f.u),balance);assert.equal(await f.token.allowance(f.u,f.addr),allowance);
 assert.equal(await f.adapter.principalLD(),0n);assert.equal(await f.adapter.availableOutboundSD(),30n);
});
test('receive authenticates endpoint/peer and rejects malformed, composed and self-recipient messages',async()=>{
 const f=await fixture();await f.enable();await f.send();
 const good=solidityPacked(['bytes32','uint64'],[zeroPadValue(f.r,32),10]);
 await assert.rejects(f.adapter.lzReceive([30417,f.peer,1],id('direct'),good,f.u,'0x'));
 await assert.rejects(f.ep.deliver(f.addr,[30417,zeroPadValue(f.u,32),1],id('peer'),good));
 await assert.rejects(f.ep.deliver(f.addr,[999,f.peer,1],id('route'),good));
 for(const message of ['0x01',good+'00',solidityPacked(['bytes32','uint64'],[zeroPadValue(f.addr,32),10]),solidityPacked(['bytes32','uint64'],['0x'+'00'.repeat(32),10]),solidityPacked(['bytes32','uint64'],['0x'+'ff'.repeat(32),10])])
   await assert.rejects(f.ep.deliver(f.addr,[30417,f.peer,1],id(message),message));
 assert.equal(await f.adapter.principalLD(),10n*U);assert.equal(await f.adapter.availableInboundSD(),30n);
});
test('lower capacity and deposit pause preserve redemption; receive limit failure retries original GUID',async()=>{
 const f=await fixture();await f.enable();await f.send();
 await (await f.adapter.setCapacity(U)).wait();await assert.rejects(f.send(1n));
 await (await f.adapter.setPauses(true,false)).wait();
 await (await f.adapter.configureLimit(true,5,30,30)).wait();
 await assert.rejects(f.deliver(10n,'retry'));assert.equal(await f.ep.delivered(id('retry')),false);
 assert.equal(await f.adapter.principalLD(),10n*U);assert.equal(await f.adapter.availableInboundSD(),30n);
 await (await f.adapter.configureLimit(true,10,30,30)).wait();
 await (await f.adapter.setPauses(true,true)).wait();await assert.rejects(f.deliver(10n,'retry'));
 await (await f.adapter.setPauses(true,false)).wait();await (await f.deliver(10n,'retry')).wait();
 assert.equal(await f.adapter.principalLD(),0n);assert.equal(await f.adapter.availableInboundSD(),20n);
 await assert.rejects(f.deliver(10n,'retry'));
});
test('taxed deposits and releases revert all accounting and allow retry after token recovery',async()=>{
 const f=await fixture(true);await f.enable();await (await f.token.setTax(true)).wait();
 await assert.rejects(f.send());assert.equal(await f.adapter.principalLD(),0n);
 await (await f.token.setTax(false)).wait();await f.send();await (await f.token.setTax(true)).wait();
 await assert.rejects(async()=>{await (await f.ep.deliver(f.addr,[30417,f.peer,1],id('tax'),solidityPacked(['bytes32','uint64'],[zeroPadValue(f.r,32),10]),{gasLimit:1000000})).wait();});
 assert.equal(await f.adapter.principalLD(),10n*U);assert.equal(await f.token.balanceOf(f.addr),10n*U);
 assert.equal(await f.token.balanceOf(f.r),0n);assert.equal(await f.adapter.availableInboundSD(),30n);
 assert.equal(await f.ep.delivered(id('tax')),false);
 await (await f.token.setTax(false)).wait();await (await f.deliver(10n,'tax')).wait();assert.equal(await f.adapter.principalLD(),0n);
});
