import { AbiCoder, Contract, Interface, getAddress, keccak256, parseUnits, zeroPadValue } from 'ethers';
import { routes } from './routes.js';

export const endpointAbi = [
  'function eid() view returns(uint32)', 'function nativeToken() view returns(address)',
  'function delegates(address) view returns(address)',
  'function getSendLibrary(address,uint32) view returns(address)',
  'function isDefaultSendLibrary(address,uint32) view returns(bool)',
  'function getReceiveLibrary(address,uint32) view returns(address,bool)',
  'function getConfig(address,address,uint32,uint32) view returns(bytes)',
  'function setSendLibrary(address,uint32,address)',
  'function setReceiveLibrary(address,uint32,address,uint256)',
  'function setConfig(address,address,(uint32 eid,uint32 configType,bytes config)[])',
];
const paramType = '(uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd)';
export const pilotAbi = [
  'function owner() view returns(address)', 'function tester() view returns(address)',
  'function endpoint() view returns(address)', 'function token() view returns(address)',
  'function remoteEid() view returns(uint32)', 'function maxPerSend() view returns(uint256)',
  'function lifetimeSendCap() view returns(uint256)', 'function totalSent() view returns(uint256)',
  'function peers(uint32) view returns(bytes32)', 'function setPeer(uint32,bytes32)',
  'function enforcedOptions(uint32,uint16) view returns(bytes)',
  'function msgInspector() view returns(address)',
  'function depositsPaused() view returns(bool)',
  `function quoteSend(${paramType},bool) view returns((uint256 nativeFee,uint256 lzTokenFee))`,
  `function send(${paramType},(uint256 nativeFee,uint256 lzTokenFee),address) payable`,
  'event OFTSent(bytes32 indexed guid,uint32 dstEid,address indexed fromAddress,uint256 amountSentLD,uint256 amountReceivedLD)',
  'event OFTReceived(bytes32 indexed guid,uint32 srcEid,address indexed toAddress,uint256 amountReceivedLD)',
];
export const tokenAbi = ['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)'];
const coder = AbiCoder.defaultAbiCoder();
export const ulnType = 'tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs)';
const executorType = 'tuple(uint32 maxMessageSize,address executor)';
const epInterface = new Interface(endpointAbi), pilotInterface = new Interface(pilotAbi), tokenInterface = new Interface(tokenAbi);
const eq = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
const requireThat = (ok,message) => { if (!ok) throw new Error(message); };
export const remoteChain = id => Number(id) === 56 ? 5042 : 56;
export function configurationSteps(chainId, chain, address, peer) {
  const r = routes[chainId];
  requireThat(!!r, '不支持的网络。');
  address = getAddress(address); peer = getAddress(peer);
  const uln = confirmations => coder.encode([ulnType],[[confirmations,2,255,0,r.dvns,[]]]);
  const step = (key,label,to,iface,method,args) => ({ key,label,to,data:iface.encodeFunctionData(method,args),value:'0',chainId:Number(chainId) });
  return [
    step('peer','设置对端可信合约',address,pilotInterface,'setPeer',[chain.remote,zeroPadValue(peer,32)]),
    step('sendLibrary','设置发送消息库',chain.endpoint,epInterface,'setSendLibrary',[address,chain.remote,r.sendLibrary]),
    step('receiveLibrary','设置接收消息库',chain.endpoint,epInterface,'setReceiveLibrary',[address,chain.remote,r.receiveLibrary,0]),
    step('sendDVN','设置发送验证者',chain.endpoint,epInterface,'setConfig',[address,r.sendLibrary,[[chain.remote,2,uln(r.sendConfirmations)]]]),
    step('receiveDVN','设置接收验证者',chain.endpoint,epInterface,'setConfig',[address,r.receiveLibrary,[[chain.remote,2,uln(r.receiveConfirmations)]]]),
    step('executor','设置消息执行服务',chain.endpoint,epInterface,'setConfig',[address,r.sendLibrary,[[chain.remote,1,coder.encode([executorType],[[r.maxMessageSize,r.executor]])]]]),
  ];
}
function ulnMatches(raw, confirmations, dvns) {
  if (raw === '0x') return false;
  const u = coder.decode([ulnType],raw)[0];
  return u.confirmations === BigInt(confirmations) && u.requiredDVNCount === 2n && u.optionalDVNCount === 0n && u.optionalDVNThreshold === 0n && u.optionalDVNs.length === 0 && u.requiredDVNs.length === 2 && u.requiredDVNs.every((d,i)=>eq(d,dvns[i]));
}
export async function inspectConfiguration(provider, chainId, chain, address, peer, account, token, single, total) {
  requireThat(Number((await provider.getNetwork()).chainId) === Number(chainId),'RPC 网络不匹配。');
  const r = routes[chainId], app = new Contract(address,pilotAbi,provider), endpoint = new Contract(chain.endpoint,endpointAbi,provider);
  const [owner,tester,ep,eid,max,cap,delegate,native,endpointEid,actualToken,options,inspector] = await Promise.all([
    app.owner(),app.tester(),app.endpoint(),app.remoteEid(),app.maxPerSend(),app.lifetimeSendCap(),endpoint.delegates(address),endpoint.nativeToken(),endpoint.eid(),
    app.token(),app.enforcedOptions(chain.remote,1),app.msgInspector(),
  ]);
  requireThat(eq(owner,account) && eq(tester,account) && eq(delegate,account),'管理员、测试地址或 Endpoint delegate 与当前钱包不一致。');
  requireThat(eq(ep,chain.endpoint) && Number(eid) === chain.remote && Number(endpointEid) === chain.eid && BigInt(native) === 0n,'合约端点或目标网络不匹配。');
  requireThat(max === parseUnits(single,18) && cap === parseUnits(total,18),'两侧实验额度与部署记录不一致。');
  requireThat(eq(actualToken, token),'资产合约不匹配。');
  requireThat(options === '0x' && BigInt(inspector) === 0n,'发现未支持的执行选项或消息检查器，请先核查。');
  const codes=await Promise.all([r.sendLibrary,r.receiveLibrary,r.executor,...r.dvns].map(addr=>provider.getCode(addr)));
  requireThat(codes.every(code=>code!=='0x'),'候选消息基础设施地址没有合约代码。');
  const [currentPeer,send,sendDefault,receive,sendConfig,receiveConfig,exConfig] = await Promise.all([
    app.peers(chain.remote),endpoint.getSendLibrary(address,chain.remote),endpoint.isDefaultSendLibrary(address,chain.remote),endpoint.getReceiveLibrary(address,chain.remote),
    endpoint.getConfig(address,r.sendLibrary,chain.remote,2),endpoint.getConfig(address,r.receiveLibrary,chain.remote,2),endpoint.getConfig(address,r.sendLibrary,chain.remote,1),
  ]);
  const ex = exConfig === '0x' ? null : coder.decode([executorType],exConfig)[0];
  const matches = {
    peer:eq(currentPeer,zeroPadValue(peer,32)), sendLibrary:eq(send,r.sendLibrary) && !sendDefault,
    receiveLibrary:eq(receive[0],r.receiveLibrary) && !receive[1],
    sendDVN:ulnMatches(sendConfig,r.sendConfirmations,r.dvns), receiveDVN:ulnMatches(receiveConfig,r.receiveConfirmations,r.dvns),
    executor:!!ex && eq(ex.executor,r.executor) && ex.maxMessageSize === BigInt(r.maxMessageSize),
  };
  return { matches,ready:Object.values(matches).every(Boolean),steps:configurationSteps(chainId,chain,address,peer),block:await provider.getBlockNumber() };
}
export function parseAmount(value) {
  requireThat(/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value),'数量必须为正数，最多 6 位小数。');
  const amount = parseUnits(value,18);
  requireThat(amount > 0n && amount <= parseUnits('1000',18),'数量超出实验范围。'); return amount;
}
export async function transferPlan(provider,chainId,chain,address,token,account,value,approveOnly=false) {
  const amount = parseAmount(value), app = new Contract(address,pilotAbi,provider), erc20 = new Contract(token,tokenAbi,provider);
  requireThat(eq(await app.tester(),account),'仅允许固定测试钱包发送。');
  requireThat(amount <= await app.maxPerSend() && amount + await app.totalSent() <= await app.lifetimeSendCap(),'超过单笔或剩余累计额度。');
  requireThat(await erc20.balanceOf(account) >= amount,'测试代币余额不足。');
  if (Number(chainId) === 56) {
    requireThat(!await app.depositsPaused(),'新存入已暂停；反向赎回不受此开关限制。');
    const allowance = await erc20.allowance(account,address);
    if (approveOnly===true || (approveOnly==='auto' && allowance!==amount)) {
      requireThat(allowance !== amount,'授权额度已与本次数量一致，无需重复授权。');
      return { key:'approve',label:allowance > amount ? '修正授权额度' : '授权本次数量',to:token,data:tokenInterface.encodeFunctionData('approve',[address,amount]),value:'0',amount:String(amount),chainId:Number(chainId) };
    }
    requireThat(allowance >= amount,'请先授权本次数量，确认到账后重新估算跨链费用。');
    requireThat(allowance === amount,'授权额度超过本次数量，请先点击授权 / 修正额度，将额度改为本次数量。');
  } else requireThat(approveOnly!==true,'Arc 销毁发送不需要 ERC20 授权。');
  const options = '0x000301001101' + BigInt(200000).toString(16).padStart(32,'0');
  const params = [chain.remote,zeroPadValue(account,32),amount,amount,options,'0x','0x'];
  const fee = await app.quoteSend(params,false);
  requireThat(fee.lzTokenFee === 0n,'不支持使用 LZ 代币支付费用。');
  return { key:'send',label:Number(chainId) === 56 ? 'BSC → Arc 跨链发送' : 'Arc → BSC 赎回',to:address,data:pilotInterface.encodeFunctionData('send',[params,[fee.nativeFee,0],account]),value:String(fee.nativeFee),amount:String(amount),chainId:Number(chainId) };
}
export async function verifyOperation(record,provider) {
  requireThat(Number((await provider.getNetwork()).chainId) === record.chainId,'请核验记录对应网络。');
  const receipt = await provider.getTransactionReceipt(record.txHash);
  if (!receipt) return {...record,status:'pending',guid:undefined,destinationHash:undefined};
  const tx = await provider.getTransaction(record.txHash);
  // Preserve altered approval evidence while allowing a separate corrective transaction.
  if (record.key === 'approve' && receipt.status === 1 && tx && eq(tx.from,record.account) && eq(tx.to,record.to) && tx.value === 0n && BigInt(record.value) === 0n && tx.data !== record.data) {
    const expected = tokenInterface.decodeFunctionData('approve',record.data);
    const actual = tokenInterface.decodeFunctionData('approve',tx.data);
    requireThat(eq(actual[0],expected[0]),'实际授权对象与预览不符，请人工核查。');
    return {...record,status:'approval-mismatch',actualData:tx.data,actualAmount:String(actual[1]),blockNumber:receipt.blockNumber,gasUsed:String(receipt.gasUsed)};
  }
  requireThat(tx && eq(tx.from,record.account) && eq(tx.to,record.to) && keccak256(tx.data) === keccak256(record.data) && tx.value === BigInt(record.value),'交易内容与操作记录不符。');
  if (receipt.status !== 1) return {...record,status:'failed',guid:undefined,destinationHash:undefined};
  const next = {...record,status:'confirmed',blockNumber:receipt.blockNumber,gasUsed:String(receipt.gasUsed)};
  if (record.key === 'send') {
    const decoded=pilotInterface.decodeFunctionData('send',tx.data),p=decoded[0],fee=decoded[1];
    const destination=remoteChain(record.chainId),sourceEid=record.chainId===56?30102:30417,destinationEid=record.chainId===56?30417:30102;
    requireThat(record.destinationChainId===destination && record.sourceEid===sourceEid && record.destinationEid===destinationEid,'发送记录的网络映射不匹配。');
    requireThat(Number(p.dstEid)===destinationEid && eq(p.to,zeroPadValue(record.account,32)) && p.amountLD===BigInt(record.amount) && p.minAmountLD===p.amountLD && p.composeMsg==='0x' && p.oftCmd==='0x' && eq(decoded[2],record.account) && fee.nativeFee===tx.value && fee.lzTokenFee===0n,'发送记录与实际发送参数不一致。');
    const event = receipt.logs.filter(l=>eq(l.address,record.to)).map(l=>{try{return pilotInterface.parseLog(l);}catch{return null;}}).find(e=>e?.name === 'OFTSent');
    requireThat(event && eq(event.args.fromAddress,record.account) && Number(event.args.dstEid) === record.destinationEid && event.args.amountSentLD === BigInt(record.amount) && event.args.amountReceivedLD === BigInt(record.amount),'未找到匹配的跨链发送事件。');
    next.guid = event.args.guid; next.status = 'sent';
  }
  return next;
}
export async function verifyDelivery(record,provider,txHash) {
  requireThat(record.status === 'sent' && !!record.guid,'请先核验源链发送事件。');
  requireThat(/^0x[\da-fA-F]{64}$/.test(txHash),'请输入目标链交易哈希。');
  requireThat(Number((await provider.getNetwork()).chainId) === record.destinationChainId,'目标 RPC 网络不匹配。');
  const receipt = await provider.getTransactionReceipt(txHash);
  requireThat(receipt?.status === 1,'目标链交易尚未成功确认。');
  const events = receipt.logs.filter(l=>eq(l.address,record.destinationAddress)).map(l=>{try{return pilotInterface.parseLog(l);}catch{return null;}});
  requireThat(events.some(e=>e?.name === 'OFTReceived' && eq(e.args.guid,record.guid) && Number(e.args.srcEid) === record.sourceEid && eq(e.args.toAddress,record.account) && e.args.amountReceivedLD === BigInt(record.amount)),'目标链交易不包含匹配的 GUID、接收地址及数量。');
  return {...record,status:'delivered',destinationHash:txHash,destinationBlock:receipt.blockNumber};
}
