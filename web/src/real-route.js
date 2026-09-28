import legacyDeployments from '../../config/real-deployments-legacy.json' with {type:'json'};
import {keccak256} from 'ethers';
import deployments from '../../config/real-deployments.json' with {type:'json'};
import {verifyRealDeployment,tester,checkSourceMetadata,realDeployment} from './real-deployment.js';
import {chains} from './pilot.js';
import {inspectConfiguration,configurationSteps,verifyOperation} from './bridge.js';

export {deployments};
export function pairFor(assetId,records=deployments){
 const pair={};for(const id of [56,5042]){const matches=records.filter(r=>r.assetId===assetId&&r.chainId===id);if(matches.length!==1)throw Error('资产部署映射不完整或重复。');pair[id]=matches[0];}
 if(pair[56].sourceToken!==pair[5042].sourceToken)throw Error('两侧原币身份不一致。');
 return pair;
}
export async function inspectRealPair(assetId,rpc,records=deployments){
 const pair=pairFor(assetId,records),snapshots={};
 await Promise.all([56,5042].map(async id=>{
  const r=pair[id],remote=pair[id===56?5042:56],provider=rpc(id);
  const [verified]=await Promise.all([
   verifyRealDeployment(r,provider),
   r.kind==='RestrictedAssetOFTV2'?realDeployment(r.assetId,r.kind).then(plan=>checkSourceMetadata(plan,rpc(56))):null,
  ]);
  if(verified.status!=='confirmed'||verified.address.toLowerCase()!==r.address.toLowerCase())throw Error('真实资产部署尚未通过核验。');
  // verifyRealDeployment already checks sourceToken at the verified receipt address.
  snapshots[id]=await inspectConfiguration(provider,id,chains[id],r.address,remote.address,tester,id===56?r.sourceToken:r.address,'0.000001','0.000010');
 }));
 return snapshots;
}
function assertConfig(record,records){
 const pair=pairFor(record.assetId,records),r=pair[record.chainId],remote=pair[record.chainId===56?5042:56];
 if(!r||record.account!==tester||record.sourceToken!==r.sourceToken)throw Error('配置记录的资产或钱包身份不匹配。');
 const step=configurationSteps(record.chainId,chains[record.chainId],r.address,remote.address).find(s=>s.key===record.key);
 if(!step||step.to.toLowerCase()!==String(record.to).toLowerCase()||keccak256(step.data)!==keccak256(record.data)||record.value!=='0')throw Error('配置交易与该资产的固定通道不匹配。');
 return step;
}
export async function verifyRealConfig(record,rpc){assertRealConfigRecord(record);return verifyOperation(record,rpc);}

export function assertRealConfigRecord(record,records=deployments){
 try{return assertConfig(record,records);}catch(error){if(records!==deployments)throw error;return assertConfig(record,legacyDeployments);}
}
