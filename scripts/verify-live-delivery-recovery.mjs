import {chromium} from '@playwright/test';
import {FetchRequest,JsonRpcProvider,keccak256,Interface} from 'ethers';
import {readFileSync} from 'node:fs';

// Read-only replay of a publicly verified transfer. No wallet send is allowed.
const origin=process.env.TEVUMI_BASE_URL || 'http://127.0.0.1:5190/preview/web/preview/';
const account='0x67bfb3BeF4f4A3Cb25Bc529E948d40bcfc0874CD';
const hash='0x37709766402a213e07d491df151b9c6d416a9f26c1b83f0a0feb33cf5a600201';
const destinationHash='0x58136fad15ac9f4cac33374707e6561d5806044d595f74b6df896dae80e2e2a8';
const config=JSON.parse(readFileSync('config/networks.json','utf8'));
const providers={};
for(const side of ['bsc','arc']){
 const request=new FetchRequest(process.env[config[side].rpcEnv]||config[side].rpc);request.timeout=20000;
 providers[side]=new JsonRpcProvider(request,config[side].chainId,{staticNetwork:true,batchMaxCount:1});
}
let browser,stage="receipts";
try{
 const [tx,sourceReceipt,targetReceipt]=await Promise.all([
  providers.bsc.send('eth_getTransactionByHash',[hash]),providers.bsc.send('eth_getTransactionReceipt',[hash]),providers.arc.send('eth_getTransactionReceipt',[destinationHash]),
 ]);
 if(tx.from.toLowerCase()!==account.toLowerCase()||sourceReceipt.status!=='0x1'||targetReceipt.status!=='0x1')throw Error('REPLAY_RECEIPTS_INVALID');
 const iface=new Interface(['event OFTSent(bytes32 indexed guid,uint32 dstEid,address indexed fromAddress,uint256 amountSentLD,uint256 amountReceivedLD)','event OFTReceived(bytes32 indexed guid,uint32 srcEid,address indexed toAddress,uint256 amountReceivedLD)']);
 const sent=sourceReceipt.logs.filter(log=>log.address.toLowerCase()==='0xac93aa5dfd4dff9fc57c470fc6c9172f7a9bfbcf').map(log=>{try{return iface.parseLog(log);}catch{return null;}}).find(event=>event?.name==='OFTSent');
 if(!sent||!targetReceipt.logs.some(log=>{try{const event=iface.parseLog(log);return event.name==='OFTReceived'&&event.args.guid===sent.args.guid&&event.args.toAddress.toLowerCase()===account.toLowerCase()&&event.args.amountReceivedLD===sent.args.amountReceivedLD;}catch{return false;}}))throw Error('REPLAY_EVENT_MISMATCH');
 stage="browser"; browser=await chromium.launch({headless:true});
 for(const [label,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
  const page=await browser.newPage({viewport});let sends=0;const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route(/https:\/\/(rpc\.mainnet\.arc\.io|bsc[^/]*|bsc-dataseed[^/]*)\//,async route=>{
   if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});return;}
   const request=route.request().postDataJSON(),side=route.request().url().includes('arc.io')?'arc':'bsc';
   const run=async q=>{try{if(!/^eth_(chainId|call|getCode|getBalance|gasPrice|getBlockByNumber|getBlockNumber|blockNumber|getTransactionByHash|getTransactionReceipt|getTransactionCount|getLogs|maxPriorityFeePerGas)$/.test(q.method))throw Error('FORBIDDEN_RPC');return{jsonrpc:'2.0',id:q.id,result:await providers[side].send(q.method,q.params??[])};}catch{return{jsonrpc:'2.0',id:q.id,error:{code:-32000,message:'Read-only replay unavailable'}};}};
   await route.fulfill({json:Array.isArray(request)?await Promise.all(request.map(run)):await run(request),headers:{'access-control-allow-origin':'*'}});
  });
  await page.route('https://scan.layerzero-api.com/**',route=>route.fulfill({json:{data:[{guid:sent.args.guid,pathway:{srcEid:30102,dstEid:30417},destination:{tx:{txHash:destinationHash}}}]}}));
  await page.exposeFunction('unexpectedSend',()=>{sends++;throw Error('WALLET_SEND_FORBIDDEN');});
  await page.addInitScript(({account,record})=>{
   sessionStorage.setItem('tevumi:wallet-session:v1',JSON.stringify({kind:'metamask',name:'MetaMask',rdns:'io.metamask',account}));
   const key='tevumi-immediate-wotr-live-v1:'+account.toLowerCase();
   if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({'send-bsc':record}));
   const provider={isMetaMask:true,on:()=>{},removeListener:()=>{},request:async({method})=>{if(method==='eth_accounts')return[account];if(method==='eth_chainId')return'0x38';return window.unexpectedSend();}};
   window.ethereum=provider;window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{name:'MetaMask',rdns:'io.metamask'},provider}})));
  },{account,record:{hash,account,to:"0xAC93aA5DFD4dFF9FC57C470FC6C9172F7a9bfbcf",dataHash:keccak256(tx.input),amountLD:String(sent.args.amountSentLD)}});
  stage="page-recovery"; await page.goto(origin,{waitUntil:'domcontentloaded'});await page.locator('#nav-bridge').click();
  await page.locator('#send-bsc').waitFor({state:'visible',timeout:60000});
  await page.waitForFunction(()=>!document.querySelector('#send-bsc').disabled,{timeout:60000});
  await page.locator('[data-language="zh-CN"]').click();
  if(await page.locator('#send-bsc').textContent()!=='授权并跨链'||await page.locator('#check-arc').isVisible())throw Error('NORMAL_ACTION_NOT_RESTORED');
  const record=await page.evaluate(account=>JSON.parse(localStorage.getItem('tevumi-immediate-wotr-live-v1:'+account.toLowerCase()))['send-bsc'],account);
  if(record.deliveredHash!==destinationHash||sends||errors.length)throw Error('RECOVERY_FAILED');
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('#nav-bridge').click();await page.locator('#send-bsc').waitFor({state:'visible',timeout:30000});
  if(sends)throw Error('RECOVERY_SENT_TRANSACTION');
  console.log(JSON.stringify({label,status:'RESTORED_APPROVE_AND_BRIDGE',source:hash,destination:destinationHash,walletRequests:sends}));await page.close();
 }
}catch(error){console.error('Read-only recovery verification failed at '+stage+' ('+(String(error.message).startsWith('REPLAY_')?error.message:error.name)+'); RPC details omitted.');process.exitCode=1;}
finally{await browser?.close();for(const provider of Object.values(providers))await provider.destroy();}
