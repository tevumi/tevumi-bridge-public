// Read-only mainnet check. No signer and no transaction broadcast.
import {readFile,writeFile} from 'node:fs/promises';
import {JsonRpcProvider,FetchRequest,formatEther} from 'ethers';

const plan=JSON.parse(await readFile('research/production/public-beta-unsigned/manifest.json','utf8'));
const policy=JSON.parse(await readFile('research/production/public-beta-preparation/proposed-policy.json','utf8'));
const rehearsal=JSON.parse(await readFile('research/production/public-beta-unsigned/fork-rehearsal.json','utf8'));
const networks=JSON.parse(await readFile('config/networks.json','utf8'));
const result={checkedAt:new Date().toISOString(),status:'CHECKING',chains:{},limitations:['Read-only estimates; wallet fee quote and mainnet conditions can change.','No signature or mainnet transaction was sent.']};
if(!rehearsal.passed)throw Error('FORK_REHEARSAL_NOT_PASSED');
for(const side of ['bsc','arc']){
 const config=networks[side],url=process.env[config.rpcEnv];if(!url)throw Error('MISSING_RPC_'+side.toUpperCase());
 const request=new FetchRequest(url);request.timeout=30000;
 const provider=new JsonRpcProvider(request,undefined,{batchMaxCount:1});
 try{
  const account=policy[side].deployer,items=plan.deployments.filter(x=>x.side===side);
  const [network,nonce,balance,fee,code]=await Promise.all([provider.getNetwork(),provider.getTransactionCount(account,'pending'),provider.getBalance(account),provider.getFeeData(),provider.getCode(account)]);
  if(Number(network.chainId)!==config.chainId||nonce!==policy[side].startNonce||code!=='0x')throw Error('NETWORK_NONCE_OR_ACCOUNT_CHANGED_'+side.toUpperCase());
  const price=fee.maxFeePerGas??fee.gasPrice;if(price==null)throw Error('NO_FEE_QUOTE_'+side.toUpperCase());
  const estimates=rehearsal.chains[side].deployed.map(x=>({id:x.id,gas:x.gasUsed}));
  if(estimates.length!==items.length||estimates.some((x,i)=>x.id!==items[i].id))throw Error('REHEARSAL_PLAN_MISMATCH_'+side.toUpperCase());
  const gasTotal=estimates.reduce((sum,x)=>sum+BigInt(x.gas),0n);
  const buffered=gasTotal*12n/10n,estimatedFee=buffered*price;
  result.chains[side]={chainId:config.chainId,account,nonce,balanceWei:balance.toString(),balance:formatEther(balance),gasPriceWei:price.toString(),gasEstimate:gasTotal.toString(),bufferedGas:buffered.toString(),estimatedFeeWei:estimatedFee.toString(),estimatedFee:formatEther(estimatedFee),balanceCoversEstimate:balance>=estimatedFee,deployments:estimates};
 }finally{provider.destroy();}
}
result.status=Object.values(result.chains).every(x=>x.balanceCoversEstimate)?'READ_ONLY_READY_TO_REQUEST_SIGNATURES':'INSUFFICIENT_ESTIMATED_NATIVE_BALANCE';
await writeFile('research/production/public-beta-unsigned/readiness.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,chains:Object.fromEntries(Object.entries(result.chains).map(([side,c])=>[side,{nonce:c.nonce,balance:c.balance,estimatedFee:c.estimatedFee,gasEstimate:c.gasEstimate}]))}));
if(result.status!=='READ_ONLY_READY_TO_REQUEST_SIGNATURES')process.exitCode=1;
