import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as ethers from 'ethers';
import {candidateAppAbi,candidateTokenAbi} from '../web/src/production-transfer.js';
import {wotrRoutes} from '../web/src/wotr-routes.js';

const account='0x67bfb3BeF4f4A3Cb25Bc529E948d40bcfc0874CD';
const source=wotrRoutes.current.bsc;
const target=wotrRoutes.current.arc;
const hash='0x'+'1'.repeat(64),targetHash='0x'+'2'.repeat(64),guid='0x'+'3'.repeat(64);
const amount=ethers.parseEther('1000'),data='0x1234';
const iface=new ethers.Interface([
 'event OFTSent(bytes32 indexed guid,uint32 dstEid,address indexed fromAddress,uint256 amountSentLD,uint256 amountReceivedLD)',
 'event OFTReceived(bytes32 indexed guid,uint32 srcEid,address indexed toAddress,uint256 amountReceivedLD)',
]);
function setup({targetStart=100,targetAmount=amount,badCall=false,unconfirmed=false,changeAccount=false,scanUnavailable=false}={}){
 const log=(name,args,address)=>({...iface.encodeEventLog(iface.getEvent(name),args),address,transactionHash:targetHash});
 const record={hash,account,to:source,dataHash:ethers.keccak256(data),amountLD:String(amount),...(targetStart===null?{}:{targetStart})};
 const receipt={status:unconfirmed?0:1,blockNumber:90,logs:[log('OFTSent',[guid,30417,account,amount,amount],source)]};
 const arrival={status:1,blockNumber:101,logs:[log('OFTReceived',[guid,30102,account,targetAmount],target)]};
 let ctx;
 const providers={bsc:{getTransaction:async()=>({from:badCall?'0x0000000000000000000000000000000000000001':account,to:source,data}),getTransactionReceipt:async()=>receipt},arc:{getBlockNumber:async()=>101,getLogs:async()=>[arrival.logs[0]],getTransactionReceipt:async()=>{if(changeAccount)ctx.changeAccount();return arrival;}}};
 const nodes=new Map();
 const context={...ethers,candidateAppAbi,candidateTokenAbi,wotrRoutes,console,
  BrowserProvider:class{constructor(){return Object.values(providers)[context.providerIndex++];}},providerIndex:0,
  rpc:()=>{},arcFeeParams:()=>{},classifyWalletSendError:()=>{},planCandidateTransfer:()=>{},
  pickWallet:()=>{},rememberWalletSession:()=>{},restoreWalletSession:()=>{},clearWalletSession:()=>{},
  document:{body:{dataset:{asset:'wotr'}},getElementById:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);}},
  window:{dispatchEvent:()=>{},addEventListener:()=>{}},CustomEvent:class{},Event:class{},
  localStorage:{setItem:()=>{}},setTimeout:()=>{},AbortSignal,
  fetch:async()=>({ok:!scanUnavailable,json:async()=>({data:[{guid,pathway:{srcEid:30102,dstEid:30417},destination:{tx:{txHash:targetHash}}}]})}),
 };
 ctx=vm.createContext(context);
 let code=readFileSync('web/immediate-deploy/live.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
 code=code.slice(0,code.lastIndexOf("for(const side of ['bsc','arc']){"));
 vm.runInContext(code+`\naccount=${JSON.stringify(account)}; records={'send-bsc':${JSON.stringify(record)}}; quoteStatus=async()=>{}; globalThis.deliver=()=>delivered('arc');globalThis.current=()=>records['send-bsc'];globalThis.changeAccount=()=>{account='0x0000000000000000000000000000000000000001';};`,ctx);
 return ctx;
}
test('restored hash without GUID recovers source receipt and marks the matching delivery complete',async()=>{
 const app=setup();await app.deliver();assert.equal(app.current().guid,guid);assert.equal(app.current().deliveredHash,targetHash);
});
test('older record without destination start can verify a GUID-matched destination receipt',async()=>{
 const app=setup({targetStart:null});await app.deliver();assert.equal(app.current().deliveredHash,targetHash);
});
test('missing start hint uses bounded event fallback when Scan is unavailable',async()=>{
 const app=setup({targetStart:null,scanUnavailable:true});await app.deliver();assert.equal(app.current().deliveredHash,targetHash);
});
for(const [name,options] of [['different source sender',{badCall:true}],['failed source receipt',{unconfirmed:true}],['different destination amount',{targetAmount:amount+1n}],['wallet changed during verification',{changeAccount:true}]]){
 test(`recovery does not mark delivery for ${name}`,async()=>{const app=setup(options);await assert.rejects(app.deliver());assert.equal(app.current().deliveredHash,undefined);});
}
