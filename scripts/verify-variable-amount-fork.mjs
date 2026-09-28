// Local mainnet forks only: exercise the live planner at current and raised limits.
import assert from 'node:assert/strict';
import {BrowserProvider,Contract,Interface,JsonRpcProvider,JsonRpcSigner} from 'ethers';
import {readFile} from 'node:fs/promises';
import {candidateAppAbi,planCandidateTransfer} from '../web/src/production-transfer.js';

const networks=JSON.parse(await readFile('config/networks.json','utf8'));
process.env.HARDHAT_CONFIG='hardhat.variable-fork.config.js';
const {network}=await import('hardhat');
const pairs={
 binancelife:{sourceToken:'0x924fa68a0fc644485b8df8abfa0a41c2e7744444',bsc:'0x89F3A44786C97618cc4b45721D433c9a83921ec4',arc:'0x9aF52E914DCC692Af046A136AC1c59f98F7347E7'},
 cat:{sourceToken:'0x6894cde390a3f51155ea41ed24a33a4827d3063d',bsc:'0x561750f93BAC5BC237De7FE092b9A40e1cC20b06',arc:'0x503200C60aaA078899B31268833c5F090693E30B'},
};
const admins={bsc:'0xB2039D774574d9171E143cA30aAb48bB25b3F8e8',arc:'0x01dba01e9E6f40669d8D3036316967221Bc0081C'};
const account='0x489594537CB76aC256079D710B6E18498E1a5402';
const options='0x00030100110100000000000000000000000000030d40';
const limits=new Interface(['function configureLimit(bool incoming,uint64 single,uint64 burst,uint64 cap)']);
const forks=[],providers={};
const report={mode:'isolated-mainnet-forks',checkedAt:new Date().toISOString(),assets:{},passed:false};
let stage='setup';
try{
 for(const side of ['bsc','arc']){
  stage=`fork-${side}`;
  const config=networks[side],url=process.env[config.rpcEnv]||config.rpc;
  const remote=new JsonRpcProvider(url,undefined,{batchMaxCount:1});
  const block=await remote.getBlockNumber();remote.destroy();
  const fork=await network.create({network:'local',override:{chainId:config.chainId,hardfork:'cancun',forking:{url,blockNumber:block}}});
  forks.push(fork);providers[side]=new BrowserProvider(fork.provider,undefined,{cacheTimeout:-1});
  report[side]={block};
 }
 for(const [asset,pair] of Object.entries(pairs)){
  stage=`read-${asset}`;
  const result=report.assets[asset]={};
  for(const side of ['bsc','arc']){
   stage=`read-${asset}-${side}`;
   const app=new Contract(pair[side],candidateAppAbi,providers[side]);
   result[side]={codeBytes:(await providers[side].getCode(pair[side])).length/2-1};
   const out=await app.outbound();
   stage=`read-${asset}-${side}-inbound`;
   const incoming=await app.inbound();
   result[side]={outboundSingleSD:out.single.toString(),inboundSingleSD:incoming.single.toString()};
   assert.equal(out.single,1n);assert.equal(incoming.single,1n);
  }
  await assert.rejects(planCandidateTransfer({providers,networks,pair,side:'bsc',account,amount:'0.000002',extraOptions:options}),/超过当前发送或接收额度/);
  result.currentLimitRejectsTwoUnits=true;
  for(const [side,incoming] of [['bsc',false],['arc',true]]){
   stage=`raise-${asset}-${side}`;
   const fork=forks[side==='bsc'?0:1],provider=providers[side];
   await fork.provider.request({method:'hardhat_impersonateAccount',params:[account]});
   await fork.provider.request({method:'hardhat_setBalance',params:[account,'0x56bc75e2d63100000']});
   const signer=new JsonRpcSigner(provider,account);
   const app=new Contract(pair[side],candidateAppAbi,provider);
   const policy=incoming?await app.inbound():await app.outbound();
   assert.ok(policy.burst>=2n&&policy.windowCap>=2n);
   const data=limits.encodeFunctionData('configureLimit',[incoming,2n,policy.burst,policy.windowCap]);
   const admin=new Contract(admins[side],['function executeBatch(address[],bytes[])'],signer);
   const receipt=await (await admin.executeBatch([pair[side]],[data])).wait();
   assert.equal(receipt.status,1);
  }
  stage=`plan-${asset}`;
  const plan=await planCandidateTransfer({providers,networks,pair,side:'bsc',account,amount:'0.000002',extraOptions:options});
  assert.equal(plan.amountLD,2n*10n**12n);
  assert.ok(plan.key==='approve'||plan.key==='send');
  result.locallyRaisedLimitAcceptsTwoUnits=plan.key;
 }
 report.passed=true;
}catch(error){report.failure={stage,code:error.code??'FORK_CHECK_FAILED',message:String(error.shortMessage??error.message).slice(0,180).replace(/https?:\/\/\S+/g,'[RPC]'),detail:String(error.info?.error?.message??error.reason??'').slice(0,180).replace(/https?:\/\/\S+/g,'[RPC]')};process.exitCode=1;}
finally{for(const fork of forks)await fork.close().catch(()=>{});}
console.log(JSON.stringify(report));
