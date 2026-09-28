// All deployments, signatures and config writes occur ONLY inside two Hardhat forks.
import {network} from 'hardhat';
import {AbiCoder,BrowserProvider,JsonRpcProvider,Contract,ContractFactory,Interface,ZeroHash,zeroPadValue} from 'ethers';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {compile} from './compile.mjs';
import {configurationSteps,endpointAbi,ulnType} from '../web/src/bridge.js';
import {routes} from '../web/src/routes.js';
import {createLocalSafe} from './safe-fork-helper.mjs';

const chains=JSON.parse(await readFile('config/networks.json')),build=compile(),sides={};
const result={checkedAt:new Date().toISOString(),mode:'local-mainnet-forks-only',chains:{},limitations:['Safe owners are local simulated accounts; real custody and Safe UI/Transaction Service are untested.','Real DVN delivery, target execution and finality are untested.','Configuration uses the dated candidate routes in web/src/routes.js; fresh production security review remains required.']};
const epIface=new Interface(endpointAbi);
const coder=AbiCoder.defaultAbiCoder();
let activeKey;
const connections=[];
const deployerArt=n=>Object.values(build).find(x=>x[n])?.[n];
try{
  for(const key of ['bsc','arc']){
    const c=chains[key];
    activeKey=key;
    const r=result.chains[key]={chainId:c.chainId};
    const url=process.env[c.rpcEnv]||c.rpc,remote=new JsonRpcProvider(url,undefined,{batchMaxCount:1});
    try{
      r.stage='check chain';
      if(Number((await remote.getNetwork()).chainId)!==c.chainId)throw new Error('CHAIN_MISMATCH');
      r.forkBlock=await remote.getBlockNumber();
      r.stage='create fork';
      const local=await network.create({network:'local',override:{chainId:c.chainId,hardfork:'cancun',forking:{url,blockNumber:r.forkBlock}}});
      connections.push(local);
      const provider=new BrowserProvider(local.provider,undefined,{cacheTimeout:-1});
      const relayer=await provider.getSigner(0),owners=await Promise.all([1,2,3].map(i=>provider.getSigner(i))),guardian=await provider.getSigner(4);
      const deploy=async(n,args)=>{const a=deployerArt(n);const x=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,relayer).deploy(...args);await x.waitForDeployment();return x;};
      r.stage='create Safe';
      const safe=await createLocalSafe(provider,c.chainId,relayer,owners);
      r.stage='deploy governance and app';
      const tl=await deploy('BridgeTimelock',[86400,safe.address]);
      const token=key==='bsc'?await deploy('PilotToken',[await relayer.getAddress()]):sides.bsc.token;
      const app=key==='bsc'?await deploy('GovernedAdapter',[await token.getAddress(),c.endpoint,await tl.getAddress(),await guardian.getAddress(),100n*10n**12n,[20,100,100],[20,100,100]]):await deploy('GovernedOFT',[await token.name(),await token.symbol(),await token.getAddress(),c.endpoint,await tl.getAddress(),await guardian.getAddress(),[20,100,100],[20,100,100]]);
      sides[key]={c,local,provider,owners,guardian,safe,tl,app,token};
      r.safeRegistryHashesVerified=true;r.safeTwoOfThreeCreated=true;r.ownerAndDelegateMatch=(await app.owner())===(await tl.getAddress())&&(await new Contract(c.endpoint,endpointAbi,provider).delegates(await app.getAddress()))===(await tl.getAddress());
      if(!r.ownerAndDelegateMatch)throw new Error('GOVERNANCE_MISMATCH');
      const payload=tl.interface.encodeFunctionData('getMinDelay');
      r.stage='reject single signature';
      let oneRejected=false;try{await safe.execute(await tl.getAddress(),payload,[owners[0]]);}catch{oneRejected=true;}
      if(!oneRejected)throw new Error('SAFE_ONE_SIGNATURE_ACCEPTED');r.singleSignatureRejected=true;
    }finally{remote.destroy();}
  }
  for(const [key,side] of Object.entries(sides)){
    activeKey=key;
    const {c,local,provider,owners,safe,tl,app}=side,r=result.chains[key];
    const other=sides[key==='bsc'?'arc':'bsc'],target=await app.getAddress(),peer=await other.app.getAddress(),route=routes[c.chainId],remoteEid=other.c.eid;
    for(const address of [route.sendLibrary,route.receiveLibrary,route.executor,...route.dvns])if(await provider.getCode(address)==='0x')throw new Error('INFRASTRUCTURE_CODE_MISSING');
    const steps=configurationSteps(c.chainId,{...c,remote:remoteEid},target,peer);
    r.stage='schedule config';
    const targets=steps.map(x=>x.to),values=steps.map(()=>0),data=steps.map(x=>x.data),salt=ZeroHash,delay=86400;
    const schedule=tl.interface.encodeFunctionData('scheduleBatch',[targets,values,data,ZeroHash,salt,delay]);
    await safe.execute(await tl.getAddress(),schedule,[owners[0],owners[1]]);
    r.safeTwoSignaturesScheduled=true;
    const execution=tl.interface.encodeFunctionData('executeBatch',[targets,values,data,ZeroHash,salt]);
    const operation=await tl.hashOperationBatch(targets,values,data,ZeroHash,salt);
    if(!await tl.hasRole(await tl.EXECUTOR_ROLE(),safe.address) || !await tl.isOperationPending(operation) || await tl.isOperationReady(operation))throw new Error('EARLY_EXECUTION_PRECONDITION_FAILED');
    // Use the same authorized Safe and signers before and after the delay.
    let early=false;try{await safe.execute(await tl.getAddress(),execution,[owners[1],owners[2]]);}catch(e){if(e.code==='CALL_EXCEPTION' || e.message==='SAFE_EXECUTION_REJECTED')early=true;else throw e;}
    if(!early)throw new Error('EARLY_EXECUTION_ACCEPTED');r.earlyExecutionRejected=true;
    r.stage='execute config';
    await local.provider.request({method:'evm_increaseTime',params:[delay]});await local.provider.request({method:'evm_mine',params:[]});
    await safe.execute(await tl.getAddress(),execution,[owners[1],owners[2]]);
    if(!await tl.isOperationDone(operation))throw new Error('TIMELOCK_OPERATION_NOT_DONE');
    r.stage='inspect config';
    r.safeTwoSignaturesExecuted=true;
    const ep=new Contract(c.endpoint,endpointAbi,provider),checks={};
    checks.peer=(await app.peers(remoteEid)).toLowerCase()===zeroPadValue(peer,32).toLowerCase();
    checks.assetIdentity=key==='bsc'?(await app.token()).toLowerCase()===(await side.token.getAddress()).toLowerCase():(await app.sourceToken()).toLowerCase()===(await sides.bsc.token.getAddress()).toLowerCase()&&(await app.name())===(await sides.bsc.token.name())&&(await app.symbol())===(await sides.bsc.token.symbol());
    checks.owner=(await app.owner()).toLowerCase()===(await tl.getAddress()).toLowerCase();
    checks.delegate=(await ep.delegates(target)).toLowerCase()===(await tl.getAddress()).toLowerCase();
    checks.sendLibrary=(await ep.getSendLibrary(target,remoteEid)).toLowerCase()===route.sendLibrary.toLowerCase() && !(await ep.isDefaultSendLibrary(target,remoteEid));
    const receive=await ep.getReceiveLibrary(target,remoteEid);
    checks.receiveLibrary=receive[0].toLowerCase()===route.receiveLibrary.toLowerCase() && !receive[1];
    for(const [name,stepKey] of [['sendDVN','sendDVN'],['receiveDVN','receiveDVN'],['executor','executor']]){
      const step=steps.find(x=>x.key===stepKey),args=epIface.decodeFunctionData('setConfig',step.data);
      const stored=await ep.getConfig(target,args[1],remoteEid,args[2][0].configType);
      if(name==='executor')checks[name]=stored.toLowerCase()===args[2][0].config.toLowerCase();
      else{
        const actual=coder.decode([ulnType],stored)[0],expected=coder.decode([ulnType],args[2][0].config)[0];
        checks[name]=actual.confirmations===expected.confirmations&&actual.requiredDVNCount===2n&&actual.optionalDVNCount===0n&&actual.optionalDVNThreshold===0n&&actual.optionalDVNs.length===0&&actual.requiredDVNs.length===2&&actual.requiredDVNs.every((x,i)=>x.toLowerCase()===expected.requiredDVNs[i].toLowerCase());
      }
    }
    checks.options=(await app.enforcedOptions(remoteEid,1))==='0x';
    checks.inspector=(await app.msgInspector())==='0x0000000000000000000000000000000000000000';
    checks.paused=key==='bsc'?await app.depositsPaused()&&await app.receivesPaused():await app.sendsPaused()&&await app.receivesPaused();
    const options='0x000301001101'+BigInt(200000).toString(16).padStart(32,'0');
    const quote=await app.quoteSend([remoteEid,zeroPadValue(await owners[0].getAddress(),32),10n**12n,10n**12n,options,'0x','0x'],false);
    checks.messageQuote=quote.nativeFee>0n&&quote.lzTokenFee===0n;
    r.configuration=checks;
    if(!Object.values(checks).every(Boolean))throw new Error('CONFIGURATION_MISMATCH');
    {
      r.stage='replace Safe owner';
      const before=await safe.safe.getOwners(),replacement=await provider.getSigner(5),newAddress=await replacement.getAddress();
      const swap=safe.safe.interface.encodeFunctionData('swapOwner',['0x0000000000000000000000000000000000000001',before[0],newAddress]);
      await safe.execute(safe.address,swap,[owners[0],owners[1]]);
      const after=await safe.safe.getOwners();
      r.safeOwnerReplacementVerified=after.includes(newAddress)&&!after.includes(before[0])&&(await safe.safe.getThreshold())===2n;
      if(!r.safeOwnerReplacementVerified)throw new Error('SAFE_OWNER_REPLACEMENT_FAILED');
      const probe=tl.interface.encodeFunctionData('getMinDelay');
      const retained=(await Promise.all(owners.map(async signer=>({signer,address:await signer.getAddress()})))).find(x=>x.address.toLowerCase()!==before[0].toLowerCase());
      await safe.execute(await tl.getAddress(),probe,[retained.signer,replacement]);
      r.replacementSignerExecuted=true;
    }
    r.stage='complete';
    r.passed=!!(r.safeOwnerReplacementVerified&&r.replacementSignerExecuted);
    if(!r.passed)throw new Error('CONFIGURATION_MISMATCH');
  }
}catch(e){
  result.failed=true;
  const affected=result.chains[activeKey];if(affected){affected.passed=false;affected.error='LOCAL_FORK_CHECK_FAILED';affected.errorCode=typeof e.message==='string'&&/^[A-Z_0-9a-fx]+$/.test(e.message)?e.message:(typeof e.code==='string'&&/^[A-Z_]+$/.test(e.code)?e.code:'UNCLASSIFIED');}
  console.log('Fork check failed; provider details omitted.');
}finally{for(const local of connections)await local.close();}
result.passed=!result.failed&&Object.keys(chains).every(key=>result.chains[key]?.passed===true);
await mkdir('research/production',{recursive:true});await writeFile('research/production/channel-fork.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
