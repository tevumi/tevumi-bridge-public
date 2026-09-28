import {test,expect} from '@playwright/test';
import {network} from 'hardhat';
import {HDNodeWallet} from 'ethers';

test('wallet page confirms a signed local roundtrip through the restricted RPC',async({page,request})=>{
 const before=await(await request.get('/__candidate/state')).json();
 await request.post('/__candidate/reset',{headers:{'X-Candidate-Token':before.token},data:{}});
 const initial=await(await request.get('/__candidate/state')).json();
 const local=await network.create({network:'local',override:{chainId:31337}});let signer;
 try{const accounts=local.networkConfig.accounts;signer=HDNodeWallet.fromPhrase(await accounts.mnemonic._getRawValue(),await accounts.passphrase._getRawValue(),`${accounts.path}/${accounts.initialIndex+1}`);}
 finally{await local.close();}
 expect(signer.address.toLowerCase()).toBe(initial.accounts[0].toLowerCase());
 await page.exposeFunction('sendSignedCandidate',async tx=>{
  const raw=await signer.signTransaction({to:tx.to,nonce:Number(BigInt(tx.nonce)),chainId:Number(BigInt(tx.chainId)),data:tx.data,value:0n,gasLimit:BigInt(tx.gas),maxFeePerGas:BigInt(tx.maxFeePerGas),maxPriorityFeePerGas:BigInt(tx.maxPriorityFeePerGas),type:2});
  const side=BigInt(tx.chainId)===31337n?'bsc':'arc';
  const response=await request.post(`/__candidate/rpc/${side}`,{data:{jsonrpc:'2.0',id:1,method:'eth_sendRawTransaction',params:[raw]}});
  const result=await response.json();if(result.error)throw Error(result.error.message);return result.result;
 });
 await page.addInitScript(({account})=>{
  const handlers={};let chain='0x7a69',connected=false;
  window.ethereum={on:(event,handler)=>(handlers[event]??=[]).push(handler),request:async({method,params})=>{
   if(method==='eth_requestAccounts'){connected=true;return [account];}
   if(method==='eth_accounts')return connected?[account]:[];
   if(method==='eth_chainId')return chain;
   if(method==='wallet_switchEthereumChain'){chain=params[0].chainId;for(const handler of handlers.chainChanged??[])handler(chain);return null;}
   if(method==='eth_sendTransaction')return window.sendSignedCandidate(params[0]);
   throw Error('Unsupported local wallet request');
  }};
 },{account:initial.accounts[0]});
 await page.goto('/bridge.html?wallet=1');await page.locator('#connect').click();
 const confirm=async()=>{await page.locator('#flow-ack').check();await page.locator('#flow-sign').click();};
 await page.locator('#prepare-send').click();await expect(page.locator('#flow-review')).toBeVisible();
 await confirm();await expect(page.locator('#flow-title')).toHaveText('确认跨链发送');
 await confirm();await expect(page.locator('#flow-review')).not.toBeVisible();
 expect((await(await request.get('/__candidate/state')).json()).assets[0].balances[0].arc).toBe('1.0');
 await page.locator('#choose-arc').click();await expect(page.locator('#source-label')).toContainText('Arc');
 await page.locator('#prepare-send').click();await expect(page.locator('#flow-review')).toBeVisible();
 await confirm();await expect(page.locator('#flow-review')).not.toBeVisible();
 const after=await(await request.get('/__candidate/state')).json();
 expect(after.records).toHaveLength(2);expect(after.records.every(record=>record.status==='received')).toBe(true);
 expect(after.assets[0].principal).toBe('0.0');
});
