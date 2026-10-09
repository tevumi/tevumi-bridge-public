import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../web/source-trade/read-json.js';
test('temporary read gateway, malformed JSON and network errors retry once; definitive errors do not',async()=>{
 for(const type of ['gateway','json','network']){
  let calls=0;
  const result=await readJson('https://example.invalid',{},async()=>{
   calls++;if(calls===1){if(type==='network')throw Error('Private endpoint details');if(type==='json')return new Response('<html>Unavailable</html>');return new Response('Unavailable',{status:502});}
   return Response.json({result:'0x38'});
  });assert.equal(calls,2);assert.equal(result.data.result,'0x38');
 }
 let calls=0;const error=await readJson('https://example.invalid',{},async()=>{calls++;return Response.json({error:'No route'},{status:400});});assert.equal(calls,1);assert.equal(error.status,400);
});
test('persistent read failures stop after two attempts and never expose endpoint details',async()=>{
 let calls=0;await assert.rejects(readJson('https://example.invalid',{},async()=>{calls++;throw Error('Sensitive URL');}),e=>e.message==='Read service temporarily unavailable');assert.equal(calls,2);
});
