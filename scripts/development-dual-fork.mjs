// Remote provider is read-only. All signers, impersonation and transactions use local EVMs.
import {network} from 'hardhat';
import {BrowserProvider,JsonRpcProvider,JsonRpcSigner,FetchRequest,Contract,ContractFactory,parseEther,zeroPadValue,keccak256,ZeroAddress,ZeroHash,id} from 'ethers';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {compile} from './compile.mjs';
import {configurationSteps,endpointAbi,ulnType} from '../web/src/bridge.js';
import {AbiCoder} from 'ethers';
const networks=JSON.parse(await readFile('config/networks.json','utf8'));

const report={checkedAt:new Date().toISOString(),mode:'dual-mainnet-forks-direct-test-owner',assets:[],passed:false,
 limitations:['All writes use local simulated accounts; no mainnet transactions.','MockEndpoint delivery is not real DVN/Executor delivery.','Real Endpoint configuration and quotes are checked separately from MockEndpoint transport.','Test amounts and direct owner harnesses are development fixtures only.','Compatibility applies only to the recorded BSC runtime and state.']};
const connections=[];let remote,arcRemote,row;
try{
 assert.ok(process.env.BSC_RPC_URL);
 const req=new FetchRequest(process.env.BSC_RPC_URL);req.timeout=20000;
 remote=new JsonRpcProvider(req,undefined,{batchMaxCount:1});
 assert.equal((await remote.getNetwork()).chainId,56n);
 const block=Number(process.env.DEV_BSC_FORK_BLOCK??((await remote.getBlockNumber())-20));
 assert.ok(Number.isSafeInteger(block)&&block>0);
 const header=await remote.getBlock(block);assert.ok(header);
 report.forkBlock=block;report.forkBlockHash=header.hash;
 const arcUrl=process.env.ARC_RPC_URL;assert.ok(arcUrl);
 const ar=new FetchRequest(arcUrl);ar.timeout=20000;arcRemote=new JsonRpcProvider(ar,undefined,{batchMaxCount:1});assert.equal((await arcRemote.getNetwork()).chainId,5042n);
 const arcBlock=Number(process.env.DEV_ARC_FORK_BLOCK??((await arcRemote.getBlockNumber())-20));assert.ok(Number.isSafeInteger(arcBlock)&&arcBlock>0);
 report.arcForkBlock=arcBlock;report.arcForkBlockHash=(await arcRemote.getBlock(arcBlock)).hash;
 console.log('Compile production candidates; read BSC fork at block '+block);
 const build=compile();
 const makeSide=async(chainId,eid,forking)=>{
  const local=await network.create({network:'local',override:{chainId,hardfork:'cancun',...(forking?{forking}: {})}});connections.push(local);
  await local.provider.request({method:'evm_mine',params:[]});
  const p=new BrowserProvider(local.provider,undefined,{cacheTimeout:-1});
  const admin=await p.getSigner(0),alice=await p.getSigner(1),bob=await p.getSigner(2),guardian=await p.getSigner(3);
  const deploy=async(name,args)=>{const art=Object.values(build).find(f=>f[name])?.[name];assert.ok(art);const c=await new ContractFactory(art.abi,'0x'+art.evm.bytecode.object,admin).deploy(...args);await c.waitForDeployment();return c;};
  const ep=await deploy('MockEndpoint',[eid]);
  const configure=async calls=>{for(const [c,fn,args] of calls)await(await c[fn](...args)).wait();};
  return {local,p,admin,alice,bob,guardian,deploy,ep,configure};
 };
 const b=await makeSide(56,30102,{url:process.env.BSC_RPC_URL,blockNumber:block}),a=await makeSide(5042,30417,{url:arcUrl,blockNumber:arcBlock});
 const alice=await b.alice.getAddress(),bob=await b.bob.getAddress(),donor='0xf977814e90da44bfa03b6295a0616a897441acec';
 await b.local.provider.request({method:'hardhat_impersonateAccount',params:[donor]});
 await b.local.provider.request({method:'hardhat_setBalance',params:[donor,'0x56bc75e2d63100000']});
 const donorSigner=new JsonRpcSigner(b.p,donor),assets=JSON.parse(await readFile('config/meme-candidates.json','utf8')).assets;
 for(const selected of assets){
  row={id:selected.id,sourceToken:selected.sourceToken,stage:'runtime and metadata',checks:[],passed:false};report.assets.push(row);
  console.log(selected.id+': inspect source token and deploy local direct-owner pair');
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
  const adapter=await b.deploy('ProductionAdapterHarness',[selected.sourceToken,await b.ep.getAddress(),await b.admin.getAddress(),parseEther('10000'),limits,limits]);
  const oft=await a.deploy('ProductionOFTHarness',[row.name,row.symbol,selected.sourceToken,await a.ep.getAddress(),await a.admin.getAddress(),limits,limits]);
  const ba=await adapter.getAddress(),aa=await oft.getAddress();
  assert.equal(await adapter.owner(),await b.admin.getAddress());assert.equal(await oft.owner(),await a.admin.getAddress());
  assert.equal((await oft.sourceToken()).toLowerCase(),selected.sourceToken.toLowerCase());
  assert.equal(await oft.name(),row.name);assert.equal(await oft.symbol(),row.symbol);
  await b.configure([[adapter,'setPeer',[30417,zeroPadValue(aa,32)]],[adapter,'setPauses',[false,false]]]);
  await a.configure([[oft,'setPeer',[30102,zeroPadValue(ba,32)]],[oft,'setPauses',[false,false]]]);
  row.checks.push('real runtime and exact metadata','holder funding exact','direct-owner pair configured on two mainnet forks');
  row.stage='real endpoint configuration and quotes';row.endpointChecks=[];
  const realAdapter=await b.deploy('ProductionAdapterHarness',[selected.sourceToken,networks.bsc.endpoint,await b.admin.getAddress(),parseEther('10000'),limits,limits]);
  const realOft=await a.deploy('ProductionOFTHarness',[row.name,row.symbol,selected.sourceToken,networks.arc.endpoint,await a.admin.getAddress(),limits,limits]);
  for(const [side,chain,app,peer,remoteEid] of [[b,networks.bsc,realAdapter,realOft,30417],[a,networks.arc,realOft,realAdapter,30102]]){
   const address=await app.getAddress(),peerAddress=await peer.getAddress(),ep=new Contract(chain.endpoint,endpointAbi,side.admin);
   assert.notEqual(await side.p.getCode(chain.endpoint),'0x');
   assert.equal(await ep.eid(),BigInt(chain.eid));
   for(const step of configurationSteps(chain.chainId,{...chain,remote:remoteEid},address,peerAddress)){
    await(await side.admin.sendTransaction({to:step.to,data:step.data})).wait();
    if(step.key==='peer')assert.equal(await app.peers(remoteEid),zeroPadValue(peerAddress,32).toLowerCase());
    else {
     const decoded=ep.interface.parseTransaction({data:step.data});
     if(decoded.name==='setConfig')for(const config of decoded.args[2]){
      const stored=await ep.getConfig(address,decoded.args[1],config.eid,config.configType);
      if(config.configType===1n)assert.equal(stored,config.config);
      else {
       const coder=AbiCoder.defaultAbiCoder(),actual=coder.decode([ulnType],stored)[0],expected=coder.decode([ulnType],config.config)[0];
       assert.equal(actual.confirmations,expected.confirmations);assert.equal(actual.requiredDVNCount,2n);
       assert.equal(actual.optionalDVNCount,0n);assert.equal(actual.optionalDVNThreshold,0n);assert.equal(actual.optionalDVNs.length,0);
       assert.deepEqual(Array.from(actual.requiredDVNs),Array.from(expected.requiredDVNs));
      }
     }
     if(decoded.name==='setSendLibrary'){assert.equal(await ep.getSendLibrary(address,remoteEid),decoded.args[2]);assert.equal(await ep.isDefaultSendLibrary(address,remoteEid),false);assert.notEqual(await side.p.getCode(decoded.args[2]),'0x');}
     if(decoded.name==='setReceiveLibrary'){const lib=await ep.getReceiveLibrary(address,remoteEid);assert.equal(lib[0],decoded.args[2]);assert.equal(lib[1],false);assert.notEqual(await side.p.getCode(decoded.args[2]),'0x');}
    }
   }
   await(await app.setPauses(false,false)).wait();
   const options='0x000301001101'+BigInt(200000).toString(16).padStart(32,'0');
   const fee=await app.quoteSend([remoteEid,zeroPadValue(alice,32),parseEther('1'),parseEther('1'),options,'0x','0x'],false);
   assert.ok(fee.nativeFee>0n);assert.equal(fee.lzTokenFee,0n);
   row.endpointChecks.push({chainId:chain.chainId,endpoint:chain.endpoint,configurationVerified:true,nativeFee:String(fee.nativeFee)});
  }
  const params=(n,eid,to)=>[eid,zeroPadValue(to,32),n,n,'0x','0x','0x'];
  const send=async(returning,n)=>{
   const c=returning?oft.connect(a.bob):adapter.connect(b.alice),ep=returning?a.ep:b.ep,to=returning?bob:alice;
   const receipt=await (await c.send(params(n,returning?30102:30417,to),[0,0],to)).wait();
   const packet=receipt.logs.filter(l=>l.address.toLowerCase()===ep.target.toLowerCase()).map(l=>{try{return ep.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='Packet');assert.ok(packet);const sent=receipt.logs.map(l=>{try{return c.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='OFTSent');
   assert.ok(sent);assert.equal(sent.args.guid,packet.args.guid);assert.equal(sent.args.amountSentLD,n);assert.equal(sent.args.amountReceivedLD,n);
   row.messages.push({direction:returning?'Arc-BSC':'BSC-Arc',guid:packet.args.guid,amountLD:String(n),sourceHash:receipt.hash});return packet.args;
  };
  const deliver=async(packet,returning=false)=>{const receipt=await (await (returning?b.ep:a.ep).deliver(returning?ba:aa,[returning?30417:30102,zeroPadValue(returning?aa:ba,32),packet.nonce],packet.guid,packet.message,{gasLimit:2000000})).wait();
   const app=returning?adapter:oft,event=receipt.logs.map(l=>{try{return app.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='OFTReceived');
   assert.ok(event);assert.equal(event.args.guid,packet.guid);assert.equal(event.args.srcEid,returning?30417n:30102n);assert.equal(event.args.toAddress,returning?bob:alice);
   const msg=row.messages.find(m=>m.guid===packet.guid);assert.ok(msg);assert.equal(String(event.args.amountReceivedLD),msg.amountLD);msg.destinationHash=receipt.hash;
  };
  const invariant=async(forward=0n,back=0n,donation=0n)=>{
   assert.equal(await adapter.principalLD(),await oft.totalSupply()+forward+back);
   assert.equal(await token.balanceOf(ba),await adapter.principalLD()+donation);
  };
  row.stage='amounts and redemption';row.amounts=[];row.messages=[];
  for(const amount of ['0.000001','1','1000']){
   const n=parseEther(amount),start=await token.balanceOf(alice),bobStart=await token.balanceOf(bob);
   await (await token.connect(b.alice).approve(ba,n)).wait();
   const packet=await send(false,n);await invariant(n);
   assert.equal(start-await token.balanceOf(alice),n);assert.equal(await token.allowance(alice,ba),0n);
   await deliver(packet);await invariant();await assert.rejects(deliver(packet));
   await (await oft.connect(a.alice).transfer(bob,n)).wait();
   const back=await send(true,n);await invariant(0n,n);
   await (await adapter.setPauses(true,true)).wait();
   await assert.rejects(deliver(back,true));await invariant(0n,n);assert.equal(await b.ep.delivered(back.guid),false);
   await b.configure([[adapter,'setPauses',[true,false]]]);
   await deliver(back,true);await invariant();await assert.rejects(deliver(back,true));
   assert.equal(await token.balanceOf(bob)-bobStart,n);
   await (await token.connect(b.bob).transfer(alice,n)).wait();assert.equal(await token.balanceOf(alice),start);
   await b.configure([[adapter,'setPauses',[false,false]]]);
   row.amounts.push({amount,exactRoundTripViaNewHolder:true,pauseRetrySameGuid:true,replayRejected:true});
  }
  row.stage='insufficient balance and quota exhaustion';
  const checkpointB=await b.local.provider.request({method:'evm_snapshot',params:[]}),checkpointA=await a.local.provider.request({method:'evm_snapshot',params:[]});
  const empty=await b.p.getSigner(9),emptyAddress=await empty.getAddress();assert.equal(await token.balanceOf(emptyAddress),0n);
  await(await token.connect(empty).approve(ba,parseEther('1'))).wait();
  const emptyNonce=await b.ep.nonce();
  await assert.rejects(async()=>{await(await adapter.connect(empty).send(params(parseEther('1'),30417,emptyAddress),[0,0],emptyAddress,{gasLimit:2000000})).wait();});
  assert.equal(await token.balanceOf(emptyAddress),0n);assert.equal(await token.allowance(emptyAddress,ba),parseEther('1'));assert.equal(await b.ep.nonce(),emptyNonce);await invariant();
  await assert.rejects(async()=>{await(await oft.connect(a.bob).send(params(parseEther('1'),30102,bob),[0,0],bob,{gasLimit:2000000})).wait();});await invariant();
  // Zero refill makes exhaustion deterministic without advancing either fork's clock.
  await(await adapter.configureLimit(false,1000000,1000000,1000000)).wait();
  await(await token.connect(b.alice).approve(ba,parseEther('2'))).wait();
  const quotaPacket=await send(false,parseEther('1'));await invariant(parseEther('1'));
  assert.equal(await adapter.availableOutboundSD(),0n);
  const quotaBalance=await token.balanceOf(alice),quotaNonce=await b.ep.nonce();
  await assert.rejects(adapter.connect(b.alice).send.staticCall(params(parseEther('1'),30417,alice),[0,0],alice),e=>e.data===id('InsufficientCredit()').slice(0,10));
  await assert.rejects(async()=>{await(await adapter.connect(b.alice).send(params(parseEther('1'),30417,alice),[0,0],alice,{gasLimit:2000000})).wait();});
  assert.equal(await token.balanceOf(alice),quotaBalance);assert.equal(await b.ep.nonce(),quotaNonce);assert.equal(await token.allowance(alice,ba),parseEther('1'));await invariant(parseEther('1'));
  await(await oft.setPauses(false,true)).wait();await assert.rejects(deliver(quotaPacket));assert.equal(await a.ep.delivered(quotaPacket.guid),false);await invariant(parseEther('1'));
  await(await oft.setPauses(false,false)).wait();await deliver(quotaPacket);await invariant();
  await(await oft.connect(a.alice).transfer(bob,parseEther('1'))).wait();
  const quotaBack=await send(true,parseEther('1'));await invariant(0n,parseEther('1'));await deliver(quotaBack,true);await invariant();
  row.checks.push('zero balance rejects both directions without accounting changes','exhausted source quota rejects without extra debit or nonce','forward receive pause retries original GUID');
  // Keep these evidence rows, explicitly identify the isolated snapshot branch.
  row.quotaMessages=row.messages.splice(-2);
  for(const m of row.quotaMessages)m.snapshotBranch='quota-isolation';
  assert.equal(await b.local.provider.request({method:'evm_revert',params:[checkpointB]}),true);assert.equal(await a.local.provider.request({method:'evm_revert',params:[checkpointA]}),true);
  console.log(selected.id+': amounts and limits passed; test rollback and donated balance');
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
  assert.equal(row.messages.length,8);assert.equal(row.quotaMessages.length,2);
  assert.ok([...row.messages,...row.quotaMessages].every(m=>m.sourceHash&&m.destinationHash));
  row.checks.push('failed actual send restores balance allowance principal and stored bucket','dust and remote-self recipient rejected','donation excluded from principal through roundtrip','underlying supply unchanged');
  row.final={principalLD:'0',oftSupplyLD:'0',donationLD:String(donation)};row.stage='complete';row.passed=true;
  console.log(selected.id+': passed');
 }
 await b.local.provider.request({method:'hardhat_stopImpersonatingAccount',params:[donor]});
 assert.equal((await remote.getBlock(block)).hash,report.forkBlockHash);
 assert.equal((await arcRemote.getBlock(arcBlock)).hash,report.arcForkBlockHash);
 report.passed=report.assets.length===2&&report.assets.every(x=>x.passed);
}catch(e){
 if(row)row.passed=false;
 report.failure={code:typeof e.code==='string'&&/^[A-Z_]+$/.test(e.code)?e.code:'CHECK_FAILED',stage:row?.stage??'setup',message:'Fork or assertion failed; provider details omitted.'};
 report.failure.line=Number(e.stack?.match(/development-dual-fork\.mjs:(\d+)/)?.[1])||null;
 report.passed=false;
}finally{
 for(const local of connections)await local.close();remote?.destroy();arcRemote?.destroy();
 await mkdir('research/production',{recursive:true});await writeFile('research/production/development-dual-fork.json',JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
