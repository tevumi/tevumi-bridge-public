// EIP-1193 boundary for local candidate tests. No automatic send retries.
export function createCandidateWallet(provider,{timeoutMs=0,onChange=()=>{}}={}){
 let generation=0;
 const changed=()=>{generation++;onChange();};
 for(const event of ['accountsChanged','chainChanged','disconnect'])provider?.on?.(event,changed);
 const request=(method,params=[])=>{if(!provider)throw new Error('未发现钱包接口，本地自动化测试需注入测试钱包。');return provider.request({method,params});};
 async function context(intent,state){
  const seq=generation,[accounts,chain]=await Promise.all([request('eth_accounts'),request('eth_chainId')]);
  if(seq!==generation||accounts[0]?.toLowerCase()!==state.accounts[intent.account].toLowerCase()||Number(BigInt(chain))!==state.chains[intent.side])throw new Error('钱包账户或网络已变化，请重新连接并预览。');
  return seq;
 }
 return {
  async connect(){await request('eth_requestAccounts');},
  async switchChain(chainId){
   const side=chainId===31337?'bsc':chainId===31338?'arc':null;
   if(!side)throw new Error('不支持的钱包网络。');
   const hex='0x'+chainId.toString(16);
   try{await request('wallet_switchEthereumChain',[{chainId:hex}]);}
   catch(error){
    if(error?.code!==4902&&error?.data?.originalError?.code!==4902)throw error;
    await request('wallet_addEthereumChain',[{chainId:hex,chainName:`Tevumi local ${side.toUpperCase()}`,nativeCurrency:{name:'Local ETH',symbol:'ETH',decimals:18},rpcUrls:[`http://127.0.0.1:5174/__candidate/rpc/${side}`]}]);
    await request('wallet_switchEthereumChain',[{chainId:hex}]);
   }
  },
  assertContext:context,
  async recover(state,api){for(const r of state.walletRequests??[])if(r.status==='unknown')await api('wallet-recover',{id:r.id});},
  async confirm(p,state,api,autoDeliver){
   const seq=await context(p.intent,state);
   const reserved=await api('wallet-prepare',{id:p.id,autoDeliver});
   // Account/network events between reservation and request must never cause a send.
   try{await context(p.intent,state);if(seq!==generation)throw Error('钱包状态已变化。');}
   catch(e){await api('wallet-reject',{id:reserved.id});throw e;}
   let timer,hash;
   try{
    const pending=request('eth_sendTransaction',[reserved.tx]);
    hash=timeoutMs>0?await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('钱包返回超时，广播结果待核验。')),timeoutMs);})]):await pending;
   }catch(e){
    if(e?.code===4001||e?.code==='ACTION_REJECTED'){
     await api('wallet-reject',{id:reserved.id});throw new Error('已取消钱包操作，不会自动重试。');
    }
    throw new Error('钱包广播结果待核验，请刷新记录；不会自动重发。');
   }finally{clearTimeout(timer);}
   if(typeof hash!=='string'||!/^0x[\da-fA-F]{64}$/.test(hash))throw new Error('钱包返回结果不明确，请刷新记录核验。');
   const result=await api('wallet-recover',{id:reserved.id,hash});
   if(result.status!=='confirmed')throw new Error('交易尚未成功确认，请先核验记录。');
   // Always reconcile a broadcast, but never continue authorization after a context change.
   if(seq!==generation)throw new Error('交易已记录，钱包状态已变化，请重新预览下一步。');
   await context(p.intent,state);
   if(result.kind==='approve'){
    const next=await api('preview',p.intent);
    if(seq!==await context(p.intent,state))throw new Error('钱包状态已变化，请重新预览下一步。');
    return {kind:'approve',next};
   }
   return {kind:'send'};
  }
 };
}
