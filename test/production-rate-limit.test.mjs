import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {network} from 'hardhat';
import {BrowserProvider, ContractFactory} from 'ethers';
import {compile} from '../scripts/compile.mjs';

let artifact;
const connections=[];
before(()=>{artifact=compile()['contracts/test/RateLimitHarness.sol'].RateLimitHarness;});
after(async()=>{await Promise.all(connections.map(c=>c.close()));});
async function fixture(m=10n,b=20n,q=40n,initialize=true){
  const local=await network.create('local');connections.push(local);
  const p=new BrowserProvider(local.provider,undefined,{cacheTimeout:-1});
  const c=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,await p.getSigner()).deploy();
  await c.waitForDeployment();
  if(initialize)await (await c.initialize(m,b,q)).wait();
  const now=async()=>BigInt((await p.getBlock('latest')).timestamp);
  const at=async(t)=>local.provider.request({method:'evm_setNextBlockTimestamp',params:[Number(t)]});
  const mine=async(t)=>{await at(t);await local.provider.request({method:'evm_mine',params:[]});};
  return {c,now,at,mine};
}
async function rejects(c,fn,name){
  await assert.rejects(fn,e=>{
    const data=e.data??e.info?.error?.data;
    return typeof data==='string' && c.interface.parseError(data)?.name===name;
  });
}

test('initialization, invalid configuration and amount boundaries fail closed',async()=>{
  const {c}=await fixture(10n,20n,40n,false);
  await rejects(c,()=>c.available(),'Uninitialized');
  await rejects(c,()=>c.consume.staticCall(1),'Uninitialized');
  await rejects(c,()=>c.configure.staticCall(1,2,3),'Uninitialized');
  for(const args of [[0,20,40],[21,20,40],[10,20,19]])
    await rejects(c,()=>c.initialize.staticCall(...args),'InvalidConfiguration');
  await (await c.initialize(10,20,20)).wait();
  await rejects(c,()=>c.initialize.staticCall(10,20,20),'AlreadyInitialized');
  const saved=await c.bucket();
  for(const amount of [0n,11n,2n**256n-1n])await rejects(c,()=>c.consume.staticCall(amount),'InvalidAmount');
  await rejects(c,()=>c.configure.staticCall(0,20,20),'InvalidConfiguration');
  assert.deepEqual([...(await c.bucket())],[...saved]);
  await (await c.consumeMany([9,10,1])).wait();
  assert.equal(await c.available(),0n);
  await rejects(c,()=>c.consume.staticCall(1),'InsufficientCredit');
});

test('same-block overspend and downstream failure roll back credit and principal',async()=>{
  const {c}=await fixture(10n,20n,20n);
  const saved=await c.bucket();
  // Explicit gas bypasses estimation so these are actual reverted EVM transactions.
  await assert.rejects(async()=>{await (await c.consumeMany([10,10,1],{gasLimit:500000})).wait();});
  assert.deepEqual([...(await c.bucket())],[...saved]);
  await assert.rejects(async()=>{await (await c.consumeThenFail(10,{gasLimit:500000})).wait();});
  assert.deepEqual([...(await c.bucket())],[...saved]);
  assert.equal(await c.principal(),0n);
});

test('fractional refill survives frequent settlement; view calls never mutate state',async()=>{
  const {c,now,at,mine}=await fixture(2n,2n,3n);
  await (await c.consume(2)).wait();const start=await now();
  for(let i=1n;i<=4n;i++){
    await at(start+i*21600n);
    await (await c.configure(2,2,3)).wait();
    const saved=await c.bucket();
    for(let j=0;j<3;j++)assert.equal(await c.available(),i/4n);
    assert.deepEqual([...(await c.bucket())],[...saved]);
  }
  assert.equal(await c.available(),1n);
  await at(start+86401n);await (await c.consume(1)).wait();
  await mine(start+172800n);assert.equal(await c.available(),1n);
});

test('configuration settles old rate, clamps decreases and never refills increases',async()=>{
  const {c,now,at}=await fixture(10n,20n,40n);
  await (await c.consumeMany([10,10])).wait();const start=await now();
  await at(start+21600n);await (await c.configure(10,100,100)).wait();
  assert.equal(await c.available(),5n);
  await (await c.configure(3,3,3)).wait();assert.equal(await c.available(),3n);
  await rejects(c,()=>c.consume.staticCall(4),'InvalidAmount');
  await (await c.configure(10,100,100)).wait();assert.equal(await c.available(),3n);
});

test('uint64 maximum and long idle time saturate without overflow; zero refill stays exhausted',async()=>{
  const max=2n**64n-1n;
  const {c,now,mine}=await fixture(max,max,max);
  await (await c.consume(max)).wait();
  await mine((await now())+10n**12n);assert.equal(await c.available(),0n);
  await (await c.configure(1,1,max)).wait();
  await mine((await now())+10n**12n);assert.equal(await c.available(),1n);
});

test('seeded multi-day sends match independent rational accounting and rolling-window bound',async()=>{
  const m=25n,b=60n,q=150n,W=86400n;
  const {c,now,at}=await fixture(m,b,q);
  let last=await now(),credit=b*W,seed=1729;
  const events=[];
  for(let i=0;i<100;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const t=last+BigInt(1+seed%6500);
    credit=credit+(t-last)*(q-b);if(credit>b*W)credit=b*W;
    const available=credit/W;
    const amount=available===0n?0n:1n+BigInt(seed)% (available<m?available:m);
    await at(t);
    // configure with identical values settles fractions without consuming when empty.
    await (await (amount?c.consume(amount):c.configure(m,b,q))).wait();
    credit-=amount*W;last=t;
    assert.equal(await c.available(),credit/W);
    assert.equal((await c.bucket()).credit,credit);
    events.push({t,amount});
    const rolling=events.filter(e=>t-e.t<=W).reduce((sum,e)=>sum+e.amount,0n);
    assert.ok(rolling<=q,`window consumed ${rolling} > ${q}`);
  }
});
