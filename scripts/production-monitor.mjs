// Read-only full rebuild. No signer, wallet, broadcast, automatic pause or external notification.
import {Contract,Interface,JsonRpcProvider,FetchRequest,isAddress} from 'ethers';
import {readFile,writeFile,rename,mkdir,open,unlink} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {reconcile,alertTransitions} from './production-reconcile.mjs';
const abi=[
 'event OFTSent(bytes32 indexed guid,uint32 dstEid,address indexed fromAddress,uint256 amountSentLD,uint256 amountReceivedLD)',
 'event OFTReceived(bytes32 indexed guid,uint32 srcEid,address indexed toAddress,uint256 amountReceivedLD)',
 'function principalLD() view returns(uint256)','function totalSupply() view returns(uint256)',
 'function token() view returns(address)','function sourceToken() view returns(address)',
 'function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)'];
const iface=new Interface(abi);
export async function collectSnapshot(providers,policy,nowSeconds,index=null){
 const result={events:[],boundaries:{}};
 for(const side of ['bsc','arc']){
  const p=providers[side],c=policy[side];
  for(const field of ['chainId','deploymentBlock','confirmations','maxBlockAgeSeconds'])if(!Number.isSafeInteger(c[field])||c[field]<1)throw new Error('INVALID_POLICY');
  if((await p.getNetwork()).chainId!==BigInt(c.chainId))throw new Error('WRONG_CHAIN');
  const end=await p.getBlockNumber()-c.confirmations;if(end<c.deploymentBlock)throw new Error('NO_CONFIRMED_HISTORY');
  const block=await p.getBlock(end);if(!block||nowSeconds-block.timestamp>c.maxBlockAgeSeconds||block.timestamp>nowSeconds)throw new Error('STALE_OR_INVALID_BLOCK');
  // Reject a late starting point; nonzero state at the previous block cannot be hidden.
  if(await p.getCode(c.app,c.deploymentBlock-1)!=='0x'||await p.getCode(c.app,c.deploymentBlock)==='0x')throw new Error('INVALID_DEPLOYMENT_BOUNDARY');
  const app=new Contract(c.app,abi,p),token=new Contract(policy.sourceToken,abi,providers.bsc);
  const at={blockTag:end};
  if(side==='bsc'){
   if((await app.token(at)).toLowerCase()!==policy.sourceToken.toLowerCase())throw new Error('WRONG_ASSET');
   if(await token.decimals(at)!==18n)throw new Error('WRONG_DECIMALS');
   result.principal=String(await app.principalLD(at));result.balance=String(await token.balanceOf(c.app,at));
  }else{
   if((await app.sourceToken(at)).toLowerCase()!==policy.sourceToken.toLowerCase()||await app.decimals(at)!==18n)throw new Error('WRONG_ASSET');
   result.supply=String(await app.totalSupply(at));
  }
  const size=policy.chunkSize;if(!Number.isSafeInteger(size)||size<1||size>5000)throw new Error('INVALID_CHUNK');
  const headers=new Map();
  for(let from=c.deploymentBlock;from<=end;from+=size){
   const filter={address:c.app,fromBlock:from,toBlock:Math.min(end,from+size-1),topics:[[iface.getEvent('OFTSent').topicHash,iface.getEvent('OFTReceived').topicHash]]};
   const logs=index?await index.readLogs(p,filter,c.chainId):await p.getLogs(filter);
   for(const log of logs){
    if(log.removed||log.address.toLowerCase()!==c.app.toLowerCase()||log.blockNumber<from||log.blockNumber>Math.min(end,from+size-1))throw new Error('INVALID_LOG');
    const e=iface.parseLog(log),sent=e.name==='OFTSent',expected=side==='bsc'?30417n:30102n;
    if((sent?e.args.dstEid:e.args.srcEid)!==expected)throw new Error('WRONG_ROUTE');
    if(sent&&e.args.amountSentLD!==e.args.amountReceivedLD)throw new Error('LOSSY_MESSAGE');
    if(!headers.has(log.blockNumber))headers.set(log.blockNumber,await p.getBlock(log.blockNumber));
    const h=headers.get(log.blockNumber);if(!h||h.hash!==log.blockHash)throw new Error('REORG_DURING_SCAN');
    result.events.push({side,kind:sent?'sent':'received',guid:e.args.guid,amount:String(e.args.amountReceivedLD),account:sent?e.args.fromAddress:e.args.toAddress,blockNumber:log.blockNumber,blockHash:log.blockHash,transactionHash:log.transactionHash,logIndex:log.index,timestamp:h.timestamp});
   }
  }
  result.boundaries[side]={number:end,hash:block.hash,timestamp:block.timestamp,app:c.app};
 }
 for(const side of ['bsc','arc'])if((await providers[side].getBlock(result.boundaries[side].number))?.hash!==result.boundaries[side].hash)throw new Error('REORG_DURING_SCAN');
 return result;
}

export async function writeReport(path,report){
 await mkdir(dirname(path),{recursive:true});const temp=path+'.tmp';
 await writeFile(temp,JSON.stringify(report,null,2)+'\n');await rename(temp,path);
}
async function main(){
 const policyPath=process.argv[2],output=process.argv[3];if(!policyPath||!output)throw new Error('USAGE: node --env-file=.env scripts/production-monitor.mjs policy.json report.json');
 if(resolve(policyPath)===resolve(output))throw new Error('OUTPUT_MUST_DIFFER');
 const policy=JSON.parse(await readFile(policyPath,'utf8'));
 if(!isAddress(policy.sourceToken)||!['bsc','arc'].every(s=>isAddress(policy[s]?.app)))throw new Error('INVALID_ADDRESS');
 await mkdir(dirname(output),{recursive:true});
 const lock=await open(output+'.lock','wx');
 try{await runMonitor(policy,output);}finally{await lock.close();await unlink(output+'.lock');}
}
async function runMonitor(policy,output){
 const providers={};let previous=null;
 // Persist only public identity fields, never arbitrary policy keys or RPC URLs.
 const scope=JSON.stringify([policy.sourceToken.toLowerCase(),...['bsc','arc'].map(s=>[policy[s].chainId,policy[s].app.toLowerCase(),policy[s].deploymentBlock])]);
 try{previous=JSON.parse(await readFile(output,'utf8'));if(previous.scope!==scope)previous=null;}catch(e){if(e.code!=='ENOENT')throw new Error('INVALID_PREVIOUS_REPORT');}
 const nowSeconds=Math.floor(Date.now()/1000);let report;
 try{
  for(const side of ['bsc','arc']){if(!/^[A-Z][A-Z0-9_]*$/.test(policy[side].rpcEnv))throw new Error('INVALID_RPC_ENV_NAME');const url=process.env[policy[side].rpcEnv];if(!url)throw new Error('RPC_ENV_MISSING');const req=new FetchRequest(url);req.timeout=20000;providers[side]=new JsonRpcProvider(req,undefined,{batchMaxCount:1,cacheTimeout:-1});}
  const snapshot=await collectSnapshot(providers,policy,nowSeconds);
  report={...reconcile(snapshot,{pendingSeconds:policy.pendingSeconds,nowSeconds}),snapshot};
 }catch(e){
  const code=/^[A-Z_]+$/.test(e.message??'')?e.message:'RPC_OR_SCAN_FAILURE';
  report={status:'unavailable',alerts:[{id:'SCAN_UNAVAILABLE:pair',code:'SCAN_UNAVAILABLE',severity:'critical',subject:'pair'}],failure:code};
 }finally{for(const p of Object.values(providers))p.destroy();}
 report.scope=scope;report.checkedAt=new Date().toISOString();
 // Failed scans cannot resolve previously observed financial/message alarms.
 if(report.status==='unavailable')report.alerts.push(...(previous?.alerts??[]).filter(x=>x.id!=='SCAN_UNAVAILABLE:pair'));
 if(report.status==='unavailable')report.lastSuccessfulSnapshot=previous?.snapshot??previous?.lastSuccessfulSnapshot??null;
 report.transitions=alertTransitions(previous,report);
 await writeReport(output,report);console.log(JSON.stringify({status:report.status,alerts:report.alerts,output}));
 if(report.status!=='ok')process.exitCode=2;
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Monitor setup/output failed; details omitted.');process.exitCode=1;});
