import {Contract,Interface,getAddress,parseUnits,zeroPadValue} from 'ethers';

const sendParam='(uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd)';
export const candidateAppAbi=[
 'function token() view returns(address)', 'function sourceToken() view returns(address)',
 'function endpoint() view returns(address)', 'function peers(uint32) view returns(bytes32)',
 'function depositsPaused() view returns(bool)', 'function sendsPaused() view returns(bool)',
 'function receivesPaused() view returns(bool)', 'function availableOutboundSD() view returns(uint256)',
 'function availableInboundSD() view returns(uint256)',
 'function outbound() view returns(uint64 single,uint64 burst,uint64 windowCap,uint256 credit,uint256 updatedAt,bool initialized)',
 'function inbound() view returns(uint64 single,uint64 burst,uint64 windowCap,uint256 credit,uint256 updatedAt,bool initialized)',
 'function principalLD() view returns(uint256)', 'function capacityLD() view returns(uint256)',
 'function balanceOf(address) view returns(uint256)',
 `function quoteSend(${sendParam},bool) view returns((uint256 nativeFee,uint256 lzTokenFee))`,
 `function send(${sendParam},(uint256 nativeFee,uint256 lzTokenFee),address) payable`,
];
export const candidateTokenAbi=[
 'function balanceOf(address) view returns(uint256)',
 'function allowance(address,address) view returns(uint256)',
 'function decimals() view returns(uint8)',
 'function approve(address,uint256) returns(bool)',
];
const appInterface=new Interface(candidateAppAbi),tokenInterface=new Interface(candidateTokenAbi);
const endpointAbi=['function eid() view returns(uint32)'];
const check=(condition,message)=>{if(!condition)throw Error(message);};
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const address=value=>getAddress(value);

/** Read-only transaction preparation for an explicitly supplied candidate pair.
 * No old deployment registry, signer, wallet request, or automatic broadcast.
 */
export async function planCandidateTransfer({providers,networks,pair,side,account,amount,extraOptions}){
 check(['bsc','arc'].includes(side),'不支持的发送网络。');
 const other=side==='bsc'?'arc':'bsc',source=networks?.[side],target=networks?.[other];
 check(source&&target&&providers?.[side]&&providers?.[other]&&pair?.bsc&&pair?.arc,'正式候选通道尚未配置。');
 check(/^0x(?:[0-9a-fA-F]{2})*$/.test(extraOptions??''),'目标链执行选项未配置。');
 check(/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(String(amount)),'数量必须为正数，最多 6 位小数。');
 const amountLD=parseUnits(String(amount),18),amountSD=amountLD/10n**12n;
 check(amountLD>0n&&amountLD%10n**12n===0n,'数量不符合共享精度。');
 const user=address(account),tokenAddress=address(pair.sourceToken),sourceAddress=address(pair[side]),targetAddress=address(pair[other]);
 const [sourceChain,targetChain]=await Promise.all([providers[side].getNetwork(),providers[other].getNetwork()]);
 check(Number(sourceChain.chainId)===source.chainId&&Number(targetChain.chainId)===target.chainId,'RPC 网络与候选通道不匹配。');
 const [sourceCode,targetCode,tokenCode]=await Promise.all([providers[side].getCode(sourceAddress),providers[other].getCode(targetAddress),providers.bsc.getCode(tokenAddress)]);
 check(sourceCode!=='0x'&&targetCode!=='0x'&&tokenCode!=='0x','候选合约或原币没有代码。');
 const app=new Contract(sourceAddress,candidateAppAbi,providers[side]),destination=new Contract(targetAddress,candidateAppAbi,providers[other]);
 const token=new Contract(tokenAddress,candidateTokenAbi,providers.bsc);
 const [sourceEndpoint,targetEndpoint,peer,reversePeer,sourceEid,targetEid,sourcePause,targetPause,outbound,inbound,availableOut,availableIn,sourceBinding,targetBinding]=await Promise.all([
  app.endpoint(),destination.endpoint(),app.peers(target.eid),destination.peers(source.eid),
  new Contract(source.endpoint,endpointAbi,providers[side]).eid(),new Contract(target.endpoint,endpointAbi,providers[other]).eid(),
  side==='bsc'?app.depositsPaused():app.sendsPaused(),destination.receivesPaused(),
  app.outbound(),destination.inbound(),app.availableOutboundSD(),destination.availableInboundSD(),
  side==='bsc'?app.token():app.sourceToken(),other==='bsc'?destination.token():destination.sourceToken(),
 ]);
 check(same(sourceEndpoint,source.endpoint)&&same(targetEndpoint,target.endpoint)&&Number(sourceEid)===source.eid&&Number(targetEid)===target.eid,'Endpoint 身份不匹配。');
 check(same(peer,zeroPadValue(targetAddress,32))&&same(reversePeer,zeroPadValue(sourceAddress,32)),'双向可信合约不匹配。');
 check(same(sourceBinding,tokenAddress)&&same(targetBinding,tokenAddress),'原币绑定不匹配。');
 check(!sourcePause&&!targetPause,'发送或目标接收已暂停。');
 check(amountSD<=outbound.single&&amountSD<=availableOut&&amountSD<=inbound.single&&amountSD<=availableIn,'超过当前发送或接收额度。');
 if(side==='bsc'){
  const [decimals,principal,capacity,balance,allowance]=await Promise.all([
   token.decimals(),app.principalLD(),app.capacityLD(),token.balanceOf(user),token.allowance(user,sourceAddress),
  ]);
  check(Number(decimals)===18,'原币精度不符合候选合约要求。');
  check(principal<=capacity&&amountLD<=capacity-principal,'超过锁仓容量。');
  check(balance>=amountLD,'原币余额不足。');
  if(allowance!==amountLD)return {key:'approve',side,amountLD,recipient:user,to:tokenAddress,value:0n,data:tokenInterface.encodeFunctionData('approve',[sourceAddress,amountLD])};
 }else{
  check(await app.balanceOf(user)>=amountLD,'Arc 对应币余额不足。');
 }
 const params=[target.eid,zeroPadValue(user,32),amountLD,amountLD,extraOptions,'0x','0x'];
 const fee=await app.quoteSend(params,false);
 check(fee.lzTokenFee===0n,'不支持使用 LZ 代币支付消息费。');
 return {key:'send',side,amountLD,recipient:user,to:sourceAddress,value:fee.nativeFee,data:appInterface.encodeFunctionData('send',[params,[fee.nativeFee,0],user]),nativeFee:fee.nativeFee};
}
