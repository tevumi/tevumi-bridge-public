// A local, rebuildable RPC log cache; not a source of chain truth.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fields=['address','blockNumber','blockHash','transactionHash','transactionIndex','index','data','topics','removed'];
export async function openLogIndex(path,scope){
 let state={version:1,scope,chunks:[]};
 try{
  const saved=JSON.parse(await readFile(path,'utf8'));
  if(saved.version!==1||!Array.isArray(saved.chunks)||saved.digest!==digest({version:saved.version,scope:saved.scope,chunks:saved.chunks}))throw new Error('CORRUPT_INDEX');
  if(saved.scope!==scope)throw new Error('INDEX_SCOPE_MISMATCH');
  state={version:1,scope,chunks:saved.chunks};
 }catch(e){if(e.code!=='ENOENT')throw new Error(e.message==='INDEX_SCOPE_MISMATCH'?'INDEX_SCOPE_MISMATCH':'CORRUPT_INDEX');}
 const stats={reusedChunks:0,fetchedChunks:0,discardedChunks:0};
 const save=async()=>{await mkdir(dirname(path),{recursive:true});await writeFile(path+'.tmp',JSON.stringify({...state,digest:digest(state)})+'\n');await rename(path+'.tmp',path);};
 return {stats,async readLogs(provider,filter,chainId){
  const {fromBlock:from,toBlock:to,address,topics}=filter;
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from>to)throw new Error('INVALID_INDEX_RANGE');
  const stream=JSON.stringify([String(chainId),address.toLowerCase(),topics]);
  const before=await provider.getBlock(to);if(!before)throw new Error('INDEX_BLOCK_MISSING');
  const old=state.chunks.find(c=>c.stream===stream&&c.from===from);
  if(old&&old.to===to&&old.hash===before.hash){stats.reusedChunks++;return structuredClone(old.logs);}
  // Changed hash, shrinking head, extended tail or changed chunk size: discard overlap and descendants.
  const kept=state.chunks.filter(c=>c.stream!==stream||c.to<from);
  stats.discardedChunks+=state.chunks.length-kept.length;
  if(kept.length!==state.chunks.length){state.chunks=kept;await save();}
  const raw=await provider.getLogs(filter),logs=[];
  for(const log of raw){
   if(log.removed||log.address.toLowerCase()!==address.toLowerCase()||log.blockNumber<from||log.blockNumber>to)throw new Error('INVALID_INDEX_LOG');
   logs.push(Object.fromEntries(fields.map(k=>[k,log[k]])));
  }
  if((await provider.getBlock(to))?.hash!==before.hash)throw new Error('REORG_DURING_INDEX');
  state.chunks.push({stream,from,to,hash:before.hash,logs});await save();stats.fetchedChunks++;
  return structuredClone(logs);
 }};
}
