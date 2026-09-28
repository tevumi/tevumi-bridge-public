// Index only: no alert evaluation, notification, scheduling or transaction signing.
import {readFile,mkdir,open,unlink} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {JsonRpcProvider,FetchRequest,isAddress} from 'ethers';
import {collectSnapshot,writeReport} from './production-monitor.mjs';
import {openLogIndex} from './production-log-index.mjs';
const providers={};let lock,output;
try{
 const policyPath=process.argv[2];output=process.argv[3];
 if(!policyPath||!output)throw new Error('USAGE_POLICY_AND_OUTPUT_REQUIRED');
 const paths=[policyPath,output,output+'.index.json',output+'.lock',output+'.tmp',output+'.index.json.tmp'].map(p=>resolve(p).toLowerCase());
 if(new Set(paths).size!==paths.length)throw new Error('PATH_COLLISION');
 const policy=JSON.parse(await readFile(policyPath,'utf8'));
 if(!isAddress(policy.sourceToken)||!['bsc','arc'].every(s=>isAddress(policy[s]?.app)))throw new Error('INVALID_ADDRESS');
 await mkdir(dirname(output),{recursive:true});lock=await open(output+'.lock','wx');
 const scope=JSON.stringify([policy.sourceToken.toLowerCase(),...['bsc','arc'].map(s=>[policy[s].chainId,policy[s].app.toLowerCase(),policy[s].deploymentBlock])]);
 const index=await openLogIndex(output+'.index.json',scope);
 for(const side of ['bsc','arc']){
  const name=policy[side].rpcEnv;if(!/^[A-Z][A-Z0-9_]*$/.test(name)||!process.env[name])throw new Error('RPC_ENV_MISSING');
  const req=new FetchRequest(process.env[name]);req.timeout=20000;
  providers[side]=new JsonRpcProvider(req,undefined,{batchMaxCount:1,cacheTimeout:-1});
 }
 const snapshot=await collectSnapshot(providers,policy,Math.floor(Date.now()/1000),index);
 await writeReport(output,{checkedAt:new Date().toISOString(),scope,snapshot,indexStats:index.stats});
 console.log(JSON.stringify({status:'indexed',...index.stats}));
}catch(e){
 console.error(JSON.stringify({status:'failed',code:/^[A-Z_]+$/.test(e.message??'')?e.message:'INDEX_SCAN_FAILED'}));process.exitCode=1;
}finally{
 for(const p of Object.values(providers))p.destroy();
 if(lock){await lock.close();await unlink(output+'.lock');}
}
