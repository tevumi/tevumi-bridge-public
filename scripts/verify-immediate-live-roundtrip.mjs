import {readFileSync,writeFileSync} from 'node:fs';
import {Contract,FetchRequest,Interface,JsonRpcProvider,formatEther,zeroPadValue} from 'ethers';

const networks=JSON.parse(readFileSync('config/networks.json','utf8'));
const manifest=JSON.parse(readFileSync('research/production/immediate-beta-unsigned/manifest.json','utf8'));
const config=JSON.parse(readFileSync('research/production/immediate-beta-mainnet/config-verification.json','utf8'));
const preflight=JSON.parse(readFileSync('research/production/immediate-beta-mainnet/live-readiness.json','utf8'));
const account='0x489594537CB76aC256079D710B6E18498E1a5402';
const app={};
for(const row of manifest.deployments)if(row.assetId==='binancelife')app[row.side]=row.predictedAddress;
const cat={};
for(const row of manifest.deployments)if(row.assetId==='cat')cat[row.side]=row.predictedAddress;
const tokenAddress=manifest.deployments.find(row=>row.side==='bsc'&&row.assetId==='binancelife').constructorArgs[0];
const iface=new Interface([
 'event OFTSent(bytes32 indexed guid,uint32 dstEid,address indexed fromAddress,uint256 amountSentLD,uint256 amountReceivedLD)',
 'event OFTReceived(bytes32 indexed guid,uint32 srcEid,address indexed toAddress,uint256 amountReceivedLD)',
]);
const appAbi=['function depositsPaused() view returns(bool)','function sendsPaused() view returns(bool)','function receivesPaused() view returns(bool)','function principalLD() view returns(uint256)','function totalSupply() view returns(uint256)','function balanceOf(address) view returns(uint256)'];
const tokenAbi=['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)'];
const topic0=[iface.getEvent('OFTSent').topicHash,iface.getEvent('OFTReceived').topicHash];
const providers={};
for(const side of ['bsc','arc']){
 const url=process.env[networks[side].rpcEnv];if(!url)throw Error('MISSING_RPC_'+side.toUpperCase());
 const request=new FetchRequest(url);request.timeout=60000;
 providers[side]=new JsonRpcProvider(request,networks[side].chainId,{batchMaxCount:1,cacheTimeout:-1});
}
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const evidence={checkedAt:new Date().toISOString(),kind:'independent-read-only-mainnet-roundtrip',account,asset:'binancelife',amountLD:'1000000000000',sides:{},status:'INCOMPLETE'};
for(const side of ['bsc','arc']){
 const provider=providers[side],start=config.chains[side].blockNumber,head=await provider.getBlockNumber(),events=[];
 for(let from=start;from<=head;from+=2000){
  const logs=await provider.getLogs({address:app[side],topics:[topic0,null,zeroPadValue(account,32)],fromBlock:from,toBlock:Math.min(from+1999,head)});
  for(const log of logs){
   const event=iface.parseLog(log);
   const receipt=await provider.getTransactionReceipt(log.transactionHash);
   events.push({name:event.name,guid:event.args.guid,remoteEid:Number(event.args.dstEid??event.args.srcEid),account:event.args.fromAddress??event.args.toAddress,
    amountSentLD:event.name==='OFTSent'?event.args.amountSentLD.toString():null,
    amountReceivedLD:event.args.amountReceivedLD.toString(),transactionHash:log.transactionHash,blockNumber:log.blockNumber,receiptSuccess:receipt?.status===1});
  }
 }
 const contract=new Contract(app[side],appAbi,provider);
 const [sendPaused,receivePaused,principalOrSupply,balance]=await Promise.all([
  side==='bsc'?contract.depositsPaused():contract.sendsPaused(),contract.receivesPaused(),
  side==='bsc'?contract.principalLD():contract.totalSupply(),contract.balanceOf(account).catch(()=>null),
 ]);
 evidence.sides[side]={chainId:networks[side].chainId,fromBlock:start,head,app:app[side],events,
  sendPaused,receivePaused,principalOrSupply:formatEther(principalOrSupply),arcUserBalance:side==='arc'?formatEther(balance):undefined};
}
const token=new Contract(tokenAddress,tokenAbi,providers.bsc);
const [walletBalance,allowance,adapterBalance]=await Promise.all([token.balanceOf(account),token.allowance(account,app.bsc),token.balanceOf(app.bsc)]);
evidence.bscToken={token:tokenAddress,walletBalance:formatEther(walletBalance),allowance:formatEther(allowance),adapterBalance:formatEther(adapterBalance)};
evidence.catPaused={};
for(const side of ['bsc','arc']){
 const contract=new Contract(cat[side],appAbi,providers[side]);
 const [sendPause,receivePause]=await Promise.all([side==='bsc'?contract.depositsPaused():contract.sendsPaused(),contract.receivesPaused()]);
 evidence.catPaused[side]={address:cat[side],send:sendPause,receive:receivePause};
}
const bSent=evidence.sides.bsc.events.filter(x=>x.name==='OFTSent'&&x.remoteEid===networks.arc.eid&&same(x.account,account)&&x.amountSentLD===evidence.amountLD&&x.amountReceivedLD===evidence.amountLD&&x.receiptSuccess);
const aReceived=evidence.sides.arc.events.filter(x=>x.name==='OFTReceived'&&x.remoteEid===networks.bsc.eid&&same(x.account,account)&&x.amountReceivedLD===evidence.amountLD&&x.receiptSuccess);
const aSent=evidence.sides.arc.events.filter(x=>x.name==='OFTSent'&&x.remoteEid===networks.bsc.eid&&same(x.account,account)&&x.amountSentLD===evidence.amountLD&&x.amountReceivedLD===evidence.amountLD&&x.receiptSuccess);
const bReceived=evidence.sides.bsc.events.filter(x=>x.name==='OFTReceived'&&x.remoteEid===networks.arc.eid&&same(x.account,account)&&x.amountReceivedLD===evidence.amountLD&&x.receiptSuccess);
const matchAll=(sent,received)=>sent.length>0&&sent.length===received.length
 &&sent.every(send=>received.filter(item=>same(send.guid,item.guid)).length===1)
 &&received.every(item=>sent.filter(send=>same(send.guid,item.guid)).length===1);
const outboundMatched=matchAll(bSent,aReceived),inboundMatched=matchAll(aSent,bReceived);
evidence.roundtripsVerified=outboundMatched&&inboundMatched&&bSent.length===aSent.length?bSent.length:0;
evidence.matches={bscToArc:bSent.at(-1)?.guid??null,arcToBsc:aSent.at(-1)?.guid??null};
evidence.status=evidence.roundtripsVerified>0&&evidence.sides.bsc.principalOrSupply==='0.0'&&evidence.sides.arc.principalOrSupply==='0.0'&&evidence.sides.arc.arcUserBalance==='0.0'
 &&evidence.bscToken.walletBalance===preflight.assets.binancelife.tokenBalance&&evidence.bscToken.allowance==='0.0'&&evidence.bscToken.adapterBalance==='0.0'
 ?'ROUNDTRIP_VERIFIED':'INCOMPLETE';
evidence.limitations=['Read-only event, receipt and current balance verification; not an audit.','No wallet signature or broadcast by this script.'];
const path='research/production/immediate-beta-mainnet/live-roundtrip-verification.json';
writeFileSync(path,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({path,...evidence},null,2));
if(evidence.status!=='ROUNDTRIP_VERIFIED')process.exitCode=1;
