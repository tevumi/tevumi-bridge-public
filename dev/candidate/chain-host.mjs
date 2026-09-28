// Separate loopback-only local EVMs. Committed mutations can be replayed after process loss.
import {network} from 'hardhat';
import {createServer} from 'node:http';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openJournal} from './chain-journal.mjs';

const metadataPath=process.argv[2],settings=JSON.parse(await readFile(metadataPath,'utf8'));
const generation=randomUUID(),sides={};
for(const [side,chainId] of [['bsc',31337],['arc',31338]]){
 sides[side]=await network.create({network:'local',override:{chainId,initialDate:settings.initialDate,allowBlocksWithSameTimestamp:true}});
}
const allowed=new Set(['eth_accounts','eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode','eth_call','eth_estimateGas','eth_getBalance','eth_getTransactionCount','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getLogs','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_sendTransaction','eth_sendRawTransaction','hardhat_setNextBlockBaseFeePerGas','evm_mine']);
const mutating=new Set(['eth_sendTransaction','eth_sendRawTransaction','hardhat_setNextBlockBaseFeePerGas','evm_mine']);
const journal=settings.journalVersion===1?await openJournal(dirname(metadataPath)):null;
let poisoned=false,queue=Promise.resolve();
const block=side=>sides[side].provider.request({method:'eth_getBlockByNumber',params:['latest',false]});

async function execute(side,method,params){
 try{return {result:await sides[side].provider.request({method,params})};}
 catch(error){return {error:{code:typeof error.code==='number'?error.code:-32000,message:'Local EVM request failed',data:typeof error.data==='string'&&/^0x[\da-f]*$/i.test(error.data)?error.data:undefined}};}
}

if(journal){
 let pending=null;
 for(const entry of journal.parsed.entries){
  if(entry.type==='intent'){pending=entry;continue;}
  if(entry.type==='abandoned'){pending=null;continue;}
  const side=pending.side,provider=sides[side].provider,tip=await block(side);
  if(BigInt(entry.block.number)>BigInt(tip.number))await provider.request({method:'evm_setNextBlockTimestamp',params:[Number(BigInt(entry.block.timestamp))]});
  const outcome=await execute(side,pending.method,pending.params),actual=await block(side);
  if(JSON.stringify(outcome)!==JSON.stringify(entry.outcome)||actual.number!==entry.block.number||actual.stateRoot!==entry.block.stateRoot||actual.timestamp!==entry.block.timestamp||actual.hash!==entry.block.hash){
   throw new Error('本地链日志重放结果不一致，已停止恢复。');
  }
  pending=null;
 }
 if(pending)await journal.append('abandoned',{intentChecksum:pending.checksum});
}

const server=createServer((req,res)=>{
 const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(req.headers.authorization!=='Bearer '+settings.token||req.headers.origin){json(403,{error:'denied'});return;}
 if(req.method==='GET'&&req.url==='/identity'){json(200,{epoch:settings.epoch,generation,rpcVersion:2});return;}
 if(req.method==='POST'&&req.url==='/shutdown'){queue=queue.then(()=>{json(200,{ok:true});setTimeout(()=>process.exit(0),50);});return;}
 const run=async()=>{
  if(poisoned){json(503,{error:'chain journal unavailable'});return;}
  try{
   let text='';for await(const chunk of req){text+=chunk;if(text.length>2000000)throw Error();}
   const {side,method,params=[]}=JSON.parse(text);if(!sides[side]||!allowed.has(method)||!Array.isArray(params))throw Error();
   if(!mutating.has(method)){json(200,await execute(side,method,params));return;}
   const intent=await journal?.append('intent',{side,method,params});
   const outcome=await execute(side,method,params),latest=await block(side);
   await journal?.append('outcome',{intentChecksum:intent.checksum,outcome,block:{number:latest.number,hash:latest.hash,stateRoot:latest.stateRoot,timestamp:latest.timestamp}});
   json(200,outcome);
  }catch{poisoned=true;json(503,{error:'chain journal unavailable'});server.close(()=>process.exit(1));}
 };
 queue=queue.then(run,run);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
await writeFile(metadataPath+'.tmp',JSON.stringify({...settings,port:server.address().port,pid:process.pid,generation}));
await rename(metadataPath+'.tmp',metadataPath);
