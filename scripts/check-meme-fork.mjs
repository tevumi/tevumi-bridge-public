// Read remote state only. All funding, impersonation, deployments and messages are LOCAL.
import {network} from 'hardhat';
import {BrowserProvider,JsonRpcSigner,JsonRpcProvider,FetchRequest,Contract,ContractFactory,parseEther,zeroPadValue,keccak256,ZeroAddress} from 'ethers';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {compile} from './compile.mjs';
const tokens=[{id:'binancelife',address:'0x924fa68a0fc644485b8df8abfa0a41c2e7744444'},{id:'cat',address:'0x6894cde390a3f51155ea41ed24a33a4827d3063d'}];
const result={checkedAt:new Date().toISOString(),mode:'BSC fork + local mock endpoints; NOT live Arc delivery',tokens:[],limitations:['Only the underlying BSC token runtime/state is real fork data.','RestrictedAsset contracts are local only; no deployment to Arc.','No mainnet writes, purchases or user signatures. No DVN or liquidity validation.']};
let fork,remote;
try{
 assert.ok(process.env.BSC_RPC_URL,'BSC_RPC_URL is required');
 const req=new FetchRequest(process.env.BSC_RPC_URL);req.timeout=20000;remote=new JsonRpcProvider(req);
 assert.equal(Number((await remote.getNetwork()).chainId),56);
 const block=Number(process.env.MEME_FORK_BLOCK??((await remote.getBlockNumber())-20));result.forkBlock=block;
 fork=await network.create({network:'local',override:{chainId:56,hardfork:'cancun',forking:{url:process.env.BSC_RPC_URL,blockNumber:block}}});
 // Mine locally so EDR uses the explicitly selected hardfork instead of unknown BSC history.
 await fork.provider.request({method:'evm_mine',params:[]});
 const p=new BrowserProvider(fork.provider,undefined,{cacheTimeout:-1});const signer=await p.getSigner(0),who=await signer.getAddress();
 const build=compile();
 const deploy=async(name,args)=>{const a=Object.values(build).find(f=>f[name])[name];const c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 const donor='0xf977814e90da44bfa03b6295a0616a897441acec';
 // Impersonating a funded address is supported only on this in-memory fork.
 await fork.provider.request({method:'hardhat_impersonateAccount',params:[donor]});await fork.provider.request({method:'hardhat_setBalance',params:[donor,'0x56bc75e2d63100000']});const donorSigner=new JsonRpcSigner(p,donor);
 for(const selected of tokens){
 const row={...selected,checks:[]};result.tokens.push(row);
 const cached=JSON.parse(readFileSync('research/'+selected.address+'.sourcify.json'));
 const code=await p.getCode(selected.address);assert.equal(code.toLowerCase(),cached.runtimeBytecode.onchainBytecode.toLowerCase(),'runtime changed');row.runtimeHash=keccak256(code);row.sourceRuntimeUnchanged=true;
 const token=new Contract(selected.address,cached.abi,signer);row.name=await token.name();row.symbol=await token.symbol();row.decimals=Number(await token.decimals());row.totalSupply=String(await token.totalSupply());assert.equal(row.decimals,18);
 if(selected.id==='binancelife'){row.owner=await token.owner();row.mode=String(await token._mode());assert.equal(row.owner,ZeroAddress);assert.equal(row.mode,'0');}
 const funding=parseEther('10000');const before=await token.balanceOf(who),donorBefore=await token.balanceOf(donor);await(await token.connect(donorSigner).transfer(who,funding)).wait();assert.equal(await token.balanceOf(who)-before,funding);assert.equal(donorBefore-await token.balanceOf(donor),funding);row.checks.push('holder transfer exact');
 const source=await deploy('MockEndpoint',[30102]),dest=await deploy('MockEndpoint',[30417]);
 const adapter=await deploy('RestrictedAssetAdapter',[selected.address,await source.getAddress(),who,who,30417,parseEther('1000'),parseEther('10000')]);
 const oft=await deploy('RestrictedAssetOFT',[row.name, selected.id==='cat'?'CAT':'BNLIFE', selected.address, await dest.getAddress(),who,who,30102,parseEther('1000'),parseEther('10000')]);
 assert.equal((await oft.sourceToken()).toLowerCase(),selected.address);assert.equal(await oft.name(),'Tevumi Bridged '+row.name);
 const a=await adapter.getAddress(),o=await oft.getAddress();await(await adapter.setPeer(30417,zeroPadValue(o,32))).wait();await(await oft.setPeer(30102,zeroPadValue(a,32))).wait();
 const params=(n,eid)=>[eid,zeroPadValue(who,32),n,n,'0x','0x','0x'];
 const send=async(c,ep,n,eid)=>{const r=await(await c.send(params(n,eid),[0,0],who)).wait();return r.logs.map(l=>{try{return ep.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='Packet').args;};
 const deliver=async(ep,target,packet,eid)=>{await(await ep.deliver(target,[eid,zeroPadValue(packet.sender,32),packet.nonce],packet.guid,packet.message)).wait();};
 row.amounts=[];
 for(const amount of ['0.000001','1','1000']){const n=parseEther(amount),initial=await token.balanceOf(who);await(await token.approve(a,n)).wait();assert.equal(await token.allowance(who,a),n);
 const packet=await send(adapter,source,n,30417);assert.equal(await token.balanceOf(a),n);assert.equal(initial-await token.balanceOf(who),n);assert.equal(await token.allowance(who,a),0n);
 await deliver(dest,o,packet,30102);assert.equal(await oft.balanceOf(who),n);assert.equal(await oft.totalSupply(),n);await assert.rejects(deliver(dest,o,packet,30102));
 await(await adapter.setDepositsPaused(true)).wait();await assert.rejects(adapter.send(params(n,30417),[0,0],who));
 const back=await send(oft,dest,n,30102);assert.equal(await oft.totalSupply(),0n);await deliver(source,a,back,30417);assert.equal(await token.balanceOf(who),initial);assert.equal(await token.balanceOf(a),0n);await assert.rejects(deliver(source,a,back,30417));await(await adapter.setDepositsPaused(false)).wait();row.amounts.push({amount,exactRoundTrip:true,pausedRedemption:true,replayRejected:true});}
 await assert.rejects(adapter.send(params(1n,30417),[0,0],who));row.checks.push('sub-shared-decimal dust rejected');assert.equal(String(await token.totalSupply()),row.totalSupply);row.checks.push('underlying supply unchanged');row.passed=true;console.log(selected.id+': passed');
 }
 await fork.provider.request({method:'hardhat_stopImpersonatingAccount',params:[donor]});
}catch(e){result.failure={code:e.code??'CHECK_FAILED',message:'Read/fork/assertion failed; private RPC details omitted', action:e.action, revert:e.revert?.name, selector:e.transaction?.data?.slice(0,10), detail:String(e.info?.error?.message??e.shortMessage??'').replaceAll(process.env.BSC_RPC_URL??'__none__','[private RPC]').replace(/https?:\/\/[^\s"')]+/g,'[RPC]').slice(0,400)};console.error(result.failure);process.exitCode=1;
}finally{if(fork)await fork.close();if(remote)remote.destroy();writeFileSync('research/preflight/real-asset-contract-fork.json',JSON.stringify(result,null,2)+'\n');}
