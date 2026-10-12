import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {network} from 'hardhat';
import {BrowserProvider,ContractFactory,zeroPadValue} from 'ethers';
const U=10n**12n,connections=[];let build;
before(()=>{build=JSON.parse(readFileSync('artifacts/build.json','utf8')).output.contracts;});
after(async()=>{await Promise.all(connections.map(c=>c.close()));});
async function fixture(){
 const local=await network.create('local');connections.push(local);
 const p=new BrowserProvider(local.provider,undefined,{cacheTimeout:-1}),admin=await p.getSigner(0),user=await p.getSigner(1),account=await user.getAddress();
 const deploy=async(name,args)=>{const a=Object.values(build).find(f=>f[name])?.[name];const c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,admin).deploy(...args);await c.waitForDeployment();return c;};
 const token=await deploy('CandidateToken',['Local','LOCAL',await admin.getAddress(),account]);
 const market=await deploy('SwapMarketHarness',[await token.getAddress()]);await(await token.transfer(await market.getAddress(),10n**18n)).wait();
 const ep=await deploy('MockEndpoint',[30102]);
 const bridge=await deploy('ProductionAdapterHarness',[await token.getAddress(),await ep.getAddress(),await admin.getAddress(),100n*U,[100,100,100],[100,100,100]]);
 await(await bridge.setPeer(30417,zeroPadValue(await admin.getAddress(),32))).wait();await(await bridge.setPauses(false,false)).wait();
 const executor=(await deploy('SwapBuyAndBridge',[await token.getAddress(),await bridge.getAddress(),await market.getAddress(),await market.getAddress(),await admin.getAddress()])).connect(user);
 const deadline=BigInt((await p.getBlock('latest')).timestamp)+1000n;
 await(await market.configure(7n*U+17n,20n)).wait();
 const send=(dex=false,minimum=7n*U,d=deadline)=>executor.buyAndBridge(dex,100n,minimum,30n,d,'0x',{value:130n});
 return{p,user,account,token,market,ep,bridge,executor,send,deadline};
}
test('one call buys and sends only its own output; dust and unused BNB return to caller',async()=>{
 const f=await fixture(),before=await f.token.balanceOf(f.account);
 const tx=await f.send(),r=await tx.wait();
 assert.equal(await f.bridge.principalLD(),7n*U);assert.equal(await f.token.balanceOf(f.account)-before,17n);
 assert.equal(await f.token.balanceOf(await f.executor.getAddress()),0n);assert.equal(await f.p.getBalance(await f.executor.getAddress()),0n);
 assert.equal(await f.token.allowance(await f.executor.getAddress(),await f.bridge.getAddress()),0n);
 const packet=r.logs.map(l=>{try{return f.ep.interface.parseLog(l)}catch{}}).find(e=>e?.name==='Packet');
 assert.equal(packet.args.message.slice(2,66),zeroPadValue(f.account,32).slice(2));
});
test('fixed DEX branch also buys and sends within one transaction',async()=>{const f=await fixture();await(await f.send(true)).wait();assert.equal(await f.bridge.principalLD(),7n*U);});
test('bridge rejection rolls back the purchase and all token movements',async()=>{
 const f=await fixture();await(await f.ep.setFailSend(true)).wait();const before=await f.token.balanceOf(await f.market.getAddress());
 await assert.rejects(f.send());assert.equal(await f.market.purchases(),0n);assert.equal(await f.token.balanceOf(await f.market.getAddress()),before);assert.equal(await f.bridge.principalLD(),0n);
});
test('rounded minimum protects actual Arc amount; expired and invalid units fail before buying',async()=>{
 const f=await fixture();await assert.rejects(f.send(false,8n*U));await assert.rejects(f.send(false,7n*U+1n));await assert.rejects(f.send(false,7n*U,1n));assert.equal(await f.market.purchases(),0n);
});
test('donated tokens and forced native funds cannot subsidize the next user',async()=>{
 const f=await fixture(),address=await f.executor.getAddress();await(await f.token.transfer(address,2n*U)).wait();
 await f.p.send('hardhat_setBalance',[address,'0x64']);await(await f.send()).wait();
 assert.equal(await f.token.balanceOf(address),2n*U);assert.equal(await f.p.getBalance(address),100n);assert.equal(await f.bridge.principalLD(),7n*U);
});
