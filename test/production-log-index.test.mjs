import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {openLogIndex} from '../scripts/production-log-index.mjs';
async function fixture(fn){
 const dir=await mkdtemp(join(tmpdir(),'tevumi-index-')),path=join(dir,'index.json');
 try{await fn(path);}finally{for(const file of [path,path+'.tmp'])try{await unlink(file);}catch(e){if(e.code!=='ENOENT')throw e;}await rmdir(dir);}
}
const filter=(fromBlock,toBlock)=>({address:'0x'+'12'.repeat(20),fromBlock,toBlock,topics:[['0x01']]});
function provider(){
 let branch='a',calls=0,fail=false;
 return {getBlock:async n=>({hash:branch+n}),getLogs:async f=>{calls++;if(fail)throw new Error('RPC_FAILURE');return [{address:f.address,blockNumber:f.fromBlock,blockHash:branch+f.fromBlock,transactionHash:branch,transactionIndex:0,index:0,data:'0x',topics:['0x01'],removed:false}];},get calls(){return calls;},set branch(x){branch=x;},set fail(x){fail=x;}};
}
test('restart reuses completed chunks and only requests new ranges',()=>fixture(async path=>{
 const p=provider();let index=await openLogIndex(path,'pair');
 await index.readLogs(p,filter(1,5),56);await index.readLogs(p,filter(6,10),56);assert.equal(p.calls,2);
 index=await openLogIndex(path,'pair');await index.readLogs(p,filter(1,5),56);await index.readLogs(p,filter(6,10),56);await index.readLogs(p,filter(11,15),56);
 assert.equal(p.calls,3);assert.equal(index.stats.reusedChunks,2);
}));
test('RPC interruption preserves completed chunks without advancing failed chunk',()=>fixture(async path=>{
 const p=provider(),index=await openLogIndex(path,'pair');await index.readLogs(p,filter(1,5),56);
 p.fail=true;await assert.rejects(index.readLogs(p,filter(6,10),56),/RPC_FAILURE/);
 assert.equal(JSON.parse(await readFile(path,'utf8')).chunks.length,1);
 p.fail=false;const resumed=await openLogIndex(path,'pair');await resumed.readLogs(p,filter(1,5),56);await resumed.readLogs(p,filter(6,10),56);assert.equal(resumed.stats.reusedChunks,1);
}));
test('changed block hash discards orphaned chunk and descendants, preserving another chain',()=>fixture(async path=>{
 const p=provider(),index=await openLogIndex(path,'pair');
 await index.readLogs(p,filter(1,5),56);await index.readLogs(p,filter(6,10),56);await index.readLogs(p,filter(1,5),5042);
 p.branch='b';const logs=await index.readLogs(p,filter(1,5),56);assert.equal(logs[0].transactionHash,'b');assert.equal(index.stats.discardedChunks,2);
 const saved=JSON.parse(await readFile(path,'utf8'));assert.equal(saved.chunks.length,2);
}));
test('tail extension and shorter confirmed boundary are re-read without using future logs',()=>fixture(async path=>{
 const p=provider(),index=await openLogIndex(path,'pair');await index.readLogs(p,filter(1,3),56);await index.readLogs(p,filter(1,5),56);await index.readLogs(p,filter(1,2),56);
 assert.equal(p.calls,3);assert.equal(JSON.parse(await readFile(path,'utf8')).chunks[0].to,2);
}));
test('corrupt checkpoint and wrong asset/version scope fail closed',()=>fixture(async path=>{
 const index=await openLogIndex(path,'pair');await index.readLogs(provider(),filter(1,5),56);
 await assert.rejects(openLogIndex(path,'different-pair'),/INDEX_SCOPE_MISMATCH/);
 const saved=JSON.parse(await readFile(path,'utf8'));saved.chunks[0].logs=[];await writeFile(path,JSON.stringify(saved));
 await assert.rejects(openLogIndex(path,'pair'),/CORRUPT_INDEX/);
}));
test('reorg during fetching never commits a chunk',()=>fixture(async path=>{
 const p=provider(),index=await openLogIndex(path,'pair');const fetch=p.getLogs;p.getLogs=async f=>{const logs=await fetch(f);p.branch='changed';return logs;};
 await assert.rejects(index.readLogs(p,filter(1,5),56),/REORG_DURING_INDEX/);
 await assert.rejects(readFile(path),e=>e.code==='ENOENT');
}));
test('index-only CLI failure preserves prior snapshot, releases lock and never emits policy secrets',()=>fixture(async path=>{
 const address='0x'+'12'.repeat(20),side={chainId:56,app:address,deploymentBlock:1,confirmations:1,maxBlockAgeSeconds:100,rpcEnv:'TEVUMI_INDEX_TEST_MISSING'};
 await writeFile(path,JSON.stringify({sourceToken:address,chunkSize:10,bsc:side,arc:{...side,chainId:5042},extraSecret:'must-not-leak'}));
 const output=path+'.snapshot';await writeFile(output,'old-snapshot');
 try{
  const env={...process.env};delete env.TEVUMI_INDEX_TEST_MISSING;
  const result=spawnSync(process.execPath,['scripts/production-index-scan.mjs',path,output],{env,encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/RPC_ENV_MISSING/);assert.equal(result.stderr.includes('must-not-leak'),false);
  assert.equal(await readFile(output,'utf8'),'old-snapshot');await assert.rejects(readFile(output+'.lock'),e=>e.code==='ENOENT');
  const collision=spawnSync(process.execPath,['scripts/production-index-scan.mjs',path,path],{env,encoding:'utf8'});assert.equal(collision.status,1);assert.match(collision.stderr,/PATH_COLLISION/);
 }finally{await unlink(output);}
}));
