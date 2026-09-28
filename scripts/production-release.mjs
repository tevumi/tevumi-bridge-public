// Offline planning only. No provider or signer is created here.
import {ContractFactory,Interface,getCreateAddress,isAddress,ZeroAddress,ZeroHash,keccak256,toUtf8Bytes} from 'ethers';
import {configurationSteps} from '../web/src/bridge.js';
import {routes} from '../web/src/routes.js';
const U=10n**12n,MAX=(1n<<64n)-1n;
const address=x=>typeof x==='string'&&isAddress(x)&&x.toLowerCase()!==ZeroAddress;
const integer=x=>typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x);
export function validateReleasePolicy(policy,assets){
 const issues=[];const check=(ok,path)=>{if(!ok)issues.push(path);};
 check(typeof policy.releaseId==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(policy.releaseId),'releaseId');
 const immediate=policy.governanceMode==='immediate-eoa';
 check(Number.isSafeInteger(policy.delaySeconds)&&(immediate?policy.delaySeconds===0:policy.delaySeconds>=86400),'delaySeconds');
 const direct=policy.governanceMode==='direct-eoa';
 check(policy.governanceMode===undefined||policy.governanceMode==='safe'||direct||immediate,'governanceMode');
 for(const side of ['bsc','arc']){
  const c=policy[side]??{};for(const key of ['deployer',direct||immediate?'governor':'safe','guardian'])check(address(c[key]),side+'.'+key);
  check(Number.isSafeInteger(c.startNonce)&&c.startNonce>=0&&c.startNonce<Number.MAX_SAFE_INTEGER-3,side+'.startNonce');
  if(!direct&&!immediate){
   check(c.threshold===2,side+'.threshold');
   check(Array.isArray(c.owners)&&c.owners.length===3&&c.owners.every(address)&&new Set(c.owners.map(x=>x.toLowerCase())).size===3,side+'.owners');
  }
 }
 const parsed={};
 for(const asset of assets){
  const c=policy.assets?.[asset.id]??{},prefix='assets.'+asset.id;parsed[asset.id]={};
  check(integer(c.capacityLD)&&BigInt(c.capacityLD)>0n&&BigInt(c.capacityLD)%U===0n&&BigInt(c.capacityLD)/U<=MAX,prefix+'.capacityLD');
  for(const side of ['bsc','arc'])for(const dir of ['outbound','inbound']){
   const v=c[side]?.[dir],key=side+'.'+dir;
   const valid=Array.isArray(v)&&v.length===3&&v.every(integer)&&v.every(x=>BigInt(x)>0n&&BigInt(x)<=MAX)&&BigInt(v[0])<=BigInt(v[1])&&BigInt(v[1])<BigInt(v[2]);
   check(valid,prefix+'.'+key);if(valid)parsed[asset.id][key]=v.map(BigInt);
  }
  const v=parsed[asset.id];
  for(const [send,receive] of [['bsc.outbound','arc.inbound'],['arc.outbound','bsc.inbound']])if(v[send]&&v[receive]){
   const s=v[send],r=v[receive];check(r[0]>=s[0]&&r[1]>=s[1]&&r[2]-r[1]>=s[2]-s[1],prefix+'.'+receive+'.compatibility');
  }
  if(integer(c.capacityLD)&&v['bsc.outbound'])check(BigInt(c.capacityLD)>=v['bsc.outbound'][0]*U,prefix+'.capacityBelowSingle');
 }
 check(Object.keys(policy.assets??{}).length===assets.length,'assetSet');
 return {valid:issues.length===0,issues};
}
export async function prepareRelease(build,policy,net,assets){
 const validation=validateReleasePolicy(policy,assets);if(!validation.valid)throw new Error('INVALID_RELEASE_POLICY:'+validation.issues.join(','));
 const direct=policy.governanceMode==='direct-eoa',immediate=policy.governanceMode==='immediate-eoa';
 const deployments=[],governance={},apps={},configurations=[];
 const artifact=name=>build['contracts/production/'+name+'.sol'][name];
 const add=async(side,name,args,assetId,nonce)=>{
  const art=artifact(name),factory=new ContractFactory(art.abi,'0x'+art.evm.bytecode.object),tx=await factory.getDeployTransaction(...args);
  const predicted=getCreateAddress({from:policy[side].deployer,nonce});
  deployments.push({side,chainId:net[side].chainId,assetId,contract:name,source:'contracts/production/'+name+'.sol',predictedAddress:predicted,dependsOn:assetId?[side+':governance']:[],id:side+':'+(assetId??'governance'),
   constructorArgs:args,constructorArguments:factory.interface.encodeDeploy(args),creationBytecodeHash:keccak256('0x'+art.evm.bytecode.object),transaction:{chainId:net[side].chainId,from:policy[side].deployer,nonce,value:'0',data:tx.data}});
  return predicted;
 };
 for(const side of ['bsc','arc']){
  const c=policy[side];governance[side]=await add(side,immediate?'ImmediateAdmin':'BridgeTimelock',immediate?[c.governor]:[policy.delaySeconds,direct?c.governor:c.safe],null,c.startNonce);
  apps[side]={};let nonce=c.startNonce+1;
  for(const asset of assets){
   const limit=policy.assets[asset.id],common=[net[side].endpoint,governance[side],c.guardian];
   const args=side==='bsc'?[asset.sourceToken,...common,limit.capacityLD,limit.bsc.outbound,limit.bsc.inbound]:[asset.sourceName,asset.sourceSymbol,asset.sourceToken,...common,limit.arc.outbound,limit.arc.inbound];
   apps[side][asset.id]=await add(side,side==='bsc'?(immediate?'ImmediateAdapter':'GovernedAdapter'):(immediate?'ImmediateOFT':'GovernedOFT'),args,asset.id,nonce++);
  }
 }
 const tl=new Interface(artifact(immediate?'ImmediateAdmin':'BridgeTimelock').abi);
 for(const side of ['bsc','arc']){
  const other=side==='bsc'?'arc':'bsc',steps=assets.flatMap(asset=>configurationSteps(net[side].chainId,{...net[side],remote:net[other].eid},apps[side][asset.id],apps[other][asset.id]).map(step=>({...step,assetId:asset.id})));
  const targets=steps.map(x=>x.to),values=steps.map(()=>0),data=steps.map(x=>x.data),salt=keccak256(toUtf8Bytes(policy.releaseId+':'+side+':'+JSON.stringify(steps)));
  configurations.push({side,timelock:governance[side],proposer:direct||immediate?policy[side].governor:policy[side].safe,safe:direct||immediate?undefined:policy[side].safe,steps,salt,predecessor:ZeroHash,
   schedule:immediate?undefined:{to:governance[side],value:'0',data:tl.encodeFunctionData('scheduleBatch',[targets,values,data,ZeroHash,salt,policy.delaySeconds])},
   execute:{to:governance[side],value:'0',data:immediate?tl.encodeFunctionData('executeBatch',[targets,data]):tl.encodeFunctionData('executeBatch',[targets,values,data,ZeroHash,salt])},
   note:immediate?'Development-only immediate batch controlled by named EOA; no timelock.':direct?'Timelock schedule/execute use the named EOA; one compromised key controls configuration after the delay.':'Timelock calls must be executed THROUGH the verified Safe; not direct EOA transactions.'});
 }
 return {status:'UNSIGNED_PAUSED_CANDIDATE',releaseId:policy.releaseId,deployments,governance,apps,configurations,
  routesHash:keccak256(toUtf8Bytes(JSON.stringify(routes))),
  governanceMode:immediate?'immediate-eoa':direct?'direct-eoa':'safe',
  gates:['Independent audit and remediation',direct?'Named EOA custody, backup and single-key risk review':'Real Safe owners, threshold, modules/guard/fallback and custody review','Approved guardian, capacity and limits','Fresh route review and pinned on-chain identity checks','Current deployer nonce and address predictions','Exact constructor/runtime source verification','Post-deployment owner/delegate/roles/peer/config checks','Explicit separate approval and governance proposal to unpause'],
  limitations:['No fee quote or mainnet broadcast.','Predictions depend on EOA CREATE with the exact nonce sequence; Safe/factory deployment is a different scheme.','Route snapshot is a candidate, not independently approved production configuration.','Receive rate compatibility does not guarantee immediate delivery when messages arrive in bursts; retries may be required.','No unpause transaction is generated.']};
}
