// Publishes only public, unsigned deployment data. Never handles a private key.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {keccak256,getCreateAddress} from 'ethers';

const base='research/production/public-beta-unsigned/';
const plan=JSON.parse(await readFile(base+'manifest.json','utf8'));
const readiness=JSON.parse(await readFile(base+'readiness.json','utf8'));
const policy=JSON.parse(await readFile('research/production/public-beta-preparation/proposed-policy.json','utf8'));
if(plan.status!=='UNSIGNED_PAUSED_CANDIDATE'||plan.governanceMode!=='direct-eoa'||plan.deployments.length!==6||readiness.status!=='READ_ONLY_READY_TO_REQUEST_SIGNATURES')throw Error('RELEASE_NOT_READY');
for(const side of ['bsc','arc']){
 const items=plan.deployments.filter(x=>x.side===side),start=policy[side].startNonce;
 if(items.length!==3||readiness.chains[side].nonce!==start)throw Error('NONCE_MISMATCH_'+side);
 for(const [i,item] of items.entries())if(item.transaction.nonce!==start+i||item.transaction.from!==policy[side].deployer||getCreateAddress({from:item.transaction.from,nonce:start+i})!==item.predictedAddress)throw Error('DEPLOYMENT_MISMATCH_'+side);
}
const output={releaseId:plan.releaseId,preparedAt:plan.preparedAt,sourceInputHash:plan.sourceInputHash,account:policy.bsc.deployer,limits:{perSend:'0.000001',burst:'0.000010',window:'0.000100',capacity:'0.000100'},chains:Object.fromEntries(['bsc','arc'].map(side=>[side,{chainId:side==='bsc'?56:5042,startNonce:policy[side].startNonce,head:readiness.chains[side],deployments:plan.deployments.filter(x=>x.side===side).map(item=>({id:item.id,contract:item.contract,assetId:item.assetId,predictedAddress:item.predictedAddress,creationDataHash:keccak256(item.transaction.data),transaction:item.transaction}))}]))};
await mkdir('web/beta-deploy/public',{recursive:true});
await writeFile('web/beta-deploy/public/plan.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({status:'UNSIGNED_SIGNING_PAGE_PREPARED',releaseId:output.releaseId,deployments:6,output:'web/beta-deploy/public/plan.json'}));
