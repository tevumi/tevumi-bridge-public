// One-off isolated wallet QA. All writes go to Hardhat in-memory forks.
import {network} from 'hardhat';
import {BrowserProvider, JsonRpcProvider, FetchRequest, JsonRpcSigner, Contract, ContractFactory, HDNodeWallet, Wallet, parseEther, zeroPadValue, ZeroHash, id} from 'ethers';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomBytes, randomUUID, createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {compile} from './compile.mjs';
import {planCandidateTransfer} from '../web/src/production-transfer.js';
import {createServer as createViteServer} from 'vite';

const CHAIN={bsc:31337,arc:31338};
const EID={bsc:30102,arc:30417};
const PORT=5177;
const EXTENSION='akiehbahfhipklocoggncabmhhcamflf';
const EXTENSION_SHA256='7ba00bfe4fe8b0ffb27be1e8fc06506248f1b888cb4f2e5e5e8b1c37f461f262';
const opened=[];
let server, browser, vite;
const report={at:new Date().toISOString(),mode:'isolated-metamask-dual-mainnet-fork',assets:[],passed:false};
const log=(stage,data={})=>console.log(JSON.stringify({stage,...data}));
const reserveOnce=async(url,chain)=>{
 assert.ok(url,`Missing ${chain} RPC`);
 const req=new FetchRequest(url);req.timeout=20000;
 const remote=new JsonRpcProvider(req,undefined,{batchMaxCount:1});
 try{
  assert.equal((await remote.getNetwork()).chainId,BigInt(chain));
  const number=await remote.getBlockNumber()-20;
  const block=await remote.getBlock(number);assert.ok(block);
  return {number,hash:block.hash};
 }finally{remote.destroy();}
};
const reserve=async(url,chain)=>{
 for(let attempt=1;attempt<=3;attempt++){
  try{return await reserveOnce(url,chain);}catch(error){
   if(attempt===3||!['ECONNRESET','ETIMEDOUT','EAI_AGAIN'].includes(error?.code))throw error;
   await new Promise(resolve=>setTimeout(resolve,1000*attempt));
  }
 }
};
const bscBlock=await reserve(process.env.BSC_RPC_URL,56);
const arcBlock=await reserve(process.env.ARC_RPC_URL,5042);
report.blocks={bsc:bscBlock,arc:arcBlock};
log('fork-blocks',report.blocks);
try {
 const build=compile();
 const artifact=name=>{const item=Object.values(build).find(x=>x[name])?.[name];assert.ok(item,`No artifact ${name}`);return item;};
 const makeSide=async(side,forkUrl,block)=>{
  const local=await network.create({network:'local',override:{chainId:CHAIN[side],hardfork:'cancun',forking:{url:forkUrl,blockNumber:block.number}}});
  opened.push(local);
  await local.provider.request({method:'evm_mine',params:[]});
  const p=new BrowserProvider(local.provider,undefined,{cacheTimeout:-1});
  const admin=await p.getSigner(0),alice=await p.getSigner(1),bob=await p.getSigner(2),guardian=await p.getSigner(3);
  const deploy=async(name,args)=>{const art=artifact(name);const contract=await new ContractFactory(art.abi,'0x'+art.evm.bytecode.object,admin).deploy(...args);await contract.waitForDeployment();return contract;};
  const ep=await deploy('MockEndpoint',[EID[side]]);
  const tl=await deploy('BridgeTimelock',[86400,await admin.getAddress()]);
  let seq=0;
  const govern=async(calls)=>{
   const targets=await Promise.all(calls.map(([c])=>c.getAddress()));
   const values=calls.map(()=>0);
   const data=calls.map(([c,fn,args])=>c.interface.encodeFunctionData(fn,args));
   const salt=id(side+'-wallet-qa-'+(++seq));
   await(await tl.scheduleBatch(targets,values,data,ZeroHash,salt,86400)).wait();
   await local.provider.request({method:'evm_increaseTime',params:[86400]});
   await local.provider.request({method:'evm_mine',params:[]});
   await(await tl.executeBatch(targets,values,data,ZeroHash,salt)).wait();
  };
  return {side,local,p,admin,alice,bob,guardian,deploy,ep,tl,govern};
 };
 const b=await makeSide('bsc',process.env.BSC_RPC_URL,bscBlock);
 const a=await makeSide('arc',process.env.ARC_RPC_URL,arcBlock);
 const alice=await b.alice.getAddress();assert.equal(alice.toLowerCase(),(await a.alice.getAddress()).toLowerCase());
 const donor='0xf977814e90da44bfa03b6295a0616a897441acec';
 await b.local.provider.request({method:'hardhat_impersonateAccount',params:[donor]});
 await b.local.provider.request({method:'hardhat_setBalance',params:[donor,'0x56bc75e2d63100000']});
 const donorSigner=new JsonRpcSigner(b.p,donor);
 const assets=JSON.parse(await readFile('config/meme-candidates.json','utf8')).assets;
 const limits=[1000n*10n**6n,10000n*10n**6n,20000n*10n**6n];
 const cases=[];
 for(const selected of assets){
  const cached=JSON.parse(await readFile('research/'+selected.sourceToken.toLowerCase()+'.sourcify.json','utf8'));
  const token=new Contract(selected.sourceToken,cached.abi,b.admin);
  assert.equal(await token.name(),selected.sourceName);
  assert.equal(await token.symbol(),selected.sourceSymbol);
  await(await token.connect(donorSigner).transfer(alice,parseEther('1'))).wait();
  const adapter=await b.deploy('GovernedAdapter',[selected.sourceToken,await b.ep.getAddress(),await b.tl.getAddress(),await b.guardian.getAddress(),parseEther('10'),limits,limits]);
  const oft=await a.deploy('GovernedOFT',[selected.sourceName,selected.sourceSymbol,selected.sourceToken,await a.ep.getAddress(),await a.tl.getAddress(),await a.guardian.getAddress(),limits,limits]);
  const ba=await adapter.getAddress(),aa=await oft.getAddress();
  await b.govern([[adapter,'setPeer',[EID.arc,zeroPadValue(aa,32)]],[adapter,'setPauses',[false,false]]]);
  await a.govern([[oft,'setPeer',[EID.bsc,zeroPadValue(ba,32)]],[oft,'setPauses',[false,false]]]);
  cases.push({id:selected.id,token,adapter,oft,ba,aa});
  log('prepared',{asset:selected.id,token:selected.sourceToken,adapter:ba,oft:aa});
 }
 const providers={bsc:b.local.provider,arc:a.local.provider};
 const forkState={runId:randomUUID(),networks:{bsc:{chainId:CHAIN.bsc,eid:EID.bsc,endpoint:await b.ep.getAddress(),rpc:'http://127.0.0.1:'+PORT+'/rpc/bsc'},arc:{chainId:CHAIN.arc,eid:EID.arc,endpoint:await a.ep.getAddress(),rpc:'http://127.0.0.1:'+PORT+'/rpc/arc'}},assets:Object.fromEntries(cases.map(item=>[item.id,{sourceToken:item.token.target,bsc:item.ba,arc:item.aa}]))};
 vite=await createViteServer({configFile:false,root:resolve('web'),server:{middlewareMode:true,fs:{strict:true,allow:[resolve('web'),resolve('node_modules')],deny:['.env','.env.*','**/.local/**']}} ,appType:'custom'});
 const allowRead=/^(eth_(chainId|blockNumber|getBlockByNumber|getBlockByHash|getCode|call|estimateGas|getBalance|getTransactionCount|getTransactionByHash|getTransactionReceipt|getLogs|gasPrice|maxPriorityFeePerGas|feeHistory|sendRawTransaction)|net_version)$/;
 server=createServer(async(req,res)=>{
  if(req.url==='/'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Tevumi isolated fork wallet QA</title><h1>Tevumi isolated fork wallet QA</h1>');return;}
  if(req.url==='/__fork/state'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(forkState));return;}
  if(req.url==='/bridge.html'&&req.method==='GET'){
   const source=await readFile('web/bridge.html','utf8');
   assert.ok(source.includes('src="/src/product.js"'),'Product entry point changed');
   const html=source.replace('src="/src/product.js"','src="/src/production-fork-product.js"');
   res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end(await vite.transformIndexHtml('/bridge.html',html));return;
  }
  if(!req.url?.startsWith('/rpc/')){vite.middlewares(req,res);return;}
  const side=req.url?.split('?')[0].slice(5);
  const origin=req.headers.origin;
  if(origin&&origin!=='http://127.0.0.1:'+PORT&&origin!=='chrome-extension://'+EXTENSION){res.writeHead(403);res.end();return;}
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':origin??'http://127.0.0.1:'+PORT,'Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST, OPTIONS'});res.end();return;}
  if(!providers[side]||req.method!=='POST'||!req.url.startsWith('/rpc/')||req.headers.host!=='127.0.0.1:'+PORT){res.writeHead(403);res.end();return;}
  try{
   let body='';for await(const chunk of req){body+=chunk;if(body.length>200000)throw Error('too large');}
   const data=JSON.parse(body);assert.match(data.method,allowRead);
   const result=data.method==='net_version'?String(CHAIN[side]):await providers[side].request({method:data.method,params:data.params??[]});
   res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':origin??'http://127.0.0.1:'+PORT});res.end(JSON.stringify({jsonrpc:'2.0',id:data.id,result}));
  }catch(error){res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':origin??'http://127.0.0.1:'+PORT});res.end(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:typeof error.code==='number'?error.code:-32000,message:'Isolated fork request failed',data:typeof error.data==='string'?error.data:undefined}}));}
 });
 await new Promise(resolve=>server.listen(PORT,'127.0.0.1',resolve));
 log('rpc-ready',{port:PORT});
 const archive=await readFile('.local/metamask-qa/metamask-chrome-13.49.0.zip');
 assert.equal(createHash('sha256').update(archive).digest('hex'),EXTENSION_SHA256);
 const ext=resolve('.local/metamask-qa/extension');
 const profile=resolve('.local/metamask-qa/profile-'+randomUUID());
 browser=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:false,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
 const home=browser.pages().find(x=>x.url().startsWith('chrome-extension:'))??await browser.waitForEvent('page');
 await home.getByText('导入现有钱包',{exact:true}).waitFor({timeout:30000});
 await home.getByText('导入现有钱包',{exact:true}).click();
 await home.getByText('使用私钥助记词导入',{exact:true}).click();
 await home.locator('textarea').click();
 await home.keyboard.type(Wallet.createRandom().mnemonic.phrase,{delay:15});
 await home.getByRole('button',{name:'继续'}).click();
 await home.locator('input[type=password]').first().waitFor();
 const password=randomBytes(18).toString('base64url');
 await home.locator('input[type=password]').nth(0).fill(password);
 await home.locator('input[type=password]').nth(1).fill(password);
 await home.locator('input[type=checkbox]').check();
 await home.getByRole('button',{name:'创建密码'}).click();
 await home.getByText('以后再说',{exact:true}).click();
 await home.locator('input[type=checkbox]').nth(0).uncheck();
 await home.getByRole('button',{name:'继续'}).click();
 await home.getByText('打开钱包',{exact:true}).click();
 await home.waitForTimeout(2000);
 await home.goto('chrome-extension://'+EXTENSION+'/home.html');
 await home.waitForTimeout(2500);
 await home.getByText('Account 1',{exact:true}).first().click();
 await home.getByText('添加钱包',{exact:true}).click();
 await home.getByText('导入账户',{exact:true}).click();
 const config=b.local.networkConfig.accounts;
 const testSigner=HDNodeWallet.fromPhrase(await config.mnemonic._getRawValue(),await config.passphrase._getRawValue(),config.path+'/'+(config.initialIndex+1));
 assert.equal(testSigner.address.toLowerCase(),alice.toLowerCase());
 await home.locator('input[type=password]').fill(testSigner.privateKey);
 await home.getByRole('button',{name:'导入',exact:true}).click();
 await home.waitForURL(url=>url.hash==='#/',{timeout:30000});
 const app=await browser.newPage();await app.goto('http://127.0.0.1:'+PORT+'/');
 assert.equal(await app.evaluate(()=>window.ethereum?.isMetaMask),true);
 const popupUrl='chrome-extension://'+EXTENSION+'/popup-init.html';
 const confirm=async(pending,match)=>{
  const popup=await browser.newPage();await popup.goto(popupUrl);
  if(match)await popup.getByText(match,{exact:false}).first().waitFor({timeout:15000});
  const shown=(await popup.locator('body').innerText()).slice(-500);
  await popup.getByRole('button',{name:'确认',exact:true}).click();
  const result=await pending;
  return {result,shown};
 };
 const request=(method,params=[])=>app.evaluate(({method,params})=>window.ethereum.request({method,params}),{method,params});
 const connection=request('eth_requestAccounts');
 const connectPopup=await browser.newPage();await connectPopup.goto(popupUrl);
 await connectPopup.getByRole('button',{name:'连接',exact:true}).click();
 assert.equal((await connection)[0].toLowerCase(),alice.toLowerCase());
 log('wallet-connected',{address:alice});
 const addedNetworks=new Set();
 const select=async side=>{
  const chainId='0x'+CHAIN[side].toString(16);
  if(!addedNetworks.has(side)){
   const add=request('wallet_addEthereumChain',[{chainId,chainName:'Tevumi QA '+side.toUpperCase(),rpcUrls:['http://127.0.0.1:'+PORT+'/rpc/'+side],nativeCurrency:{name:'Local ETH',symbol:'ETH',decimals:18}}]);
   await confirm(add,'Tevumi QA '+side.toUpperCase());addedNetworks.add(side);
  }
  if((await request('eth_chainId')).toLowerCase()!==chainId){
   const switchRequest=request('wallet_switchEthereumChain',[{chainId}]);
   const early=await Promise.race([switchRequest.then(()=>true,error=>{throw error;}),new Promise(resolve=>setTimeout(()=>resolve(false),800))]);
   if(!early)await confirm(switchRequest);
  }
  assert.equal((await request('eth_chainId')).toLowerCase(),chainId);
  log('wallet-network',{side,chainId});
 };
 const sign=async(side,to,data,amount='0x0')=>{
  assert.equal((await request('eth_chainId')).toLowerCase(),'0x'+CHAIN[side].toString(16));
  const tx=request('eth_sendTransaction',[{from:alice,to,data,value:amount}]);
  const {result:hash,shown}=await confirm(tx);
  assert.match(hash,/^0x[0-9a-f]{64}$/i);
  const receipt=await (side==='bsc'?b.p:a.p).getTransactionReceipt(hash);
  assert.equal(receipt.status,1);
  return {hash,shown,receipt};
 };
 const packet=(receipt,ep)=>{
  const found=receipt.logs.filter(x=>x.address.toLowerCase()===ep.target.toLowerCase()).map(x=>{try{return ep.interface.parseLog(x);}catch{return null;}}).find(x=>x?.name==='Packet');
  assert.ok(found,'Missing local packet');return found.args;
 };
 const amount=parseEther('0.000001');
 const networks={bsc:{chainId:CHAIN.bsc,eid:EID.bsc,endpoint:await b.ep.getAddress()},arc:{chainId:CHAIN.arc,eid:EID.arc,endpoint:await a.ep.getAddress()}};
 const readProviders={bsc:b.p,arc:a.p};
 const planFor=(item,side)=>planCandidateTransfer({providers:readProviders,networks,pair:{sourceToken:item.token.target,bsc:item.ba,arc:item.aa},side,account:alice,amount:'0.000001',extraOptions:'0x'});
 await assert.rejects(planCandidateTransfer({providers:readProviders,networks,pair:{sourceToken:cases[0].token.target,bsc:cases[0].ba,arc:cases[1].aa},side:'bsc',account:alice,amount:'0.000001',extraOptions:'0x'}),/双向可信合约不匹配/);
 await b.govern([[cases[0].adapter,'setPauses',[true,false]]]);
 await assert.rejects(planFor(cases[0],'bsc'),/发送或目标接收已暂停/);
 await b.govern([[cases[0].adapter,'setPauses',[false,false]]]);
 log('planner-guards-passed',{wrongPeer:true,paused:true});
 await select('bsc');
 for(const item of cases){
  const row={asset:item.id};report.assets.push(row);
  const approvalPlan=await planFor(item,'bsc');assert.equal(approvalPlan.key,'approve');
  const approval=await sign('bsc',approvalPlan.to,approvalPlan.data);
  row.approvalHash=approval.hash;
  assert.equal(await item.token.allowance(alice,item.ba),amount);
  const forwardPlan=await planFor(item,'bsc');assert.equal(forwardPlan.key,'send');
  const forward=await sign('bsc',forwardPlan.to,forwardPlan.data,'0x'+forwardPlan.value.toString(16));
  row.forwardHash=forward.hash;
  assert.equal(await item.adapter.principalLD(),amount);
  await(await a.ep.deliver(item.aa,[EID.bsc,zeroPadValue(item.ba,32),packet(forward.receipt,b.ep).nonce],packet(forward.receipt,b.ep).guid,packet(forward.receipt,b.ep).message,{gasLimit:2000000})).wait();
  assert.equal(await item.oft.balanceOf(alice),amount);
  log('forward-confirmed',{asset:item.id,approvalHash:approval.hash,forwardHash:forward.hash});
 }
 await select('arc');
 for(const item of cases){
  const row=report.assets.find(x=>x.asset===item.id);
  const returnPlan=await planFor(item,'arc');assert.equal(returnPlan.key,'send');
  const back=await sign('arc',returnPlan.to,returnPlan.data,'0x'+returnPlan.value.toString(16));
  row.returnHash=back.hash;
  const outgoing=packet(back.receipt,a.ep);
  await(await b.ep.deliver(item.ba,[EID.arc,zeroPadValue(item.aa,32),outgoing.nonce],outgoing.guid,outgoing.message,{gasLimit:2000000})).wait();
  assert.equal(await item.adapter.principalLD(),0n);
  assert.equal(await item.oft.totalSupply(),0n);
  assert.equal(await item.token.allowance(alice,item.ba),0n);
  assert.equal(await item.token.balanceOf(alice),parseEther('1'));
  row.final={bscBalance:parseEther('1').toString(),arcBalance:'0',allowance:'0',principal:'0'};
  log('return-confirmed',{asset:item.id,returnHash:back.hash});
 }
 // Reuse the real product document with a local-only candidate controller.
 // This is a second complete roundtrip through product controls, not a mainnet page.
 log('product-page-switch-start');await select('bsc');log('product-page-switch-ready');
 const pageErrors=[];app.on('pageerror',error=>pageErrors.push(error.message));
 await app.goto('http://127.0.0.1:'+PORT+'/bridge.html');
 log('product-page-loaded',{title:await app.title(),connect:await app.locator('#connect').textContent(),pageErrors});
 await app.evaluate(()=>document.getElementById('connect').click());
 await app.waitForTimeout(1000);
 log('product-page-connect',{message:await app.locator('#message').textContent(),connect:await app.locator('#connect').textContent(),pageErrors});
 if((await app.locator('#connect').textContent()).includes('连接隔离钱包')){
  const popup=await browser.newPage();await popup.goto(popupUrl);
  const connectButton=popup.getByRole('button',{name:'连接',exact:true});
  if(await connectButton.isVisible())await connectButton.click();
  await popup.close().catch(()=>{});
 }
 await app.getByText('隔离钱包已连接',{exact:false}).waitFor({timeout:15000});
 const uiConfirm=async()=>{
  await app.locator('#flow-ack').check();
  await app.locator('#flow-sign').click();
  const popup=await browser.newPage();await popup.goto(popupUrl);
  await popup.getByRole('button',{name:'确认',exact:true}).click();
  await popup.close().catch(()=>{});
 };
 const uiHash=async()=>{
  await app.locator('#flow-review').waitFor({state:'hidden',timeout:30000});
  const text=await app.locator('#operations p').innerText();
  const hash=text.match(/0x[0-9a-f]{64}/i)?.[0];assert.match(hash??'',/^0x[0-9a-f]{64}$/i);return hash;
 };
 for(const item of cases){
  await select('bsc');await app.locator('#choose-bsc').click();
  await app.locator('#asset-select').selectOption(item.id);
  await app.locator('#prepare-send').click();
  await app.getByText('确认精确授权',{exact:true}).waitFor({timeout:20000});
  await uiConfirm();
  await app.getByText('确认跨链发送',{exact:true}).waitFor({timeout:30000});
  await uiConfirm();
  const forwardHash=await uiHash(),forwardReceipt=await b.p.getTransactionReceipt(forwardHash);
  assert.equal(forwardReceipt.status,1);
  const forwardPacket=packet(forwardReceipt,b.ep);
  await(await a.ep.deliver(item.aa,[EID.bsc,zeroPadValue(item.ba,32),forwardPacket.nonce],forwardPacket.guid,forwardPacket.message,{gasLimit:2000000})).wait();
  await app.reload();await app.getByRole('button',{name:'连接隔离钱包'}).waitFor({timeout:15000});await app.evaluate(()=>document.getElementById('connect').click());
  await app.waitForTimeout(1000);log('product-page-reload',{asset:item.id,connect:await app.locator('#connect').textContent(),message:await app.locator('#message').textContent(),operations:await app.locator('#operations').textContent(),pageErrors});
  await app.waitForFunction(hash=>document.querySelector('#operations p')?.textContent?.includes(hash),forwardHash,{timeout:15000});
  await app.locator('a[data-view="history"]').click();
  await app.locator('#refresh-operations').click();
  await app.locator('#operations').getByText('目标链到账事件已核验',{exact:false}).waitFor({timeout:15000});
  await app.locator('a[data-view="bridge"]').click();
  await select('arc');await app.locator('#choose-arc').click();
  await app.locator('#prepare-send').click();
  await app.getByText('确认跨链发送',{exact:true}).waitFor({timeout:20000});
  await uiConfirm();
  const returnHash=await uiHash(),returnReceipt=await a.p.getTransactionReceipt(returnHash);
  assert.equal(returnReceipt.status,1);
  const returnPacket=packet(returnReceipt,a.ep);
  await(await b.ep.deliver(item.ba,[EID.arc,zeroPadValue(item.aa,32),returnPacket.nonce],returnPacket.guid,returnPacket.message,{gasLimit:2000000})).wait();
  await app.locator('a[data-view="history"]').click();
  await app.locator('#refresh-operations').click();
  await app.locator('#operations').getByText('目标链到账事件已核验',{exact:false}).waitFor({timeout:15000});
  await app.locator('a[data-view="bridge"]').click();
  assert.equal(await item.adapter.principalLD(),0n);
  assert.equal(await item.oft.totalSupply(),0n);
  assert.equal(await item.token.allowance(alice,item.ba),0n);
  assert.equal(await item.token.balanceOf(alice),parseEther('1'));
  report.assets.find(x=>x.asset===item.id).productPage={forwardHash,returnHash};
  log('product-page-roundtrip',{asset:item.id,forwardHash,returnHash});
 }
 const bob=await b.bob.getAddress();assert.equal(bob.toLowerCase(),(await a.bob.getAddress()).toLowerCase());
 for(const item of cases){
  await(await item.token.connect(donorSigner).transfer(bob,parseEther('1'))).wait();
  const pair={sourceToken:item.token.target,bsc:item.ba,arc:item.aa};
  const planForBob=side=>planCandidateTransfer({providers:readProviders,networks,pair,side,account:bob,amount:'0.000001',extraOptions:'0x'});
  const approve=await planForBob('bsc');assert.equal(approve.key,'approve');
  await(await b.bob.sendTransaction({to:approve.to,data:approve.data})).wait();
  const forward=await planForBob('bsc');assert.equal(forward.key,'send');
  const forwardReceipt=await(await b.bob.sendTransaction({to:forward.to,data:forward.data,value:forward.value})).wait();
  const forwardPacket=packet(forwardReceipt,b.ep);
  await(await a.ep.deliver(item.aa,[EID.bsc,zeroPadValue(item.ba,32),forwardPacket.nonce],forwardPacket.guid,forwardPacket.message,{gasLimit:2000000})).wait();
  assert.equal(await item.oft.balanceOf(bob),amount);
  const back=await planForBob('arc');assert.equal(back.key,'send');
  const returnReceipt=await(await a.bob.sendTransaction({to:back.to,data:back.data,value:back.value})).wait();
  const returnPacket=packet(returnReceipt,a.ep);
  await(await b.ep.deliver(item.ba,[EID.arc,zeroPadValue(item.aa,32),returnPacket.nonce],returnPacket.guid,returnPacket.message,{gasLimit:2000000})).wait();
  assert.equal(await item.token.balanceOf(bob),parseEther('1'));
  assert.equal(await item.token.allowance(bob,item.ba),0n);
  assert.equal(await item.adapter.principalLD(),0n);
  assert.equal(await item.oft.totalSupply(),0n);
  report.assets.find(x=>x.asset===item.id).secondAccount={account:bob,forwardHash:forwardReceipt.hash,returnHash:returnReceipt.hash};
  log('second-account-roundtrip',{asset:item.id,account:bob,forwardHash:forwardReceipt.hash,returnHash:returnReceipt.hash});
 }
 assert.deepEqual(pageErrors,[]);
 report.passed=true;
 await mkdir('research/production',{recursive:true});
 await writeFile('research/production/wallet-fork.json',JSON.stringify(report,null,2)+'\n');
 log('passed',{blocks:report.blocks,assets:report.assets});
}catch(error){const message=String(error?.message??'').replace(/https?:\/\/\S+/g,'[url]').replace(/0x[a-fA-F0-9]{64}/g,'[hash]').slice(0,240);log('failed',{name:error?.name??'Error',message});process.exitCode=1;}
finally{if(browser)await browser.close().catch(()=>{});if(server)await new Promise(resolve=>server.close(resolve));if(vite)await vite.close().catch(()=>{});for(const item of opened)await item.close().catch(()=>{});}
