// Rehearse generated unsigned CREATE and Timelock calldata in local forks ONLY.
import {network} from 'hardhat';
import {BrowserProvider,JsonRpcProvider,FetchRequest,Contract,Interface,AbiCoder,ZeroHash,ZeroAddress,zeroPadValue,keccak256} from 'ethers';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {compile} from './compile.mjs';
import {prepareRelease} from './production-release.mjs';
import {createLocalSafe} from './safe-fork-helper.mjs';
import {endpointAbi,ulnType} from '../web/src/bridge.js';
const report={checkedAt:new Date().toISOString(),mode:'LOCAL_FORK_REHEARSAL_ONLY',passed:false,chains:{},assets:{}};
const connections=[],sides={},coder=AbiCoder.defaultAbiCoder(),epi=new Interface(endpointAbi);let stage='setup',plan;
try{
 const net=JSON.parse(await readFile('config/networks.json','utf8')),assets=JSON.parse(await readFile('config/meme-candidates.json','utf8')).assets,build=compile();
 const art=name=>build['contracts/production/'+name+'.sol'][name];
 const policy={releaseId:'local-rehearsal-only',delaySeconds:86400,assets:{}};
 for(const side of ['bsc','arc']){
  stage=side+':fork';const c=net[side],url=process.env[c.rpcEnv];assert.ok(url);
  const request=new FetchRequest(url);request.timeout=20000;const remote=new JsonRpcProvider(request,undefined,{batchMaxCount:1});
  try{
   assert.equal(Number((await remote.getNetwork()).chainId),c.chainId);
   const block=await remote.getBlock('latest');report.chains[side]={blockNumber:block.number,blockHash:block.hash};
   const local=await network.create({network:'local',override:{chainId:c.chainId,hardfork:'cancun',forking:{url,blockNumber:block.number}}});connections.push(local);
   const p=new BrowserProvider(local.provider,undefined,{cacheTimeout:-1}),relayer=await p.getSigner(0),owners=await Promise.all([1,2,3].map(i=>p.getSigner(i))),guardian=await (await p.getSigner(4)).getAddress();
   stage=side+':safe';const safe=await createLocalSafe(p,c.chainId,relayer,owners),deployer=await relayer.getAddress();
   policy[side]={deployer,startNonce:await p.getTransactionCount(deployer),safe:safe.address,owners:await Promise.all(owners.map(x=>x.getAddress())),threshold:2,guardian};
   sides[side]={p,local,relayer,owners,safe};
  }finally{remote.destroy();}
 }
 for(const asset of assets){
  stage=asset.id+':metadata';const source=new Contract(asset.sourceToken,['function name() view returns(string)','function symbol() view returns(string)','function decimals() view returns(uint8)'],sides.bsc.p);
  assert.equal(await source.name(),asset.sourceName);assert.equal(await source.symbol(),asset.sourceSymbol);assert.equal(await source.decimals(),18n);
  const cached=JSON.parse(await readFile('research/'+asset.sourceToken.toLowerCase()+'.sourcify.json','utf8'));
  assert.equal((await sides.bsc.p.getCode(asset.sourceToken)).toLowerCase(),cached.runtimeBytecode.onchainBytecode.toLowerCase());
  // Explicit simulation parameters in shared units, not an approved risk budget.
  const limits=['1000000000','10000000000','20000000000'];
  policy.assets[asset.id]={capacityLD:'10000000000000000000000',bsc:{outbound:limits,inbound:limits},arc:{outbound:limits,inbound:limits}};
 }
 plan=await prepareRelease(build,policy,net,assets);plan.status='LOCAL_SIMULATED_ADDRESSES_DO_NOT_BROADCAST';
 for(const d of plan.deployments){
  stage=d.id+':deploy';const s=sides[d.side];assert.equal(await s.p.getCode(d.transaction.from),'0x');assert.equal(await s.p.getTransactionCount(d.transaction.from),d.transaction.nonce);
  const receipt=await (await s.relayer.sendTransaction(d.transaction)).wait();assert.equal(receipt.contractAddress.toLowerCase(),d.predictedAddress.toLowerCase());
  const creation=await s.p.getTransaction(receipt.hash);assert.equal(creation.data,d.transaction.data);
  d.localReceipt={transactionHash:receipt.hash,blockNumber:receipt.blockNumber,gasUsed:String(receipt.gasUsed),runtimeHash:keccak256(await s.p.getCode(d.predictedAddress))};
 }
 for(const side of ['bsc','arc']){
  const s=sides[side],c=net[side],remote=net[side==='bsc'?'arc':'bsc'].eid,tl=new Contract(plan.governance[side],art('BridgeTimelock').abi,s.relayer),ep=new Contract(c.endpoint,endpointAbi,s.p);
  const batch=plan.configurations.find(x=>x.side===side);stage=side+':schedule';
  assert.equal(await tl.getMinDelay(),86400n);
  for(const role of ['PROPOSER_ROLE','EXECUTOR_ROLE','CANCELLER_ROLE'])assert.equal(await tl.hasRole(await tl[role](),s.safe.address),true);
  assert.equal(await tl.hasRole(ZeroHash,plan.governance[side]),true);assert.equal(await tl.hasRole(ZeroHash,policy[side].deployer),false);
  await s.safe.execute(batch.schedule.to,batch.schedule.data,[s.owners[0],s.owners[1]]);
  await assert.rejects(s.safe.execute(batch.execute.to,batch.execute.data,[s.owners[0],s.owners[1]]),e=>e.code==='CALL_EXCEPTION'||e.message==='SAFE_EXECUTION_REJECTED');
  await s.local.provider.request({method:'evm_increaseTime',params:[86400]});await s.local.provider.request({method:'evm_mine',params:[]});
  stage=side+':execute';await s.safe.execute(batch.execute.to,batch.execute.data,[s.owners[0],s.owners[1]]);
  for(const asset of assets){
   stage=side+':'+asset.id+':verify';const target=plan.apps[side][asset.id],peer=plan.apps[side==='bsc'?'arc':'bsc'][asset.id],app=new Contract(target,art(side==='bsc'?'GovernedAdapter':'GovernedOFT').abi,s.p);
   assert.equal(await app.owner(),plan.governance[side]);assert.equal(await ep.delegates(target),plan.governance[side]);assert.equal(await app.guardian(),policy[side].guardian);
   assert.equal((await app.endpoint()).toLowerCase(),c.endpoint.toLowerCase());assert.equal(await app.peers(remote),zeroPadValue(peer,32).toLowerCase());
   assert.equal(await app.receivesPaused(),true);assert.equal(await app[side==='bsc'?'depositsPaused':'sendsPaused'](),true);
   assert.equal(await app.msgInspector(),ZeroAddress);assert.equal(await app.enforcedOptions(remote,1),'0x');
   for(const dir of ['outbound','inbound'])assert.deepEqual(Array.from(await app[dir]()).slice(0,3),policy.assets[asset.id][side][dir].map(BigInt));
   if(side==='bsc'){assert.equal(await app.capacityLD(),BigInt(policy.assets[asset.id].capacityLD));assert.equal(await app.principalLD(),0n);assert.equal((await app.token()).toLowerCase(),asset.sourceToken.toLowerCase());}
   else{assert.equal(await app.totalSupply(),0n);assert.equal((await app.sourceToken()).toLowerCase(),asset.sourceToken.toLowerCase());assert.equal(await app.name(),asset.sourceName);assert.equal(await app.symbol(),asset.sourceSymbol);}
   const steps=batch.steps.filter(x=>x.assetId===asset.id);
   const send=epi.decodeFunctionData('setSendLibrary',steps.find(x=>x.key==='sendLibrary').data);
   assert.equal(await ep.getSendLibrary(target,remote),send[2]);assert.equal(await ep.isDefaultSendLibrary(target,remote),false);
   const receive=epi.decodeFunctionData('setReceiveLibrary',steps.find(x=>x.key==='receiveLibrary').data),actual=await ep.getReceiveLibrary(target,remote);
   assert.equal(actual[0],receive[2]);assert.equal(actual[1],false);
   for(const key of ['sendDVN','receiveDVN','executor']){
    const args=epi.decodeFunctionData('setConfig',steps.find(x=>x.key===key).data),raw=await ep.getConfig(target,args[1],remote,args[2][0].configType);
    if(key==='executor')assert.equal(raw,args[2][0].config);
    else{const got=coder.decode([ulnType],raw)[0],expected=coder.decode([ulnType],args[2][0].config)[0];assert.equal(got.confirmations,expected.confirmations);assert.equal(got.requiredDVNCount,2n);assert.equal(got.optionalDVNCount,0n);assert.equal(got.optionalDVNThreshold,0n);assert.equal(got.optionalDVNs.length,0);assert.deepEqual(Array.from(got.requiredDVNs),Array.from(expected.requiredDVNs));}
   }
   report.assets[side+':'+asset.id]={passed:true,address:target,paused:true,metadataLimitsGovernanceAndChannelMatched:true};
  }
  report.chains[side].passed=true;console.log(side+': two assets configured and verified, still paused');
 }
 report.passed=Object.keys(report.assets).length===4&&Object.values(report.assets).every(x=>x.passed);
}catch{report.failure={stage,code:'REHEARSAL_FAILED',detail:'Provider details omitted.'};report.passed=false;}
finally{for(const local of connections)await local.close();}
report.limitations=['All Safe owners, deployers, guardians and budget parameters are local simulations.','No mainnet deployment, token transfer, unpause, DVN delivery or audit approval.','Predicted and actual addresses in this report are local-only.'];
await mkdir('research/production',{recursive:true});await writeFile('research/production/release-fork.json',JSON.stringify(report,null,2)+'\n');
if(plan)await writeFile('research/production/release-fork-plan.json',JSON.stringify(plan,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
