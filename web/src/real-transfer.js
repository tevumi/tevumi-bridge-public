import legacyDeployments from '../../config/real-deployments-legacy.json' with {type:'json'};
import {Interface,zeroPadValue} from 'ethers';
import {pairFor,inspectRealPair} from './real-route.js';
import {tester} from './real-deployment.js';
import {pilotAbi,tokenAbi} from './bridge.js';
import {chains} from './pilot.js';
const app=new Interface(pilotAbi),token=new Interface(tokenAbi);
const eq=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const ensure=(ok)=>{if(!ok)throw Error('真实资产交易身份、接收者或数量与固定通道不一致。');};
export async function realOperationPair(assetId,rpc,records){
 const snapshots=await inspectRealPair(assetId,rpc,records),p=pairFor(assetId,records);
 // Deployment identity is independently checked by inspectRealPair. Readiness is checked by the caller before writes.
 return {PilotToken:{address:p[56].sourceToken},PilotAdapter:{...p[56],single:'0.000001',total:'0.000010'},PilotOFT:{...p[5042],single:'0.000001',total:'0.000010'},snapshots};
}
function assertOperation(r,records){
 const p=pairFor(r.assetId,records),mine=p[r.chainId],other=p[r.chainId===56?5042:56];
 ensure(mine && r.account===tester && eq(r.sourceToken,p[56].sourceToken));
 ensure(r.destinationChainId===(r.chainId===56?5042:56) && eq(r.destinationAddress,other.address));
 ensure(r.sourceEid===chains[r.chainId].eid && r.destinationEid===chains[r.chainId].remote);
 ensure(BigInt(r.amount)===1000000000000n);
 if(r.key==='approve'){
  ensure(r.chainId===56 && eq(r.to,p[56].sourceToken) && r.value==='0');
  const a=token.decodeFunctionData('approve',r.data);ensure(eq(a[0],mine.address)&&a[1]===BigInt(r.amount));
  ensure(token.encodeFunctionData('approve',a)===r.data);
 }else{
  ensure(r.key==='send' && eq(r.to,mine.address));
  const a=app.decodeFunctionData('send',r.data),param=a[0],fee=a[1];
  ensure(Number(param.dstEid)===r.destinationEid && eq(param.to,zeroPadValue(tester,32)) && eq(a[2],tester));
  ensure(param.amountLD===BigInt(r.amount)&&param.minAmountLD===param.amountLD && param.composeMsg==='0x'&&param.oftCmd==='0x');
  ensure(param.extraOptions==='0x00030100110100000000000000000000000000030d40' && fee.nativeFee===BigInt(r.value)&&fee.lzTokenFee===0n);
  ensure(app.encodeFunctionData('send',a)===r.data);
 }
 return r;
}

export function assertRealOperation(r,records){
 try{return assertOperation(r,records);}catch(error){if(records)throw error;return assertOperation(r,legacyDeployments);}
}
