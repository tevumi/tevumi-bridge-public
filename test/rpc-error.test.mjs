import test from 'node:test';
import assert from 'node:assert/strict';
import {rpc} from '../web/immediate-deploy/rpc.js';
test('RPC retains numeric error code and bounded revert bytes for ABI decoding',async()=>{
 const previous=globalThis.fetch;
 try {
   globalThis.fetch=async()=>({ok:true,json:async()=>({error:{code:3,message:'execution reverted',data:'0x6190b2b0'}})});
   await assert.rejects(rpc(5042,'eth_call',[]),e=>e.rpcRevert && e.code===3 && e.data==='0x6190b2b0');
   globalThis.fetch=async()=>({ok:true,json:async()=>({error:{code:3,message:'execution reverted',data:{url:'private'}}})});
   await assert.rejects(rpc(5042,'eth_call',[]),e=>e.rpcRevert && e.data===undefined);
 } finally{globalThis.fetch=previous;}
});
