import {Contract,ContractFactory,getAddress,keccak256,parseEther} from 'ethers';
import registry from '../../config/meme-candidates.json' with {type:'json'};
import artifacts from '../generated/real-contracts.json' with {type:'json'};
import {chains} from './pilot.js';

export const tester = getAddress('0x489594537CB76aC256079D710B6E18498E1a5402');
export const realAssets = registry.assets;
export const realKinds = {RestrictedAssetAdapter:56,RestrictedAssetOFT:5042,RestrictedAssetOFTV2:5042};
export async function realDeployment(assetId,kind) {
  const asset=realAssets.find(a=>a.id===assetId);
  if(!asset || !Object.hasOwn(realKinds,kind))throw Error('未知真实资产或合约类型。');
  const chainId=realKinds[kind],chain=chains[chainId];
  const common=[chain.endpoint,tester,tester,chain.remote,parseEther('0.000001'),parseEther('0.000010')];
  const args=kind==='RestrictedAssetAdapter'?[asset.sourceToken,...common]:[kind==='RestrictedAssetOFTV2'?asset.sourceName:asset.name,kind==='RestrictedAssetOFTV2'?asset.sourceSymbol:(asset.id==='cat'?'CAT':'BNLIFE'),asset.sourceToken,...common];
  const artifact=artifacts[kind];
  const tx=await new ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(...args);
  return {assetId,kind,chainId,account:tester,sourceToken:getAddress(asset.sourceToken),args:args.map(String),data:tx.data,dataHash:keccak256(tx.data),bytecodeHash:artifact.bytecodeHash};
}
export async function checkRealEnvironment(plan,rpc) {
  if(Number((await rpc.getNetwork()).chainId)!==plan.chainId)throw Error('钱包网络与部署目标不一致。');
  if(await rpc.getCode(tester)!=='0x')throw Error('当前部署流程仅支持指定的普通 EOA 钱包。');
  const endpoint=new Contract(chains[plan.chainId].endpoint,['function eid() view returns(uint32)','function nativeToken() view returns(address)'],rpc);
  if(Number(await endpoint.eid())!==chains[plan.chainId].eid || BigInt(await endpoint.nativeToken())!==0n)throw Error('跨链端点核验未通过。');
  if(plan.chainId===56){
    const token=new Contract(plan.sourceToken,['function decimals() view returns(uint8)'],rpc);
    if(Number(await token.decimals())!==18)throw Error('原币精度与审核记录不一致。');
  }
}
export async function verifyRealDeployment(record,rpc) {
  const expected=await realDeployment(record.assetId,record.kind);
  if(record.chainId!==expected.chainId || record.account!==tester || record.sourceToken!==expected.sourceToken || record.dataHash!==expected.dataHash || record.bytecodeHash!==expected.bytecodeHash)throw Error('部署记录与当前资产构建不匹配。');
  if(Number((await rpc.getNetwork()).chainId)!==expected.chainId)throw Error('请切换到记录对应网络。');
  const receipt=await rpc.getTransactionReceipt(record.txHash);
  if(!receipt)return {...record,status:'pending'};
  const tx=await rpc.getTransaction(record.txHash);
  if(!tx || tx.to!==null || getAddress(tx.from)!==tester || tx.value!==0n || keccak256(tx.data)!==expected.dataHash)throw Error('链上交易与该资产部署不匹配。');
  if(receipt.status!==1)return {...record,status:'failed'};
  if(!receipt.contractAddress)throw Error('未发现部署代码。');
  const contract=new Contract(receipt.contractAddress,artifacts[record.kind].abi,rpc);
  const [code,binding,metadata]=await Promise.all([
    rpc.getCode(receipt.contractAddress),
    record.chainId===56?contract.token():contract.sourceToken(),
    record.kind==='RestrictedAssetOFTV2'?Promise.all([contract.name(),contract.symbol()]):null,
  ]);
  if(code==='0x')throw Error('未发现部署代码。');
  if(getAddress(binding)!==expected.sourceToken)throw Error('原币绑定不匹配。');
  if(metadata && (metadata[0]!==expected.args[0] || metadata[1]!==expected.args[1]))throw Error('Arc 名称或符号与原币快照不匹配。');
  return {...record,status:'confirmed',address:getAddress(receipt.contractAddress),blockNumber:receipt.blockNumber,gasUsed:String(receipt.gasUsed)};
}

export async function checkSourceMetadata(plan,rpc) {
  if(plan.kind!=='RestrictedAssetOFTV2')return;
  if(Number((await rpc.getNetwork()).chainId)!==56)throw Error('原币名称核验必须读取 BSC 主网。');
  const token=new Contract(plan.sourceToken,['function name() view returns(string)','function symbol() view returns(string)'],rpc);
  const [name,symbol]=await Promise.all([token.name(),token.symbol()]);
  if(name!==plan.args[0]||symbol!==plan.args[1])throw Error('BSC 原币名称或符号已变化，停止部署并更新元数据记录。');
}
