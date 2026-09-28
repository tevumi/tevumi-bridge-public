import {test,expect} from '@playwright/test';
import {network} from 'hardhat';
import {HDNodeWallet} from 'ethers';

test('local RPC signs a roundtrip and rejects mismatched or repeated transactions',async({request})=>{
 const initial=await(await request.get('/__candidate/state')).json();
 await request.post('/__candidate/reset',{headers:{'X-Candidate-Token':initial.token},data:{}});
 const state=await(await request.get('/__candidate/state')).json();
 const headers={'X-Candidate-Token':state.token};
 const previewResponse=await request.post('/__candidate/preview',{headers,data:{asset:'cat',side:'bsc',account:0,amount:'1'}});
 expect(previewResponse.ok()).toBe(true);
 const preview=(await previewResponse.json()).result;
 const preparedResponse=await request.post('/__candidate/wallet-prepare',{headers,data:{id:preview.id}});
 expect(preparedResponse.ok()).toBe(true);
 const prepared=(await preparedResponse.json()).result;
 const local=await network.create({network:'local',override:{chainId:31337}});
 let signer;
 try{
  const accounts=local.networkConfig.accounts;
  signer=HDNodeWallet.fromPhrase(await accounts.mnemonic._getRawValue(),await accounts.passphrase._getRawValue(),`${accounts.path}/${accounts.initialIndex+1}`);
 }finally{await local.close();}
 expect(signer.address.toLowerCase()).toBe(state.accounts[0].toLowerCase());
 const tx=prepared.tx;
 const sign=async(transaction,to=transaction.to)=>signer.signTransaction({to,nonce:Number(BigInt(transaction.nonce)),chainId:Number(BigInt(transaction.chainId)),data:transaction.data,value:0n,gasLimit:BigInt(transaction.gas),maxFeePerGas:BigInt(transaction.maxFeePerGas),maxPriorityFeePerGas:BigInt(transaction.maxPriorityFeePerGas),type:2});
 const rpc=async(side,method,params)=>{
  const response=await request.post(`/__candidate/rpc/${side}`,{data:{jsonrpc:'2.0',id:1,method,params}});
  expect(response.ok()).toBe(true);return response.json();
 };
 expect((await rpc('bsc','eth_chainId',[])).result).toBe('0x7a69');
 expect((await rpc('bsc','eth_sendRawTransaction',[await sign(tx,state.accounts[0])])).error).toBeTruthy();
 const raw=await sign(tx),sent=await rpc('bsc','eth_sendRawTransaction',[raw]);
 expect(sent.result).toMatch(/^0x[\da-f]{64}$/i);
 expect((await rpc('bsc','eth_sendRawTransaction',[raw])).error).toBeTruthy();
 const recovered=await request.post('/__candidate/wallet-recover',{headers,data:{id:prepared.id,hash:sent.result}});
 expect(recovered.ok()).toBe(true);expect((await recovered.json()).result.status).toBe('confirmed');
 expect((await(await request.get('/__candidate/state')).json()).assets.find(a=>a.id==='cat').balances[0].allowance).toBe('1.0');
 for(const side of ['bsc','arc']){
  const nextPreview=await request.post('/__candidate/preview',{headers,data:{asset:'cat',side,account:0,amount:'1'}});
  expect(nextPreview.ok()).toBe(true);
  const nextPrepared=await request.post('/__candidate/wallet-prepare',{headers,data:{id:(await nextPreview.json()).result.id}});
  expect(nextPrepared.ok()).toBe(true);
  const reservation=(await nextPrepared.json()).result;
  const source=await rpc(side,'eth_sendRawTransaction',[await sign(reservation.tx)]);
  expect(source.result).toMatch(/^0x[\da-f]{64}$/i);
  const result=await request.post('/__candidate/wallet-recover',{headers,data:{id:reservation.id,hash:source.result}});
  expect(result.ok()).toBe(true);expect((await result.json()).result.status).toBe('confirmed');
 }
 const after=await(await request.get('/__candidate/state')).json();
 expect(after.records).toHaveLength(2);expect(after.records.every(record=>record.status==='received')).toBe(true);
 expect(after.assets.find(asset=>asset.id==='cat').principal).toBe('0.0');
});
