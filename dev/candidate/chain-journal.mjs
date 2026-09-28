import {createHash} from 'node:crypto';
import {open,readFile} from 'node:fs/promises';
import {join} from 'node:path';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const journalPath=directory=>join(directory,'chain-journal.jsonl');

export async function readJournal(directory){
 let raw;try{raw=await readFile(journalPath(directory),'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(raw&&!raw.endsWith('\n'))throw new Error('本地链日志尾部不完整，已停止恢复。');
 const entries=[];let previous='0'.repeat(64),pending=null,sequence=0;
 for(const line of raw.split('\n').filter(Boolean)){
  let entry;try{entry=JSON.parse(line);}catch{throw new Error('本地链日志损坏，已停止恢复。');}
  const {checksum,...content}=entry;
  if(content.version!==1||content.previous!==previous||checksum!==hash(content)||content.sequence!==sequence)throw new Error('本地链日志校验失败，已停止恢复。');
  if(content.type==='intent'){
   if(pending||!['bsc','arc'].includes(content.side)||!['eth_sendTransaction','eth_sendRawTransaction','hardhat_setNextBlockBaseFeePerGas','evm_mine'].includes(content.method)||!Array.isArray(content.params))throw new Error('本地链日志顺序错误，已停止恢复。');
   pending=entry;
  }else if(content.type==='outcome'||content.type==='abandoned'){
   if(!pending||content.intentChecksum!==pending.checksum)throw new Error('本地链日志顺序错误，已停止恢复。');
   if(content.type==='outcome'&&(!content.block||typeof content.block.number!=='string'||typeof content.block.stateRoot!=='string'||typeof content.block.timestamp!=='string'))throw new Error('本地链日志结果损坏，已停止恢复。');
   pending=null;
  }else throw new Error('本地链日志类型未知，已停止恢复。');
  entries.push(entry);previous=checksum;sequence++;
 }
 return {entries,previous,sequence,pending};
}

export async function openJournal(directory){
 const path=journalPath(directory);let parsed=await readJournal(directory);
 if(!parsed){const file=await open(path,'wx');try{await file.sync();}finally{await file.close();}parsed=await readJournal(directory);}
 let {previous,sequence}=parsed;
 return {parsed,async append(type,data){
  const content={version:1,sequence,previous,type,...data},checksum=hash(content),entry={...content,checksum};
  const file=await open(path,'a');try{await file.writeFile(JSON.stringify(entry)+'\n');await file.sync();}finally{await file.close();}
  previous=checksum;sequence++;return entry;
 }};
}
