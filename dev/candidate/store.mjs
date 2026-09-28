import {mkdir,readFile,open,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const digest=text=>createHash('sha256').update(text).digest('hex');
export async function openStore(directory){
 await mkdir(directory,{recursive:true});const file=join(directory,'state.json'),lock=join(directory,'write.lock');let revision=null,poisoned=false;
 async function read(){try{
  const envelope=JSON.parse(await readFile(file,'utf8'));
  if(envelope.version!==1||typeof envelope.payload!=='string'||digest(envelope.payload)!==envelope.checksum)throw Error();
  const value=JSON.parse(envelope.payload);return {value,checksum:envelope.checksum};
 }catch(e){if(e.code==='ENOENT')return null;throw new Error('本地记录损坏，已停止操作；请保留文件并恢复备份。');}}
 const loaded=await read();revision=loaded?.checksum??null;
 return {loaded:loaded?.value??null,async save(value){
  if(poisoned)throw new Error('本地存储已锁定，请核查文件后重启服务。');
  let handle,temp;try{
   handle=await open(lock,'wx');await handle.writeFile(String(process.pid));await handle.sync();
   const current=await read();if((current?.checksum??null)!==revision)throw new Error('本地记录被另一进程修改，已停止操作。');
   const payload=JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v),checksum=digest(payload);
   temp=join(directory,'state.'+randomUUID()+'.tmp');const out=await open(temp,'wx');
   try{await out.writeFile(JSON.stringify({version:1,checksum,payload})+'\n');await out.sync();}finally{await out.close();}
   await rename(temp,file);temp=undefined;revision=checksum;
  }catch{poisoned=true;throw new Error('本地记录写入失败，已停止操作；请核验存储后重启。');}
  finally{if(temp)await unlink(temp).catch(()=>{});if(handle){await handle.close();await unlink(lock).catch(()=>{});}}
 }};
}
