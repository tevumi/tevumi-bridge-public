// Read-only mainnet preflight and unsigned 0.000002-per-send proposal.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {Contract,FetchRequest,Interface,JsonRpcProvider,formatEther,keccak256,zeroPadValue} from 'ethers';

const networks=JSON.parse(await readFile('config/networks.json','utf8'));
const account='0x489594537CB76aC256079D710B6E18498E1a5402';
const apps={
 binancelife:{bsc:'0x89F3A44786C97618cc4b45721D433c9a83921ec4',arc:'0x9aF52E914DCC692Af046A136AC1c59f98F7347E7'},
 cat:{bsc:'0x561750f93BAC5BC237De7FE092b9A40e1cC20b06',arc:'0x503200C60aaA078899B31268833c5F090693E30B'},
};
const admins={bsc:'0xB2039D774574d9171E143cA30aAb48bB25b3F8e8',arc:'0x01dba01e9E6f40669d8D3036316967221Bc0081C'};
const appAbi=['function owner() view returns(address)','function guardian() view returns(address)','function peers(uint32) view returns(bytes32)','function outbound() view returns(uint64 single,uint64 burst,uint64 windowCap,uint256 credit,uint256 updatedAt,bool initialized)','function inbound() view returns(uint64 single,uint64 burst,uint64 windowCap,uint256 credit,uint256 updatedAt,bool initialized)','function availableOutboundSD() view returns(uint256)','function availableInboundSD() view returns(uint256)','function depositsPaused() view returns(bool)','function sendsPaused() view returns(bool)','function receivesPaused() view returns(bool)','function principalLD() view returns(uint256)','function capacityLD() view returns(uint256)','function configureLimit(bool,uint64,uint64,uint64)'];
const appIface=new Interface(appAbi),adminAbi=['function owner() view returns(address)','function executeBatch(address[] targets,bytes[] payloads)'],adminIface=new Interface(adminAbi);
const report={checkedAt:new Date().toISOString(),status:'UNSIGNED_MAINNET_LIMIT_PROPOSAL',requestedSingleSD:'2',account,chains:{},limitations:['No wallet signature or mainnet transaction was sent.','Gas quotes and pending nonces must be checked again immediately before signing.','This changes per-send limits only; burst, window and BSC collateral capacity remain unchanged.']};
const plan={releaseId:'tevumi-limit-2sd-20260927',account,singleSD:'2',batches:[]};
for(const side of ['bsc','arc']){
 const cfg=networks[side],url=process.env[cfg.rpcEnv];assert.ok(url,`MISSING_${side.toUpperCase()}_RPC`);
 const request=new FetchRequest(url);request.timeout=45000;
 const provider=new JsonRpcProvider(request,cfg.chainId,{batchMaxCount:1,cacheTimeout:-1});
 try{
  assert.equal(Number((await provider.getNetwork()).chainId),cfg.chainId);
  const admin=new Contract(admins[side],adminAbi,provider);
  assert.notEqual(await provider.getCode(admins[side]),'0x');
  assert.equal((await admin.owner()).toLowerCase(),account.toLowerCase());
  const other=side==='bsc'?'arc':'bsc',rows=[],targets=[],payloads=[];
  for(const asset of ['binancelife','cat']){
   const address=apps[asset][side],app=new Contract(address,appAbi,provider);
   assert.notEqual(await provider.getCode(address),'0x');
   const [owner,guardian,peer,outbound,inbound,outAvailable,inAvailable,sendPaused,receivePaused]=await Promise.all([
    app.owner(),app.guardian(),app.peers(networks[other].eid),app.outbound(),app.inbound(),app.availableOutboundSD(),app.availableInboundSD(),side==='bsc'?app.depositsPaused():app.sendsPaused(),app.receivesPaused(),
   ]);
   assert.equal(owner.toLowerCase(),admins[side].toLowerCase());
   assert.equal(guardian.toLowerCase(),account.toLowerCase());
   assert.equal(peer.toLowerCase(),zeroPadValue(apps[asset][other],32).toLowerCase());
   assert.equal(sendPaused,false);assert.equal(receivePaused,false);
   for(const [incoming,policy,available] of [[false,outbound,outAvailable],[true,inbound,inAvailable]]){
    assert.equal(policy.initialized,true);assert.equal(policy.single,1n);
    assert.equal(policy.burst,10n);assert.equal(policy.windowCap,100n);
    assert.ok(available>=2n);
    targets.push(address);payloads.push(appIface.encodeFunctionData('configureLimit',[incoming,2n,policy.burst,policy.windowCap]));
   }
   const row={asset,app:address,peer,sendPaused,receivePaused,outbound:{singleSD:outbound.single.toString(),burstSD:outbound.burst.toString(),windowCapSD:outbound.windowCap.toString(),availableSD:outAvailable.toString()},inbound:{singleSD:inbound.single.toString(),burstSD:inbound.burst.toString(),windowCapSD:inbound.windowCap.toString(),availableSD:inAvailable.toString()}};
   if(side==='bsc'){
    const [principal,capacity]=await Promise.all([app.principalLD(),app.capacityLD()]);
    assert.ok(capacity-principal>=2n*10n**12n);
    row.principalLD=principal.toString();row.capacityLD=capacity.toString();
   }
   rows.push(row);
  }
  const data=adminIface.encodeFunctionData('executeBatch',[targets,payloads]);
  const [gas,fee,native,latestNonce,pendingNonce,block]=await Promise.all([
   admin.executeBatch.estimateGas(targets,payloads,{from:account}),provider.getFeeData(),provider.getBalance(account),provider.getTransactionCount(account,'latest'),provider.getTransactionCount(account,'pending'),provider.getBlockNumber(),
  ]);
  assert.equal(latestNonce,pendingNonce);
  const maximumPrice=fee.maxFeePerGas??fee.gasPrice;
  assert.ok(maximumPrice>0n&&native>gas*maximumPrice*12n/10n);
  const transaction={from:account,to:admins[side],value:'0',data,chainId:cfg.chainId};
  plan.batches.push({side,chainId:cfg.chainId,admin:admins[side],targets,payloads,calldataHash:keccak256(data),transaction});
  report.chains[side]={block,chainId:cfg.chainId,admin:admins[side],rows,latestNonce,pendingNonce,gasEstimate:gas.toString(),maxNetworkFee:formatEther(gas*maximumPrice*12n/10n),nativeBalance:formatEther(native),calldataHash:keccak256(data)};
 }finally{provider.destroy();}
}
await mkdir('research/production/immediate-beta-mainnet',{recursive:true});
const path='research/production/immediate-beta-mainnet/amount-limit-preflight-20260927.json';
await writeFile(path,JSON.stringify(report,null,2)+'\n');
await writeFile('web/immediate-deploy/limits-plan.json',JSON.stringify(plan,null,2)+'\n');
console.log(JSON.stringify({status:report.status,path,chains:Object.fromEntries(Object.entries(report.chains).map(([side,item])=>[side,{block:item.block,gasEstimate:item.gasEstimate,nativeBalance:item.nativeBalance,maxNetworkFee:item.maxNetworkFee,latestNonce:item.latestNonce,pendingNonce:item.pendingNonce,calldataHash:item.calldataHash}]))}));
