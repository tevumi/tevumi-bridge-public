import {readFileSync, writeFileSync} from 'node:fs';
import {Contract, FetchRequest, Interface, JsonRpcProvider, formatEther, parseEther, zeroPadValue} from 'ethers';

const networks=JSON.parse(readFileSync('config/networks.json','utf8'));
const manifest=JSON.parse(readFileSync('research/production/immediate-beta-unsigned/manifest.json','utf8'));
const account='0x489594537CB76aC256079D710B6E18498E1a5402';
const options='0x00030100110100000000000000000000000000030d40';
const amount=parseEther('0.000001');
const abi=[
 'function depositsPaused() view returns(bool)','function sendsPaused() view returns(bool)',
 'function receivesPaused() view returns(bool)','function availableOutboundSD() view returns(uint256)',
 'function availableInboundSD() view returns(uint256)','function principalLD() view returns(uint256)',
 'function capacityLD() view returns(uint256)','function balanceOf(address) view returns(uint256)',
 'function quoteSend((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),bool) view returns((uint256 nativeFee,uint256 lzTokenFee))',
];
const tokenAbi=['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)'];
const addresses={};
const admins={};
for(const deployment of manifest.deployments){
 if(deployment.assetId) (addresses[deployment.assetId]??={})[deployment.side]=deployment.predictedAddress;
 else admins[deployment.side]=deployment.predictedAddress;
}
const providers={};
for(const side of ['bsc','arc']){
 const url=process.env[networks[side].rpcEnv];
 if(!url) throw Error(`MISSING_${side.toUpperCase()}_RPC`);
 const request=new FetchRequest(url);request.timeout=45000;
 providers[side]=new JsonRpcProvider(request,networks[side].chainId,{batchMaxCount:1,cacheTimeout:-1});
}
const output={checkedAt:new Date().toISOString(),kind:'read-only-mainnet-preflight',account,amount:'0.000001',assets:{},limitations:['No wallet signing or asset transfer was performed.','Quotes and balances can change before signing.']};
output.activation={};
const pauseData=new Interface(['function setPauses(bool,bool)']).encodeFunctionData('setPauses',[false,false]);
for(const side of ['bsc','arc']){
 const governor=new Contract(admins[side],['function executeBatch(address[] targets,bytes[] payloads)'],providers[side]);
 const [gas,price,native]=await Promise.all([
  governor.executeBatch.estimateGas([addresses.binancelife[side]],[pauseData],{from:account}),
  providers[side].getFeeData(),providers[side].getBalance(account),
 ]);
 const unitPrice=price.maxFeePerGas??price.gasPrice;
 output.activation[side]={admin:admins[side],app:addresses.binancelife[side],estimatedGas:gas.toString(),estimatedMaxNetworkFee:formatEther(gas*unitPrice),nativeBalance:formatEther(native),balanceCoversEstimate:native>gas*unitPrice};
}
for(const [assetId,pair] of Object.entries(addresses)){
 const tokenAddress=manifest.deployments.find(x=>x.side==='bsc'&&x.assetId===assetId).constructorArgs[0];
 const token=new Contract(tokenAddress,tokenAbi,providers.bsc);
 const bsc=new Contract(pair.bsc,abi,providers.bsc),arc=new Contract(pair.arc,abi,providers.arc);
 const [tokenBalance,allowance,bscNative,arcNative,principal,capacity,arcBalance,bscSendPaused,bscReceivePaused,arcSendPaused,arcReceivePaused,bscOut,arcIn,arcOut,bscIn]=await Promise.all([
  token.balanceOf(account),token.allowance(account,pair.bsc),providers.bsc.getBalance(account),providers.arc.getBalance(account),
  bsc.principalLD(),bsc.capacityLD(),arc.balanceOf(account),bsc.depositsPaused(),bsc.receivesPaused(),arc.sendsPaused(),arc.receivesPaused(),
  bsc.availableOutboundSD(),arc.availableInboundSD(),arc.availableOutboundSD(),bsc.availableInboundSD(),
 ]);
 const quote=async(app,eid)=>{
  try{const fee=await app.quoteSend([eid,zeroPadValue(account,32),amount,amount,options,'0x','0x'],false);return {nativeFee:fee.nativeFee.toString(),lzTokenFee:fee.lzTokenFee.toString()};}
  catch(error){return {errorCode:error.code??'UNKNOWN',reason:String(error.shortMessage??error.message??'').slice(0,160).replace(/https?:\/\/\S+/g,'[rpc]')};}
 };
 output.assets[assetId]={sourceToken:tokenAddress,bscApp:pair.bsc,arcApp:pair.arc,
  tokenBalance:formatEther(tokenBalance),allowance:formatEther(allowance),bscNative:formatEther(bscNative),arcNative:formatEther(arcNative),
  principal:formatEther(principal),capacity:formatEther(capacity),arcBalance:formatEther(arcBalance),
  paused:{bscSend:bscSendPaused,bscReceive:bscReceivePaused,arcSend:arcSendPaused,arcReceive:arcReceivePaused},
  availableSD:{bscOut:bscOut.toString(),arcIn:arcIn.toString(),arcOut:arcOut.toString(),bscIn:bscIn.toString()},
  quote:{bscToArc:await quote(bsc,networks.arc.eid),arcToBsc:await quote(arc,networks.bsc.eid)},
 };
}
const path='research/production/immediate-beta-mainnet/live-readiness.json';
writeFileSync(path,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({path,...output},null,2));
