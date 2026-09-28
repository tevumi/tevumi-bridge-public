// Read-only preparation. Recheck both nonces immediately before any eventual signing.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {JsonRpcProvider,FetchRequest,getAddress,Contract} from 'ethers';

const address=getAddress(process.argv[2]);
const output=resolve(process.argv[3]??'research/production/public-beta-preparation');
const networks=JSON.parse(await readFile('config/networks.json','utf8'));
const assets=JSON.parse(await readFile('config/meme-candidates.json','utf8')).assets;
const sides={};
try{
 for(const side of ['bsc','arc']){
  const c=networks[side],url=process.env[c.rpcEnv];
  if(!url)throw Error('MISSING_RPC_'+side.toUpperCase());
  const req=new FetchRequest(url);req.timeout=20000;
  const provider=new JsonRpcProvider(req,undefined,{batchMaxCount:1});sides[side]=provider;
  if(Number((await provider.getNetwork()).chainId)!==c.chainId||await provider.getCode(c.endpoint)==='0x')throw Error('NETWORK_OR_ENDPOINT_MISMATCH_'+side.toUpperCase());
 }
 const policy={releaseId:'tevumi-public-beta-1',governanceMode:'direct-eoa',delaySeconds:86400,assets:{}};
 const heads={};
 for(const side of ['bsc','arc']){
  const p=sides[side],latest=await p.getBlock('latest');
  const [startNonce,nativeBalance,accountCode]=await Promise.all([p.getTransactionCount(address,'pending'),p.getBalance(address),p.getCode(address)]);
  if(accountCode!=='0x')throw Error('DEPLOYER_NOT_EOA_'+side.toUpperCase());
  heads[side]={number:latest.number,hash:latest.hash,nativeBalanceWei:nativeBalance.toString()};
  policy[side]={deployer:address,startNonce,governor:address,guardian:address};
 }
 for(const asset of assets){
  const token=new Contract(asset.sourceToken,['function name() view returns(string)','function symbol() view returns(string)','function decimals() view returns(uint8)'],sides.bsc);
  const [name,symbol,decimals]=await Promise.all([token.name(),token.symbol(),token.decimals()]);
  if(name!==asset.sourceName||symbol!==asset.sourceSymbol||Number(decimals)!==18)throw Error('SOURCE_TOKEN_MISMATCH_'+asset.id);
  // Proposal only: 0.000001 per send, 0.000010 burst, 0.000100 window/collateral per asset.
  const limit=['1','10','100'];
  policy.assets[asset.id]={capacityLD:'100000000000000',bsc:{outbound:limit,inbound:limit},arc:{outbound:limit,inbound:limit}};
 }
 await mkdir(output,{recursive:true});
 await writeFile(resolve(output,'proposed-policy.json'),JSON.stringify(policy,null,2)+'\n');
 await writeFile(resolve(output,'proposal-check.json'),JSON.stringify({checkedAt:new Date().toISOString(),status:'USER_APPROVED_PARAMETERS_UNSIGNED',account:address,heads,nonceKind:'pending',limits:{perSend:'0.000001',burst:'0.000010',window:'0.000100',capacity:'0.000100'},limitations:['No mainnet transaction was sent.','The user approved the account and limits; each mainnet transaction still requires wallet signature.','Nonces, balances, contract code and route must be rechecked before signing.']},null,2)+'\n');
 console.log(JSON.stringify({status:'USER_APPROVED_PARAMETERS_UNSIGNED',account:address,heads,output}));
}finally{for(const provider of Object.values(sides))provider.destroy();}
