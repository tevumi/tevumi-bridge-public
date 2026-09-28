// Executes the proposed unsigned transactions on isolated mainnet forks only.
import {network} from 'hardhat';
import {BrowserProvider,JsonRpcSigner,Contract,zeroPadValue} from 'ethers';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {compile} from './compile.mjs';

const root='research/production/immediate-beta-unsigned';
const policy=JSON.parse(await readFile(root+'/policy.json','utf8'));
const check=JSON.parse(await readFile(root+'/preparation-check.json','utf8'));
const plan=JSON.parse(await readFile(root+'/manifest.json','utf8'));
const net=JSON.parse(await readFile('config/networks.json','utf8'));
const assets=JSON.parse(await readFile('config/meme-candidates.json','utf8')).assets;
const build=compile();
const opened=[];
const report={checkedAt:new Date().toISOString(),mode:'ISOLATED_IMMEDIATE_BETA_FORK',passed:false,chains:{},limitations:['All transactions are local fork simulations.','No mainnet deployment, unpause, token transfer or DVN delivery.','Mainnet wallet signatures are still required.']};
let stage='setup';
try{
 assert.equal(plan.status,'UNSIGNED_PAUSED_CANDIDATE');
 assert.equal(plan.governanceMode,'immediate-eoa');
 assert.equal(plan.deployments.length,6);
 for(const side of ['bsc','arc']){
  stage=side+':fork';const c=net[side],head=check.chains[side],url=process.env[c.rpcEnv];assert.ok(url);
  stage=side+':local-fork';const local=await network.create({network:'local',override:{chainId:c.chainId,hardfork:'cancun',forking:{url,blockNumber:head.blockNumber}}});opened.push(local);
  const p=new BrowserProvider(local.provider,undefined,{cacheTimeout:-1}),who=policy[side].deployer;
  stage=side+':verify-head';assert.equal((await p.getBlock(head.blockNumber)).hash,head.blockHash);
  stage=side+':impersonate';await local.provider.request({method:'hardhat_impersonateAccount',params:[who]});
  stage=side+':fund-local';await local.provider.request({method:'hardhat_setBalance',params:[who,'0x56bc75e2d63100000']});
  stage=side+':signer';const signer=new JsonRpcSigner(p,who),expected=policy[side].startNonce;
  stage=side+':nonce';
  assert.equal(await p.getTransactionCount(who),expected);
  const deployed=[];
  for(const item of plan.deployments.filter(x=>x.side===side)){
   stage=item.id+':deploy';assert.equal(item.transaction.nonce,expected+deployed.length);
   const receipt=await(await signer.sendTransaction(item.transaction)).wait();
   assert.equal(receipt.status,1);assert.equal(receipt.contractAddress.toLowerCase(),item.predictedAddress.toLowerCase());
   deployed.push({id:item.id,address:receipt.contractAddress,hash:receipt.hash,gasUsed:receipt.gasUsed.toString()});
  }
  const adminAbi=build['contracts/production/ImmediateAdmin.sol'].ImmediateAdmin.abi;
  const admin=new Contract(plan.governance[side],adminAbi,signer),batch=plan.configurations.find(x=>x.side===side);
  assert.equal(await admin.owner(),who);
  assert.equal(batch.schedule,undefined);
  stage=side+':execute';assert.equal((await(await signer.sendTransaction(batch.execute)).wait()).status,1);
  for(const asset of assets){
   stage=side+':'+asset.id+':verify';
   const abi=build['contracts/production/'+(side==='bsc'?'ImmediateAdapter':'ImmediateOFT')+'.sol'][side==='bsc'?'ImmediateAdapter':'ImmediateOFT'].abi;
   const app=new Contract(plan.apps[side][asset.id],abi,p),other=side==='bsc'?'arc':'bsc';
   assert.equal(await app.owner(),plan.governance[side]);
   assert.equal(await app.guardian(),who);
   assert.equal((await app.endpoint()).toLowerCase(),c.endpoint.toLowerCase());
   assert.equal(await app.peers(net[other].eid),zeroPadValue(plan.apps[other][asset.id],32).toLowerCase());
   assert.equal(await app.receivesPaused(),true);
   assert.equal(await app[side==='bsc'?'depositsPaused':'sendsPaused'](),true);
   if(side==='bsc')assert.equal(await app.capacityLD(),BigInt(policy.assets[asset.id].capacityLD));
   else assert.equal(await app.totalSupply(),0n);
  }
  report.chains[side]={blockNumber:head.blockNumber,blockHash:head.blockHash,nonce:expected,deployed,configured:true,stillPaused:true};
 }
 report.passed=true;
}catch(error){report.failure={stage,code:'LOCAL_REHEARSAL_FAILED',reason:String(error?.shortMessage??error?.message??'').slice(0,140).replace(/https?:\/\/\S+/g,'[url]'),providerCode:error?.code??null,detail:String(error?.info?.error?.message??error?.error?.message??'').slice(0,140).replace(/https?:\/\/\S+/g,'[url]')};process.exitCode=1;}
finally{for(const local of opened)await local.close().catch(()=>{});}
await writeFile(root+'/fork-rehearsal.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,stage,chains:Object.fromEntries(Object.entries(report.chains).map(([key,value])=>[key,{blockNumber:value.blockNumber,nonce:value.nonce,deployed:value.deployed.length,configured:value.configured,stillPaused:value.stillPaused}])),failure:report.failure}));
