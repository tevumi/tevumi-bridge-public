// Execute the exact unsigned batch calldata only on isolated mainnet forks.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BrowserProvider,Contract,JsonRpcProvider,JsonRpcSigner,keccak256} from 'ethers';
import {candidateAppAbi,planCandidateTransfer} from '../web/src/production-transfer.js';

process.env.HARDHAT_CONFIG='hardhat.variable-fork.config.js';
const {network}=await import('hardhat');
const networks=JSON.parse(await readFile('config/networks.json','utf8'));
const plan=JSON.parse(await readFile('web/immediate-deploy/limits-plan.json','utf8'));
const pairs={
 binancelife:{sourceToken:'0x924fa68a0fc644485b8df8abfa0a41c2e7744444',bsc:'0x89F3A44786C97618cc4b45721D433c9a83921ec4',arc:'0x9aF52E914DCC692Af046A136AC1c59f98F7347E7'},
 cat:{sourceToken:'0x6894cde390a3f51155ea41ed24a33a4827d3063d',bsc:'0x561750f93BAC5BC237De7FE092b9A40e1cC20b06',arc:'0x503200C60aaA078899B31268833c5F090693E30B'},
};
const options='0x00030100110100000000000000000000000000030d40';
const forks=[],providers={},result={mode:'isolated-mainnet-forks',assets:{},passed:false};
let stage='setup';
try{
 for(const item of plan.batches){
  stage=`fork-${item.side}`;
  const config=networks[item.side],url=process.env[config.rpcEnv]||config.rpc;
  const remote=new JsonRpcProvider(url,undefined,{batchMaxCount:1});
  const block=await remote.getBlockNumber();remote.destroy();
  const fork=await network.create({network:'local',override:{chainId:config.chainId,hardfork:'cancun',forking:{url,blockNumber:block}}});
  forks.push(fork);const provider=new BrowserProvider(fork.provider,undefined,{cacheTimeout:-1});providers[item.side]=provider;
  assert.equal(keccak256(item.transaction.data),item.calldataHash);
  await fork.provider.request({method:'hardhat_impersonateAccount',params:[plan.account]});
  await fork.provider.request({method:'hardhat_setBalance',params:[plan.account,'0x56bc75e2d63100000']});
  stage=`execute-${item.side}`;
  const signer=new JsonRpcSigner(provider,plan.account);
  const receipt=await (await signer.sendTransaction({to:item.admin,data:item.transaction.data,value:0n})).wait();
  assert.equal(receipt.status,1);
  result[item.side]={forkBlock:block,gasUsed:receipt.gasUsed.toString(),batchHash:item.calldataHash};
 }
 for(const [asset,pair] of Object.entries(pairs)){
  stage=`verify-${asset}`;
  for(const side of ['bsc','arc']){
   const app=new Contract(pair[side],candidateAppAbi,providers[side]);
   const [out,inbound]=await Promise.all([app.outbound(),app.inbound()]);
   assert.equal(out.single,2n);assert.equal(inbound.single,2n);
   assert.equal(out.burst,10n);assert.equal(inbound.burst,10n);
   assert.equal(out.windowCap,100n);assert.equal(inbound.windowCap,100n);
  }
  const args={providers,networks,pair,side:'bsc',account:plan.account,extraOptions:options};
  const allowed=await planCandidateTransfer({...args,amount:'0.000002'});
  assert.equal(allowed.amountLD,2n*10n**12n);
  await assert.rejects(planCandidateTransfer({...args,amount:'0.000003'}),/超过当前发送或接收额度/);
  result.assets[asset]={twoUnits:allowed.key,threeUnitsRejected:true};
 }
 result.passed=true;
}catch(error){result.failure={stage,code:error.code??'FORK_FAILED',message:String(error.shortMessage??error.message).slice(0,180).replace(/https?:\/\/\S+/g,'[RPC]')};process.exitCode=1;}
finally{for(const fork of forks)await fork.close().catch(()=>{});}
console.log(JSON.stringify(result));
