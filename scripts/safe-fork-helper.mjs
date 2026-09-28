// Local fork helper only. Signers must come from the simulated Hardhat provider.
import {Contract,Signature,ZeroAddress,concat,getBytes,keccak256} from 'ethers';
import {getSafeL2SingletonDeployment,getProxyFactoryDeployment,getFallbackHandlerDeployment} from '@safe-global/safe-deployments';

export async function createLocalSafe(provider,chainId,relayer,owners) {
  const filter={network:String(chainId)};
  const definitions={singleton:getSafeL2SingletonDeployment(filter),factory:getProxyFactoryDeployment(filter),fallback:getFallbackHandlerDeployment(filter)};
  const verified={};
  for(const [key,d] of Object.entries(definitions)){
    if(!d)throw new Error('SAFE_REGISTRY_MISSING');
    const registered=Object.values(d.deployments).find(x=>x.address.toLowerCase()===d.defaultAddress.toLowerCase());
    if(!registered || keccak256(await provider.getCode(d.defaultAddress)).toLowerCase()!==registered.codeHash.toLowerCase())throw new Error('SAFE_CODE_MISMATCH');
    verified[key]={address:d.defaultAddress,codeHash:registered.codeHash};
  }
  const addresses=await Promise.all(owners.map(x=>x.getAddress()));
  const singleton=new Contract(verified.singleton.address,definitions.singleton.abi,provider);
  const factory=new Contract(verified.factory.address,definitions.factory.abi,relayer);
  const setup=singleton.interface.encodeFunctionData('setup',[addresses,2,ZeroAddress,'0x',verified.fallback.address,ZeroAddress,0,ZeroAddress]);
  let expected;
  try{
    const receipt=await (await factory.createProxyWithNonce(verified.singleton.address,setup,1)).wait();
    const created=receipt.logs.map(log=>{try{return factory.interface.parseLog(log);}catch{return null;}}).find(event=>event?.name==='ProxyCreation');
    expected=created?.args.proxy;
    if(!expected)throw new Error('SAFE_PROXY_EVENT_MISSING');
  }catch{throw new Error('SAFE_PROXY_CREATION_FAILED');}
  const safe=new Contract(expected,definitions.singleton.abi,relayer);
  const actualOwners=await safe.getOwners();
  if((await safe.getThreshold())!==2n || actualOwners.length!==3 || !addresses.every(x=>actualOwners.some(y=>y.toLowerCase()===x.toLowerCase())))throw new Error('SAFE_SETUP_MISMATCH');
  async function signatures(to,data,signers){
    const nonce=await safe.nonce();
    const hash=await safe.getTransactionHash(to,0,data,0,0,0,0,ZeroAddress,ZeroAddress,nonce);
    const parts=await Promise.all(signers.map(async signer=>{
      const address=await signer.getAddress(),sig=Signature.from(await signer.signMessage(getBytes(hash)));
      return {address,encoded:concat([sig.r,sig.s,new Uint8Array([sig.v+4])])};
    }));
    return concat(parts.sort((a,b)=>a.address.toLowerCase().localeCompare(b.address.toLowerCase())).map(x=>x.encoded));
  }
  async function execute(to,data,signers){
    const expectedHash=await safe.getTransactionHash(to,0,data,0,0,0,0,ZeroAddress,ZeroAddress,await safe.nonce());
    const sigs=await signatures(to,data,signers);
    const args=[to,0,data,0,0,0,0,ZeroAddress,ZeroAddress,sigs];
    const can=await safe.execTransaction.staticCall(...args);
    if(!can)throw new Error('SAFE_EXECUTION_REJECTED');
    const receipt=await (await safe.execTransaction(...args)).wait();
    const events=receipt.logs.filter(log=>log.address.toLowerCase()===expected.toLowerCase()).map(log=>{try{return safe.interface.parseLog(log);}catch{return null;}});
    if(events.some(e=>e?.name==='ExecutionFailure') || !events.some(e=>e?.name==='ExecutionSuccess' && e.args.txHash===expectedHash))throw new Error('SAFE_EXECUTION_NOT_CONFIRMED');
    return receipt;
  }
  return {safe,address:expected,verified,signatures,execute};
}
