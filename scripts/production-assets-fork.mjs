// Remote provider is read-only. All signers, impersonation and transactions use local EVMs.
import {network} from 'hardhat';
import {BrowserProvider,JsonRpcProvider,JsonRpcSigner,FetchRequest,Contract,ContractFactory,parseEther,zeroPadValue,keccak256,ZeroAddress,ZeroHash,id} from 'ethers';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {compile} from './compile.mjs';

const report={checkedAt:new Date().toISOString(),mode:'BSC-mainnet-fork-and-separate-local-Arc-EVM',assets:[],passed:false,
 limitations:['All writes use local simulated accounts; no mainnet transactions.','MockEndpoint delivery is not real DVN/Executor delivery.','Arc EVM is local, not an Arc mainnet fork.','Test amounts and EOA proposer are not approved production policy.','Compatibility applies only to the recorded BSC runtime and state.']};
const connections=[];let remote,row;
try{
 assert.ok(process.env.BSC_RPC_URL);
 const req=new FetchRequest(process.env.BSC_RPC_URL);req.timeout=20000;
 remote=new JsonRpcProvider(req,undefined,{batchMaxCount:1});
 assert.equal((await remote.getNetwork()).chainId,56n);
 const block=Number(process.env.PRODUCTION_ASSETS_FORK_BLOCK??((await remote.getBlockNumber())-20));
 assert.ok(Number.isSafeInteger(block)&&block>0);
 const header=await remote.getBlock(block);assert.ok(header);
 report.forkBlock=block;report.forkBlockHash=header.hash;
 console.log('Compile production candidates; read BSC fork at block '+block);
 const build=compile();
 const makeSide=async(chainId,eid,forking)=>{
  const local=await network.create({network:'local',override:{chainId,hardfork:'cancun',...(forking?{forking}: {})}});connections.push(local);
  await local.provider.request({method:'evm_mine',params:[]});
  const p=new BrowserProvider(local.provider,undefined,{cacheTimeout:-1});
  const admin=await p.getSigner(0),alice=await p.getSigner(1),bob=await p.getSigner(2),guardian=await p.getSigner(3);
  const deploy=async(name,args)=>{const art=Object.values(build).find(f=>f[name])?.[name];assert.ok(art);const c=await new ContractFactory(art.abi,'0x'+art.evm.bytecode.object,admin).deploy(...args);await c.waitForDeployment();return c;};
  const ep=await deploy('MockEndpoint',[eid]),tl=await deploy('BridgeTimelock',[86400,await admin.getAddress()]);
  let sequence=0;
  const govern=async(calls)=>{
   const targets=await Promise.all(calls.map(async x=>x[0].getAddress())),values=calls.map(()=>0),data=calls.map(([c,fn,args])=>c.interface.encodeFunctionData(fn,args)),salt=id('asset-check-'+(++sequence));
   await (await tl.scheduleBatch(targets,values,data,ZeroHash,salt,86400)).wait();
   await local.provider.request({method:'evm_increaseTime',params:[86400]});await local.provider.request({method:'evm_mine',params:[]});
   await (await tl.executeBatch(targets,values,data,ZeroHash,salt)).wait();
  };
  return {local,p,admin,alice,bob,guardian,deploy,ep,tl,govern};
 };
 const b=await makeSide(56,30102,{url:process.env.BSC_RPC_URL,blockNumber:block}),a=await makeSide(5042,30417);
 const alice=await b.alice.getAddress(),bob=await b.bob.getAddress(),donor='0xf977814e90da44bfa03b6295a0616a897441acec';
 await b.local.provider.request({method:'hardhat_impersonateAccount',params:[donor]});
 await b.local.provider.request({method:'hardhat_setBalance',params:[donor,'0x56bc75e2d63100000']});
 const donorSigner=new JsonRpcSigner(b.p,donor),assets=JSON.parse(await readFile('config/meme-candidates.json','utf8')).assets;
 for(const selected of assets){
  row={id:selected.id,sourceToken:selected.sourceToken,stage:'runtime and metadata',checks:[],passed:false};report.assets.push(row);
  console.log(selected.id+': inspect source token and deploy local governed pair');
  const cached=JSON.parse(await readFile('research/'+selected.sourceToken.toLowerCase()+'.sourcify.json','utf8'));
  const code=await b.p.getCode(selected.sourceToken);assert.equal(code.toLowerCase(),cached.runtimeBytecode.onchainBytecode.toLowerCase());
  row.runtimeHash=keccak256(code);row.runtimeMatchesArchivedSource=true;
  const token=new Contract(selected.sourceToken,cached.abi,b.admin);
  row.name=await token.name();row.symbol=await token.symbol();row.decimals=Number(await token.decimals());row.totalSupply=String(await token.totalSupply());
  assert.equal(row.name,selected.sourceName);assert.equal(row.symbol,selected.sourceSymbol);assert.equal(row.decimals,18);
  if(selected.id==='binancelife'){assert.equal(await token.owner(),ZeroAddress);assert.equal(await token._mode(),0n);row.ownerRenouncedAndModeZero=true;}
  const funding=parseEther('10000'),before=await token.balanceOf(alice),donorBefore=await token.balanceOf(donor);
  await (await token.connect(donorSigner).transfer(alice,funding)).wait();
  assert.equal(await token.balanceOf(alice)-before,funding);assert.equal(donorBefore-await token.balanceOf(donor),funding);
  const limits=[1000n*10n**6n,10000n*10n**6n,20000n*10n**6n];
  const adapter=await b.deploy('GovernedAdapter',[selected.sourceToken,await b.ep.getAddress(),await b.tl.getAddress(),await b.guardian.getAddress(),parseEther('10000'),limits,limits]);
  const oft=await a.deploy('GovernedOFT',[row.name,row.symbol,selected.sourceToken,await a.ep.getAddress(),await a.tl.getAddress(),await a.guardian.getAddress(),limits,limits]);
  const ba=await adapter.getAddress(),aa=await oft.getAddress();
  assert.equal(await adapter.owner(),await b.tl.getAddress());assert.equal(await oft.owner(),await a.tl.getAddress());
  assert.equal((await oft.sourceToken()).toLowerCase(),selected.sourceToken.toLowerCase());
  assert.equal(await oft.name(),row.name);assert.equal(await oft.symbol(),row.symbol);
  await b.govern([[adapter,'setPeer',[30417,zeroPadValue(aa,32)]],[adapter,'setPauses',[false,false]]]);
  await a.govern([[oft,'setPeer',[30102,zeroPadValue(ba,32)]],[oft,'setPauses',[false,false]]]);
  row.checks.push('real runtime and exact metadata','holder funding exact','governed pair configured through timelocks');
  const params=(n,eid,to)=>[eid,zeroPadValue(to,32),n,n,'0x','0x','0x'];
  const send=async(returning,n)=>{
   const c=returning?oft.connect(a.bob):adapter.connect(b.alice),ep=returning?a.ep:b.ep,to=returning?bob:alice;
   const receipt=await (await c.send(params(n,returning?30102:30417,to),[0,0],to)).wait();
   const packet=receipt.logs.filter(l=>l.address.toLowerCase()===ep.target.toLowerCase()).map(l=>{try{return ep.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='Packet');assert.ok(packet);return packet.args;
  };
  const deliver=async(packet,returning=false)=>{await (await (returning?b.ep:a.ep).deliver(returning?ba:aa,[returning?30417:30102,zeroPadValue(returning?aa:ba,32),packet.nonce],packet.guid,packet.message,{gasLimit:2000000})).wait();};
  const invariant=async(forward=0n,back=0n,donation=0n)=>{
   assert.equal(await adapter.principalLD(),await oft.totalSupply()+forward+back);
   assert.equal(await token.balanceOf(ba),await adapter.principalLD()+donation);
  };
  row.stage='amounts and redemption';row.amounts=[];
  for(const amount of ['0.000001','1','1000']){
   const n=parseEther(amount),start=await token.balanceOf(alice),bobStart=await token.balanceOf(bob);
   await (await token.connect(b.alice).approve(ba,n)).wait();
   const packet=await send(false,n);await invariant(n);
   assert.equal(start-await token.balanceOf(alice),n);assert.equal(await token.allowance(alice,ba),0n);
   await deliver(packet);await invariant();await assert.rejects(deliver(packet));
   await (await oft.connect(a.alice).transfer(bob,n)).wait();
   const back=await send(true,n);await invariant(0n,n);
   await (await adapter.connect(b.guardian).pause(true,true)).wait();
   await assert.rejects(deliver(back,true));await invariant(0n,n);assert.equal(await b.ep.delivered(back.guid),false);
   await b.govern([[adapter,'setPauses',[true,false]]]);
   await deliver(back,true);await invariant();await assert.rejects(deliver(back,true));
   assert.equal(await token.balanceOf(bob)-bobStart,n);
   await (await token.connect(b.bob).transfer(alice,n)).wait();assert.equal(await token.balanceOf(alice),start);
   await b.govern([[adapter,'setPauses',[false,false]]]);
   row.amounts.push({amount,exactRoundTripViaNewHolder:true,pauseRetrySameGuid:true,replayRejected:true});
  }
  console.log(selected.id+': amounts passed; test rollback and donated balance');
  row.stage='rollback and donations';
  const n=parseEther('1');await (await token.connect(b.alice).approve(ba,n)).wait();
  await (await b.ep.setFailSend(true)).wait();
  const snap={balance:await token.balanceOf(alice),allowance:await token.allowance(alice,ba),bucket:Array.from(await adapter.outbound()),nonce:await b.ep.nonce()};
  await assert.rejects(async()=>{await (await adapter.connect(b.alice).send(params(n,30417,alice),[0,0],alice,{gasLimit:2000000})).wait();});
  assert.equal(await token.balanceOf(alice),snap.balance);assert.equal(await token.allowance(alice,ba),snap.allowance);assert.deepEqual(Array.from(await adapter.outbound()),snap.bucket);assert.equal(await b.ep.nonce(),snap.nonce);await invariant();
  await (await b.ep.setFailSend(false)).wait();
  await assert.rejects(adapter.connect(b.alice).send.staticCall(params(1n,30417,alice),[0,0],alice),e=>e.data===adapter.interface.getError('InvalidPolicy').selector);
  await assert.rejects(adapter.connect(b.alice).send.staticCall(params(n,30417,aa),[0,0],alice),e=>e.data===adapter.interface.getError('UnsupportedMessage').selector);
  const donation=parseEther('7');await (await token.connect(b.alice).transfer(ba,donation)).wait();await invariant(0n,0n,donation);
  const packet=await send(false,n);await invariant(n,0n,donation);await deliver(packet);await invariant(0n,0n,donation);
  await (await oft.connect(a.alice).transfer(bob,n)).wait();const back=await send(true,n);await invariant(0n,n,donation);await deliver(back,true);await invariant(0n,0n,donation);
  assert.equal(await adapter.principalLD(),0n);assert.equal(await oft.totalSupply(),0n);assert.equal(await token.balanceOf(ba),donation);
  assert.equal(String(await token.totalSupply()),row.totalSupply);assert.equal(await token.allowance(alice,ba),0n);
  row.checks.push('failed actual send restores balance allowance principal and stored bucket','dust and remote-self recipient rejected','donation excluded from principal through roundtrip','underlying supply unchanged');
  row.final={principalLD:'0',oftSupplyLD:'0',donationLD:String(donation)};row.stage='complete';row.passed=true;
  console.log(selected.id+': passed');
 }
 await b.local.provider.request({method:'hardhat_stopImpersonatingAccount',params:[donor]});
 assert.equal((await remote.getBlock(block)).hash,report.forkBlockHash);
 report.passed=report.assets.length===2&&report.assets.every(x=>x.passed);
}catch(e){
 if(row)row.passed=false;
 report.failure={code:typeof e.code==='string'&&/^[A-Z_]+$/.test(e.code)?e.code:'CHECK_FAILED',stage:row?.stage??'setup',message:'Fork or assertion failed; provider details omitted.'};
 report.passed=false;
}finally{
 for(const local of connections)await local.close();remote?.destroy();
 await mkdir('research/production',{recursive:true});await writeFile('research/production/assets-fork.json',JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
