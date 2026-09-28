import {mkdir,readFile,writeFile,rename,realpath,open,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {openStore} from './store.mjs';
import {createCandidateRuntime} from './runtime.mjs';
import {readJournal} from './chain-journal.mjs';
export async function connectLocalChains(directory,{recover=true,hasState=true}={}){
 directory=resolve(directory);
 await mkdir(directory,{recursive:true});const file=join(directory,'host.json');let meta;
 try{meta=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('本地链身份文件损坏，请保留目录并核查。');}
 const startHost=()=>{const child=spawn(process.execPath,[resolve('dev/candidate/chain-host.mjs'),file],{cwd:process.cwd(),detached:true,windowsHide:true,stdio:'ignore'});child.on('error',()=>{});child.unref();};
 const waitForHost=async previousGeneration=>{
  for(let i=0;i<150;i++){
   await new Promise(r=>setTimeout(r,100));
   try{const updated=JSON.parse(await readFile(file,'utf8'));if(!updated.port||updated.generation===previousGeneration)continue;meta=updated;const identity=await request('/identity',undefined,500);if(identity.epoch===meta.epoch&&identity.generation===meta.generation)return identity;}catch{}
  }
  throw new Error('本地链日志无法重放，已停止操作；请保留日志核查。');
 };
 async function request(path,body,timeout=10000){
  try{const r=await fetch('http://127.0.0.1:'+meta.port+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+meta.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout)});if(!r.ok)throw Error();return await r.json();}
  catch{throw new Error('原本地链不可用，已停止操作；不能把旧记录接到新链。');}
 }
 if(!meta){
  meta={token:randomUUID(),epoch:randomUUID(),initialDate:new Date().toISOString(),journalVersion:1};await writeFile(file,JSON.stringify(meta),{flag:'wx'});
  startHost();await waitForHost(undefined);
 }else{
  let live=false,oldRpc=false;try{const identity=await request('/identity',undefined,1500);live=identity.epoch===meta.epoch&&(!meta.generation||identity.generation===meta.generation);oldRpc=live&&identity.rpcVersion!==2;}catch{}
  if(oldRpc){await request('/shutdown',{});await new Promise(r=>setTimeout(r,150));live=false;}
  if(!live){
   if(!recover||meta.journalVersion!==1||!hasState)throw new Error('原本地链不可用，已停止操作；不能把旧记录接到新链。');
   const lock=join(directory,'restart.lock');let handle;
   try{
    handle=await open(lock,'wx');await handle.writeFile(String(process.pid));await handle.sync();
    const parsed=await readJournal(directory);if(!parsed)throw new Error('本地链日志缺失，已停止恢复。');
    const previousGeneration=meta.generation;startHost();await waitForHost(previousGeneration);
   }finally{if(handle){await handle.close();await unlink(lock).catch(()=>{});}}
  }
 }
 const identity=await request('/identity');if(identity.epoch!==meta.epoch||meta.generation&&identity.generation!==meta.generation)throw new Error('本地链身份不匹配，已停止操作。');
 return {epoch:identity.epoch,async makeSide(side){return {provider:{request:async body=>{const r=await request('/',{side,...body});if(r.error)throw Object.assign(new Error(r.error.message),r.error);return r.result;}},close:async()=>{}};},async stop(){await request('/shutdown',{});for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,50));try{await request('/identity',undefined,200);}catch{return;}}throw new Error('本地链尚未停止，不能重建。');}};
}
export async function createPersistentRuntime(directory=resolve('.local/candidate')){
 const store=await openStore(directory),chains=await connectLocalChains(directory,{hasState:store.loaded!==null});
 return createCandidateRuntime({store,chains});
}
export async function archiveCandidate(directory=resolve('.local/candidate')){
 directory=resolve(directory);const root=resolve('.local')+ '/';
 if(!directory.replaceAll('\\','/').toLowerCase().startsWith(root.replaceAll('\\','/').toLowerCase()))throw new Error('重建路径必须位于项目 .local 目录内。');
 let actual;try{actual=await realpath(directory);}catch(e){if(e.code==='ENOENT')return;throw e;}
 const actualRoot=(await realpath(resolve('.local'))).replaceAll('\\','/').toLowerCase()+'/';
 if(!actual.replaceAll('\\','/').toLowerCase().startsWith(actualRoot))throw new Error('重建路径越出本地测试目录，已停止。');
 let chains;try{await readFile(join(directory,'host.json'));chains=await connectLocalChains(directory,{recover:false});}catch{}
 if(chains)await chains.stop();
 const archived=directory+'.archive-'+Date.now()+'-'+randomUUID();await rename(directory,archived);return archived;
}
