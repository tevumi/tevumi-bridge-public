// LOCAL ONLY: two independent in-memory EVMs. No remote provider, key or env RPC.
import {network} from 'hardhat';
import {BrowserProvider,Contract,ContractFactory,Transaction,parseUnits,formatUnits,zeroPadValue,toQuantity,keccak256} from 'ethers';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';

export async function createCandidateRuntime({store,chains}={}){
 const build=JSON.parse(await readFile('artifacts/build.json','utf8')).output.contracts,connections=[],sides={},pairs={},records=[],previews=new Map();
 const saved=store?.loaded,buildId=createHash('sha256').update(JSON.stringify(build)).digest('hex');
 if(saved&&(saved.schema!==1||saved.epoch!==chains?.epoch||saved.buildId!==buildId||!Array.isArray(saved.records)||!Array.isArray(saved.walletRequests)||!saved.manifest))throw new Error('本地记录与链或合约版本不匹配，已停止操作。');
 let failSend=saved?.failSend??false,pauseReceive=saved?.pauseReceive??false,storageFailed=false;const walletRequests=new Map(saved?.walletRequests??[]),manifest={bsc:[],arc:[]};
 records.push(...(saved?.records??[]));const sessionId=saved?.sessionId??randomUUID();
 const guard=()=>{if(storageFailed)throw new Error('本地存储异常，已停止操作，请核查后重启。');};
 const checkpoint=async()=>{guard();try{await store?.save({schema:1,sessionId,epoch:chains?.epoch,buildId,manifest,records,walletRequests:[...walletRequests],failSend,pauseReceive});}catch(e){storageFailed=true;throw e;}};
 try{
  for(const [side,chainId,eid] of [['bsc',31337,30102],['arc',31338,30417]]){
   const local=chains?await chains.makeSide(side):await network.create({network:'local',override:{chainId}});connections.push(local);
   const p=new BrowserProvider(local.provider,undefined,{cacheTimeout:-1});
   const owner=await p.getSigner(0),users=await Promise.all([1,2].map(i=>p.getSigner(i)));
   const deploy=async(name,args)=>{
    const a=Object.values(build).find(f=>f[name])?.[name];if(!a)throw new Error('请先编译本地合约。');
    const signature=JSON.stringify({name,args},(_,v)=>typeof v==='bigint'?v.toString():v),previous=saved?.manifest[side]?.[manifest[side].length];
    if(saved){if(!previous||previous.signature!==signature||keccak256(await p.getCode(previous.address))!==previous.codeHash)throw new Error('原本地合约身份无法验证，已停止操作。');manifest[side].push(previous);return new Contract(previous.address,a.abi,owner);}
    const c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,owner).deploy(...args);await c.waitForDeployment();const address=await c.getAddress();manifest[side].push({signature,address,codeHash:keccak256(await p.getCode(address))});return c;
   };
   sides[side]={local,p,owner,users,deploy,ep:await deploy('MockEndpoint',[eid]),eid,chainId};
  }
  const b=sides.bsc,a=sides.arc,users=await Promise.all(b.users.map(x=>x.getAddress()));
  for(const [id,name,symbol] of [['binancelife','币安人生','币安人生'],['cat','Simons Cat','CAT']]){
   const token=await b.deploy('CandidateToken',[name,symbol,...users]);
   const limits=[10000000,100000000,200000000];
   const adapter=await b.deploy('ProductionAdapterHarness',[await token.getAddress(),await b.ep.getAddress(),await b.owner.getAddress(),parseUnits('50',18),limits,limits]);
   const oft=await a.deploy('ProductionOFTHarness',[name,symbol,await token.getAddress(),await a.ep.getAddress(),await a.owner.getAddress(),limits,limits]);
   if(!saved){await (await adapter.setPeer(a.eid,zeroPadValue(await oft.getAddress(),32))).wait();await (await oft.setPeer(b.eid,zeroPadValue(await adapter.getAddress(),32))).wait();
   await (await adapter.setPauses(false,false)).wait();await (await oft.setPauses(false,false)).wait();}
   pairs[id]={token,bsc:adapter,arc:oft,symbol};
  }
  const select=input=>{
   if(!pairs[input.asset]||!['bsc','arc'].includes(input.side)||![0,1].includes(input.account))throw new Error('请选择有效资产、方向和模拟账户。');
   const pair=pairs[input.asset],source=sides[input.side],other=input.side==='bsc'?'arc':'bsc';
   return {pair,source,other,account:users[input.account],signer:source.users[input.account],app:pair[input.side]};
  };
  const values=async(input)=>{
   guard();
   const x=select(input),n=String(input.amount??'');
   if([...walletRequests.values()].some(r=>r.intent.account===input.account&&r.intent.side===input.side&&['unknown','conflict'].includes(r.status)))throw new Error('钱包广播结果待核验，请先恢复记录，不能重复发送。');
   if(!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(n))throw new Error('数量需为正数，最多 6 位小数。');
   const amount=parseUnits(n,18);if(amount<=0n)throw new Error('数量必须大于零。');
   const token=input.side==='bsc'?x.pair.token:x.app;
   if(await token.balanceOf(x.account)<amount)throw new Error('模拟代币余额不足。');
   const limit=await x.app.outbound();
   if(amount/10n**12n>limit[0]||amount/10n**12n>await x.app.availableOutboundSD())throw new Error('超出当前单笔或可用发送额度。');
   if(input.side==='bsc'&&await x.app.principalLD()+amount>await x.app.capacityLD())throw new Error('超出本地桥托管容量。');
   if(await x.app[input.side==='bsc'?'depositsPaused':'sendsPaused']())throw new Error('发送已暂停。');
   if(await x.app.peers(sides[x.other].eid)!==zeroPadValue(await x.pair[x.other].getAddress(),32).toLowerCase())throw new Error('本地通道不匹配。');
   if(records.some(r=>r.asset===input.asset&&r.account===input.account&&r.status==='pending'))throw new Error('该账户此资产还有未到账消息，请先投递或重试。');
   const key=input.side==='bsc'&&await token.allowance(x.account,await x.app.getAddress())<amount?'approve':'send';
   return {...x,amount,key,params:[sides[x.other].eid,zeroPadValue(x.account,32),amount,amount,'0x','0x','0x']};
  };
  const state=async()=>({sessionId,walletRequests:[...walletRequests.values()].map(({id,intent,status,hash})=>({id,intent,status,hash})),accounts:users,chains:{bsc:31337,arc:31338},faults:{failSend,pauseReceive},records:records.map(({packet,...r})=>r),assets:await Promise.all(Object.entries(pairs).map(async([id,pair])=>({id,symbol:pair.symbol,adapter:await pair.bsc.getAddress(),oft:await pair.arc.getAddress(),principal:formatUnits(await pair.bsc.principalLD(),18),supply:formatUnits(await pair.arc.totalSupply(),18),balances:await Promise.all(users.map(async account=>({bsc:formatUnits(await pair.token.balanceOf(account),18),arc:formatUnits(await pair.arc.balanceOf(account),18),allowance:formatUnits(await pair.token.allowance(account,await pair.bsc.getAddress()),18)})))})))});
  const preview=async input=>{
   const x=await values(input),id=randomUUID();const intent={asset:input.asset,side:input.side,account:input.account,amount:formatUnits(x.amount,18)};
   if(x.key==='send'&&!failSend)await x.app.connect(x.signer).send.staticCall(x.params,[0,0],x.account);
   const fees=await x.source.p.getFeeData();
   const p={id,intent,key:x.key,expires:Date.now()+120000,to:await (x.key==='approve'?x.pair.token:x.app).getAddress(),recipient:x.account,gasPriceCap:String(fees.maxFeePerGas),priority:String(fees.maxPriorityFeePerGas),gasLimit:'2000000',feeCap:formatUnits(fees.maxFeePerGas*2000000n,18)};previews.set(id,p);return p;
  };
  const reconcileDelivery=async record=>{
   const other=record.side==='bsc'?'arc':'bsc',app=pairs[record.asset][other];
   const logs=await app.queryFilter(app.filters.OFTReceived(record.guid),0,'latest');
   if(!logs.length){if(record.status==='received')throw new Error('原到账事件无法核验，已停止操作。');return false;}
   const event=logs[0];if(event.args.amountReceivedLD!==parseUnits(record.amount,18)||event.args.toAddress.toLowerCase()!==users[record.account].toLowerCase())throw new Error('到账事件与原记录不一致，已停止操作。');
   record.status='received';record.destinationHash=event.transactionHash;delete record.error;return true;
  };
  const deliver=async record=>{
   guard();
   if(record.status==='received')return;
   if(await reconcileDelivery(record)){await checkpoint();return;}
   await checkpoint();
   const pair=pairs[record.asset],other=record.side==='bsc'?'arc':'bsc',packet=record.packet;
   try{
    const receipt=await (await sides[other].ep.deliver(await pair[other].getAddress(),[sides[record.side].eid,zeroPadValue(await pair[record.side].getAddress(),32),packet.nonce],packet.guid,packet.message,{gasLimit:2000000})).wait();
    const event=receipt.logs.map(log=>{try{return pair[other].interface.parseLog(log);}catch{return null;}}).find(e=>e?.name==='OFTReceived'&&e.args.guid===record.guid);
    if(!event||event.args.amountReceivedLD!==parseUnits(record.amount,18)||event.args.toAddress.toLowerCase()!==users[record.account].toLowerCase())throw new Error('DELIVERY_MISMATCH');
    record.status='received';record.destinationHash=receipt.hash;delete record.error;
   }catch{record.status='pending';record.error='目标投递失败，源交易不重发；恢复接收后重试原消息。';}
   await checkpoint();
  };
  const walletRecover=async({id,hash,recoveryOnly=false})=>{
   guard();
   const r=walletRequests.get(id);if(!r)throw new Error('本地钱包操作不存在。');
   if(r.status==='rejected'||(!recoveryOnly&&['confirmed','failed'].includes(r.status)))return {kind:r.key,status:r.status};
   const side=sides[r.intent.side],expected=r.tx;
   let tx=(hash||r.hash)?await side.p.getTransaction(hash||r.hash):null;
   if(!tx){const tip=await side.p.getBlockNumber();for(let n=r.startBlock;n<=tip;n++){
    const block=await side.p.send('eth_getBlockByNumber',[toQuantity(n),true]);
    const found=block.transactions.find(t=>t.from.toLowerCase()===expected.from.toLowerCase()&&BigInt(t.nonce)===BigInt(expected.nonce));
    if(found){tx=await side.p.getTransaction(found.hash);break;}
   }}
   if(!tx){if(['confirmed','failed'].includes(r.status))throw new Error('原交易无法在本地链核验，已停止操作。');return {kind:r.key,status:'unknown'};}
   if(tx.from.toLowerCase()!==expected.from.toLowerCase()||tx.to?.toLowerCase()!==expected.to.toLowerCase()||tx.data!==expected.data||tx.value!==0n||BigInt(tx.nonce)!==BigInt(expected.nonce)||tx.chainId!==BigInt(expected.chainId)||tx.gasLimit>BigInt(expected.gas)||tx.maxFeePerGas>BigInt(expected.maxFeePerGas)){r.status='conflict';await checkpoint();throw new Error('发现与预览不同的交易，请核验记录，不能自动重发。');}
   const receipt=await side.p.getTransactionReceipt(tx.hash);if(!receipt){if(['confirmed','failed'].includes(r.status))throw new Error('原交易回执无法核验，已停止操作。');return {kind:r.key,status:'unknown'};}
   r.hash=tx.hash;if(receipt.status!==1){r.status='failed';await checkpoint();return {kind:r.key,status:'failed'};}
   if(r.key==='send'){
    const event=receipt.logs.map(log=>{try{return side.ep.interface.parseLog(log);}catch{return null;}}).find(e=>e?.name==='Packet');
    if(!event)throw new Error('源交易消息事件缺失，保持待核验。');
    const packet=event.args,existing=records.find(x=>x.sourceHash===tx.hash),record=existing??{...r.intent,id:randomUUID(),sourceHash:tx.hash,guid:packet.guid,status:'pending',packet:{nonce:packet.nonce,guid:packet.guid,message:packet.message}};
    if(!existing)records.push(record);r.status='confirmed';await checkpoint();
    if(recoveryOnly)await reconcileDelivery(record);else if(r.autoDeliver)await deliver(record);
   }
   r.status='confirmed';await checkpoint();return {kind:r.key,status:r.status};
  };
  const walletPrepare=async({id,autoDeliver=true})=>{
   const p=previews.get(id);previews.delete(id);if(!p||Date.now()>p.expires)throw new Error('预览已失效，请重新准备。');
   const x=await values(p.intent);if(x.key!==p.key)throw new Error('授权状态已变化，请重新预览。');
   if((await x.source.p.getFeeData()).maxFeePerGas>BigInt(p.gasPriceCap))throw new Error('本地手续费已超过预览上限，请重新预览。');
   const tx={from:x.account,to:p.to,chainId:toQuantity(x.source.chainId),nonce:toQuantity(await x.source.p.getTransactionCount(x.account,'pending')),data:p.key==='approve'?x.pair.token.interface.encodeFunctionData('approve',[await x.app.getAddress(),x.amount]):x.app.interface.encodeFunctionData('send',[x.params,[0,0],x.account]),value:'0x0',gas:toQuantity(p.gasLimit),maxFeePerGas:toQuantity(p.gasPriceCap),maxPriorityFeePerGas:toQuantity(p.priority)};
   walletRequests.set(id,{id,intent:p.intent,key:p.key,tx,status:'unknown',autoDeliver,startBlock:await x.source.p.getBlockNumber()});await checkpoint();return {id,tx};
  };
  const walletBroadcast=async({id,tx})=>{
   guard();
   // Automation wallet transport: only the exact reserved local transaction is accepted.
   const r=walletRequests.get(id);if(!r||r.status!=='unknown'||r.broadcastStarted||JSON.stringify(tx)!==JSON.stringify(r.tx))throw new Error('本地钱包交易与待签名记录不符或已提交。');
   r.broadcastStarted=true;await checkpoint();return sides[r.intent.side].local.provider.request({method:'eth_sendTransaction',params:[tx]});
  };
  const walletRpc=async({side,method,params=[]})=>{
   guard();
   if(!sides[side]||!Array.isArray(params))throw new Error('本地钱包 RPC 请求无效。');
   const reads=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode','eth_call','eth_estimateGas','eth_getBalance','eth_getTransactionCount','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getLogs','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory']);
   if(reads.has(method))return sides[side].local.provider.request({method,params});
   if(method!=='eth_sendRawTransaction'||params.length!==1||typeof params[0]!=='string')throw new Error('本地钱包 RPC 方法不允许。');
   const signed=Transaction.from(params[0]);
   const r=[...walletRequests.values()].find(r=>r.status==='unknown'&&r.intent.side===side&&r.tx.from.toLowerCase()===signed.from?.toLowerCase()&&BigInt(r.tx.nonce)===BigInt(signed.nonce));
   if(!r||r.broadcastStarted||signed.to?.toLowerCase()!==r.tx.to.toLowerCase()||signed.data!==r.tx.data||signed.value!==0n||signed.chainId!==BigInt(r.tx.chainId)||signed.gasLimit>BigInt(r.tx.gas)||signed.maxFeePerGas>BigInt(r.tx.maxFeePerGas)||signed.maxPriorityFeePerGas>BigInt(r.tx.maxPriorityFeePerGas))throw new Error('签名交易与本地预留操作不符。');
   r.broadcastStarted=true;await checkpoint();
   return sides[side].local.provider.request({method,params});
  };
  if(saved){for(const [id] of walletRequests)await walletRecover({id,recoveryOnly:true});}
  await checkpoint();
  return {sessionId,state,preview,walletRecover,walletPrepare,walletBroadcast,walletRpc,async walletReject({id}){
   guard();const r=walletRequests.get(id);if(!r||r.broadcastStarted)throw new Error('操作可能已广播，请先核验。');r.status='rejected';await checkpoint();
  },async confirm({id,autoDeliver=true}){
   const p=previews.get(id),prepared=await walletPrepare({id,autoDeliver});
   let hash;try{hash=await walletBroadcast(prepared);}catch{
    const result=await walletRecover({id});
    if(result.status==='failed')throw new Error('本地发送交易回滚，未锁仓或销毁；修复模拟故障后重新预览。');
    if(result.status!=='confirmed')throw new Error('本地广播结果待核验，请恢复记录，不能重复发送。');
   }
   const result=await walletRecover({id,hash});
   if(result.status!=='confirmed')throw new Error('本地交易未成功，请核验记录。');
   if(p.key==='approve')return {kind:'approve',next:await preview(p.intent)};
   return {kind:'send',id:records.find(r=>r.sourceHash===walletRequests.get(id).hash)?.id};
  },async retry({id}){const r=records.find(x=>x.id===id);if(!r)throw new Error('本地记录不存在。');await deliver(r);},async faults(input){
   guard();failSend=input.failSend===true;pauseReceive=input.pauseReceive===true;previews.clear();
   for(const side of ['bsc','arc'])await (await sides[side].ep.setFailSend(failSend)).wait();
   for(const pair of Object.values(pairs)){await (await pair.bsc.setPauses(false,pauseReceive)).wait();await (await pair.arc.setPauses(false,pauseReceive)).wait();}
   await checkpoint();
  },async gasSpike(){guard();for(const s of Object.values(sides)){await s.local.provider.request({method:'hardhat_setNextBlockBaseFeePerGas',params:['0x174876e800']});await s.local.provider.request({method:'evm_mine',params:[]});}},async close(){for(const s of Object.values(sides))s.p.destroy();for(const c of connections)await c.close();}};
 }catch(error){for(const s of Object.values(sides))s.p.destroy();for(const c of connections)await c.close();throw error;}
}
