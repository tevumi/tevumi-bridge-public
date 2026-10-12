import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {network} from 'hardhat';
import {BrowserProvider,ContractFactory,keccak256,id,ZeroAddress} from 'ethers';
const connections=[],U=10n**12n;let build;
before(()=>{build=JSON.parse(readFileSync('artifacts/build.json','utf8')).output.contracts});
after(async()=>{await Promise.all(connections.map(c=>c.close()))});
const types={FundingQuote:[{name:'user',type:'address'},{name:'amount',type:'uint256'},{name:'minimumOutput',type:'uint256'},{name:'nonce',type:'bytes32'},{name:'deadline',type:'uint256'},{name:'dataHash',type:'bytes32'}]};
async function fixture(){
 const local=await network.create('local');connections.push(local);const p=new BrowserProvider(local.provider,undefined,{cacheTimeout:-1}),admin=await p.getSigner(0),user=await p.getSigner(1),account=await user.getAddress();
 const deploy=async(name,args)=>{const a=Object.values(build).find(f=>f[name])?.[name];const c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,admin).deploy(...args);await c.waitForDeployment();return c;};
 const token=await deploy('CandidateToken',['Local','LOCAL',account,await admin.getAddress()]),market=await deploy('SwapSellHarness',[await token.getAddress()]),router=await deploy('SwapFundingHarness',[]);
 await(await admin.sendTransaction({to:await market.getAddress(),value:10000n})).wait();
 const executor=(await deploy('SwapSellAndFund',[await token.getAddress(),await market.getAddress(),await market.getAddress(),await admin.getAddress(),await router.getAddress(),await admin.getAddress()])).connect(user),address=await executor.getAddress();
 const data=router.interface.encodeFunctionData('fund',[[id('tx'),'relaydepository','',ZeroAddress,ZeroAddress,account,80n,5042,false,false]]),deadline=BigInt((await p.getBlock('latest')).timestamp)+1000n;
 const quote={user:account,amount:80n,minimumOutput:1n,nonce:id('order'),deadline,dataHash:keccak256(data)};
 const signature=await admin.signTypedData({name:'TevumiExperimentalFunding',version:'1',chainId:31337,verifyingContract:address},types,quote);
 const send=(dex=false,q=quote,d=data,s=signature)=>executor.sellAndFund(dex,7n*U,90n,q,d,s);
 return{p,admin,user,account,token,market,router,executor,address,quote,data,signature,send};
}
test('sale and funding are one atomic call with surplus BNB returned and approvals cleared',async()=>{
 const f=await fixture();await(await f.token.connect(f.user).approve(f.address,7n*U)).wait();await(await f.send()).wait();
 assert.equal(await f.router.funded(),80n);assert.equal(await f.token.balanceOf(f.address),0n);assert.equal(await f.p.getBalance(f.address),0n);assert.equal(await f.token.allowance(f.address,await f.market.getAddress()),0n);assert.equal(await f.executor.used(f.account,f.quote.nonce),true);await assert.rejects(f.send());
});
test('DEX branch also sells and funds atomically',async()=>{const f=await fixture();await(await f.token.connect(f.user).approve(f.address,7n*U)).wait();await(await f.send(true)).wait();assert.equal(await f.router.funded(),80n);});
test('failed funding restores user tokens and order nonce',async()=>{
 const f=await fixture();await(await f.token.connect(f.user).approve(f.address,7n*U)).wait();await(await f.router.setFail(true)).wait();const before=await f.token.balanceOf(f.account);await assert.rejects(f.send());assert.equal(await f.token.balanceOf(f.account),before);assert.equal(await f.executor.used(f.account,f.quote.nonce),false);
});
test('missing user approval and changed signed amount are rejected',async()=>{const f=await fixture();await assert.rejects(f.send());await(await f.token.connect(f.user).approve(f.address,7n*U)).wait();await assert.rejects(f.send(false,{...f.quote,amount:81n}));assert.equal(await f.router.funded(),0n);});
test('preexisting native and token balances never subsidize the order',async()=>{
 const f=await fixture();await(await f.token.connect(f.user).transfer(f.address,U)).wait();await f.p.send('hardhat_setBalance',[f.address,'0x64']);await(await f.token.connect(f.user).approve(f.address,7n*U)).wait();await(await f.send()).wait();assert.equal(await f.p.getBalance(f.address),100n);assert.equal(await f.token.balanceOf(f.address),U);
});

test('another user cannot consume the signed order or spend its approval',async()=>{
 const f=await fixture();const outsider=f.executor.connect(f.admin);
 await assert.rejects(outsider.sellAndFund(false,7n*U,90n,f.quote,f.data,f.signature));assert.equal(await f.executor.used(f.account,f.quote.nonce),false);
});
