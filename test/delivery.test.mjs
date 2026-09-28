import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import { pilotAbi } from '../web/src/bridge.js';
import { findDelivery } from '../web/src/delivery.js';

const i=new Interface(pilotAbi), address='0x'+'11'.repeat(20), account='0x'+'22'.repeat(20), guid='0x'+'33'.repeat(32), hash='0x'+'44'.repeat(32);
const record={status:'sent',chainId:56,destinationChainId:5042,sourceEid:30102,blockNumber:50,destinationAddress:address,account,guid,amount:'1000000000000'};
const source={getNetwork:async()=>({chainId:56n}),getBlock:async()=>({timestamp:500})};
function setup(){
  const ranges=[];
  const destination={getNetwork:async()=>({chainId:5042n}),getBlockNumber:async()=>10000,getBlock:async n=>({timestamp:n}),getLogs:async f=>{ranges.push([f.fromBlock,f.toBlock]);return [];}};
  return {destination,ranges};
}
test('bounded historical scan resumes without gaps and overlaps the head',async()=>{
  const {destination,ranges}=setup();const first=await findDelivery(record,source,destination);
  assert.equal(ranges.length,4);assert.equal(ranges[0][0],379);assert.equal(first.cursor,4379);
  const second=await findDelivery(record,source,destination,first.cursor);assert.equal(ranges[4][0],4379);
  const third=await findDelivery(record,source,destination,second.cursor);assert.equal(third.cursor,9968);assert.equal(third.record.status,'sent');
});
test('RPC failure does not advance a cursor or claim delivery',async()=>{
  const {destination}=setup();destination.getLogs=async()=>{throw Error('unavailable');};
  await assert.rejects(()=>findDelivery(record,source,destination,500),/unavailable/);
  assert.equal(record.status,'sent');
});
test('reject incorrect events and require a successful matching receipt',async()=>{
  const {destination}=setup();
  const event=(amount)=>({address,transactionHash:hash,...i.encodeEventLog(i.getEvent('OFTReceived'),[guid,30102,account,amount])});
  destination.getLogs=async()=>[event(1n)];
  assert.equal((await findDelivery(record,source,destination,9999)).record.status,'sent');
  destination.getLogs=async()=>[event(BigInt(record.amount))];
  destination.getTransactionReceipt=async()=>({status:0,logs:[]});
  await assert.rejects(()=>findDelivery(record,source,destination,9999),/成功确认/);
  destination.getTransactionReceipt=async()=>({status:1,blockNumber:10000,logs:[event(BigInt(record.amount))]});
  const found=await findDelivery(record,source,destination,9999);assert.equal(found.record.status,'delivered');assert.equal(found.record.destinationHash,hash);
});
