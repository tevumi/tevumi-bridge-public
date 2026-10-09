import {AbiCoder,ZeroAddress,getAddress} from 'ethers';
export const USDC='0x3600000000000000000000000000000000000000';
export const ROUTERS={56:'0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',5042:'0xA4072583658Fae592A3506A42431cb6316a8d40b'};
export const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
export const bridgeType='tuple(bytes32 transactionId,string bridge,string integrator,address referrer,address sendingAssetId,address receiver,uint256 minAmount,uint256 destinationChainId,bool hasSourceSwaps,bool hasDestinationCall)';
export function validateQuote(q,{account,fromChain,toChain,amount}){
 const a=q?.action,t=q?.transactionRequest;
 if(!a||!t||Number(a.fromChainId)!==fromChain||Number(a.toChainId)!==toChain||!same(a.fromAddress,account)||!same(a.toAddress,account)||BigInt(a.fromAmount)!==amount)throw Error('报价方向、金额或钱包不匹配');
 if(!same(a.fromToken.address,fromChain===5042?USDC:ZeroAddress)||!same(a.toToken.address,toChain===5042?USDC:ZeroAddress)||a.fromToken.decimals!==(fromChain===5042?6:18)||a.toToken.decimals!==(toChain===5042?6:18))throw Error('报价资产不匹配');
 if(!['relaydepository','lifiIntents','across'].includes(q.tool)||!same(t.to,ROUTERS[fromChain])||Number(t.chainId)!==fromChain||!same(t.from,account))throw Error('报价使用未经本地验证的路由');
 const b=AbiCoder.defaultAbiCoder().decode([bridgeType],'0x'+t.data.slice(10))[0];
 if(!same(b.receiver,account)||Number(b.destinationChainId)!==toChain||b.hasDestinationCall||b.bridge!==q.tool)throw Error('交易调用的收款人、目标链或桥不匹配');
 if(BigInt(q.estimate.toAmountMin)<=0n||BigInt(q.estimate.toAmountMin)>BigInt(q.estimate.toAmount))throw Error('最低到账无效');
 if(BigInt(t.value)!==(fromChain===56?amount:0n))throw Error('钱包交易付款金额不匹配');
 if(fromChain===5042&&(!same(q.estimate.approvalAddress,ROUTERS[fromChain])||!same(b.sendingAssetId,USDC)))throw Error('Arc 授权或资金路径不匹配');
 getAddress(account);return b;
}
