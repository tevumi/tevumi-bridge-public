// ONLY in-memory fork writes. Never connects a signer to a remote provider.
import {network} from 'hardhat';
import {BrowserProvider,JsonRpcProvider,Contract,ContractFactory,ZeroHash,id,keccak256} from 'ethers';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {compile} from './compile.mjs';
const chains=JSON.parse(await readFile('config/networks.json')),build=compile();
const report={checkedAt:new Date().toISOString(),mode:'local-forks-only',chains:{},limitations:['Local dummy asset/proposer; no real multisig verification.','No mainnet transactions or DVN delivery.']};
for(const [key,c] of Object.entries(chains)){
 let local,remote;
 const r=report.chains[key]={chainId:c.chainId};
 try{
  const url=process.env[c.rpcEnv]||c.rpc;
  remote=new JsonRpcProvider(url,undefined,{batchMaxCount:1});
  if(Number((await remote.getNetwork()).chainId)!==c.chainId)throw new Error('CHAIN_MISMATCH');
  r.forkBlock=await remote.getBlockNumber();
  local=await network.create({network:'local',override:{chainId:c.chainId,hardfork:'cancun',forking:{url,blockNumber:r.forkBlock}}});
  const p=new BrowserProvider(local.provider,undefined,{cacheTimeout:-1}),admin=await p.getSigner(0),proposer=await p.getSigner(1),guardian=await p.getSigner(2),who=await admin.getAddress();
  const deploy=async(n,args)=>{const a=Object.values(build).find(x=>x[n])?.[n];const x=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,admin).deploy(...args);await x.waitForDeployment();return x;};
  const tl=await deploy('BridgeTimelock',[86400,await proposer.getAddress()]),ta=await tl.getAddress();
  const token=await deploy('PilotToken',[who]);
  const app=key==='bsc'?await deploy('GovernedAdapter',[await token.getAddress(),c.endpoint,ta,await guardian.getAddress(),100n*10n**12n,[20,100,100],[20,100,100]]):await deploy('GovernedOFT',['Local Test','LOCAL',await token.getAddress(),c.endpoint,ta,await guardian.getAddress(),[20,100,100],[20,100,100]]);
  const address=await app.getAddress(),dst=key==='bsc'?30417:30102;
  const ep=new Contract(c.endpoint,['function delegates(address) view returns(address)','function getSendLibrary(address,uint32) view returns(address)','function setSendLibrary(address,uint32,address)'],admin);
  if((await app.owner())!==ta||(await ep.delegates(address))!==ta)throw new Error('AUTHORITY_MISMATCH');
  r.endpointCodeHash=keccak256(await p.getCode(c.endpoint));r.initialAuthoritiesVerified=true;
  const lib=await ep.getSendLibrary(address,dst);
  const expected=id('LZ_Unauthorized()').slice(0,10);
  for(const [label,signer] of [['deployer',admin],['proposer',proposer],['guardian',guardian]]){
   let rejected=false;
   try{await ep.connect(signer).setSendLibrary.staticCall(address,dst,lib);}catch(e){const data=e.data??e.info?.error?.data;rejected=typeof data==='string'&&data.startsWith(expected);}
   if(!rejected)throw new Error('EXPECTED_AUTHORIZATION_REJECTION');r[label+'DirectRejected']=true;
  }
  const data=ep.interface.encodeFunctionData('setSendLibrary',[address,dst,lib]),salt=id('fork-library');
  await (await tl.connect(proposer).schedule(c.endpoint,0,data,ZeroHash,salt,86400)).wait();
  let early=false;try{await tl.connect(proposer).execute.staticCall(c.endpoint,0,data,ZeroHash,salt);}catch{early=true;}
  if(!early)throw new Error('EARLY_EXECUTION');
  await local.provider.request({method:'evm_increaseTime',params:[86400]});await local.provider.request({method:'evm_mine',params:[]});
  await (await tl.connect(proposer).execute(c.endpoint,0,data,ZeroHash,salt)).wait();
  if((await ep.getSendLibrary(address,dst))!==lib)throw new Error('LIBRARY_MISMATCH');
  r.delayedEndpointWriteVerified=true;r.passed=true;
 }catch(e){r.passed=false;r.error='FORK_CHECK_FAILED';r.errorCode=typeof e.code==='string'&&/^[A-Z_]+$/.test(e.code)?e.code:'UNCLASSIFIED';console.log(key+': failed (provider details omitted)');}
 finally{remote?.destroy();if(local)await local.close();}
}
await mkdir('research/production',{recursive:true});await writeFile('research/production/governance-fork.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(Object.values(report.chains).some(c=>!c.passed))process.exitCode=1;
