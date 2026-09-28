import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {reconcile,alertTransitions} from '../scripts/production-reconcile.mjs';
import {writeReport} from '../scripts/production-monitor.mjs';
const hash=n=>'0x'+n.toString(16).padStart(64,'0');
const event=(side,kind,guid,amount='10')=>({side,kind,guid:hash(guid),amount,blockHash:hash(100),transactionHash:hash(guid*10+(kind==='sent'?0:1)),logIndex:0,timestamp:100,account:'recipient'});
const run=(events,principal,supply,balance=principal)=>reconcile({events,principal,supply,balance,boundaries:{}},{pendingSeconds:60,nowSeconds:200});
test('forward and return transit preserve exact accounting beyond Number precision',()=>{
 const n='100000000000000000000001',s=event('bsc','sent',1,n),r=event('arc','received',1,n),back=event('arc','sent',2,n),done=event('bsc','received',2,n);
 assert.equal(run([s],n,'0').totals.forward,n);
 assert.equal(run([s,r],n,n).status,'ok');
 assert.equal(run([s,r,back],n,'0').totals.returning,n);
 assert.equal(run([s,r,back,done],'0','0').status,'ok');
});
test('destination ahead of source is incomplete, not a fabricated deficit',()=>{
 const r=run([event('arc','received',1)],'0','10');
 assert.equal(r.status,'incomplete');assert.deepEqual(r.alerts.map(x=>x.code),['UNMATCHED_RECEIVE']);
});
test('missing events, collateral deficits, amount mismatch and unexplained surplus are distinguished',()=>{
 assert.ok(run([],'10','0').alerts.some(x=>x.code==='PRINCIPAL_HISTORY_MISMATCH'));
 const s=event('bsc','sent',1),r=event('arc','received',1);
 assert.ok(run([s,r],'10','10','9').alerts.some(x=>x.code==='COLLATERAL_DEFICIT'));
 assert.ok(run([s,r],'10','10','17').alerts.some(x=>x.code==='UNEXPLAINED_SURPLUS'));
 assert.ok(run([s,{...r,amount:'9'}],'10','9').alerts.some(x=>x.code==='MESSAGE_AMOUNT_MISMATCH'));
});
test('identical log replay is idempotent; conflicting log and duplicate GUID fail visibly',()=>{
 const s=event('bsc','sent',1);
 assert.deepEqual(run([s,s],'10','0'),run([s],'10','0'));
 assert.throws(()=>run([s,{...s,amount:'11'}],'10','0'),/CONFLICTING_LOG/);
 assert.ok(run([s,{...s,transactionHash:hash(999)}],'10','0').alerts.some(x=>x.code==='DUPLICATE_GUID'));
});
test('full rebuild rolls back orphaned messages; stable alert ids resolve after recovery',()=>{
 const pending=run([event('bsc','sent',1)],'10','0');
 assert.equal(alertTransitions(pending,pending).opened.length,0);
 const rebuilt=run([],'0','0');
 assert.equal(rebuilt.status,'ok');assert.equal(alertTransitions(pending,rebuilt).resolved.length,1);
 const delivered=run([event('bsc','sent',1),event('arc','received',1)],'10','10');
 assert.equal(alertTransitions(pending,delivered).resolved.length,1);
});
test('report survives restart and atomic replacement without BigInt precision loss',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tevumi-monitor-'));
 try{const path=join(dir,'report.json'),r=run([event('bsc','sent',1)],'10','0');await writeReport(path,r);
 const saved=JSON.parse(await readFile(path,'utf8'));assert.deepEqual(saved,r);
 await writeReport(path,run([],'0','0'));assert.equal(JSON.parse(await readFile(path,'utf8')).status,'ok');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('CLI RPC failure keeps financial alarms, hides credentials and respects single-writer lock',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tevumi-monitor-'));
 try{
  const sourceToken='0x'+'11'.repeat(20),app='0x'+'22'.repeat(20),path=join(dir,'report.json'),config=join(dir,'policy.json');
  const policy={sourceToken,chunkSize:100,pendingSeconds:60,bsc:{chainId:56,app,deploymentBlock:1,confirmations:10,maxBlockAgeSeconds:100,rpcEnv:'TEVUMI_TEST_MISSING_RPC'},arc:{chainId:5042,app,deploymentBlock:1,confirmations:10,maxBlockAgeSeconds:100,rpcEnv:'TEVUMI_TEST_MISSING_RPC'},ignoredSecret:'must-never-appear'};
  const scope=JSON.stringify([sourceToken,[56,app,1],[5042,app,1]]);
  await writeFile(config,JSON.stringify(policy));
  await writeReport(path,{scope,alerts:[{id:'COLLATERAL_DEFICIT:pair',code:'COLLATERAL_DEFICIT',severity:'critical'}],snapshot:{principal:'10'}});
  const env={...process.env};delete env.TEVUMI_TEST_MISSING_RPC;
  const run=()=>spawnSync(process.execPath,['scripts/production-monitor.mjs',config,path],{env,encoding:'utf8'});
  assert.equal(run().status,2);const first=JSON.parse(await readFile(path,'utf8'));
  assert.equal(first.status,'unavailable');assert.equal(first.transitions.resolved.length,0);assert.equal(first.alerts.length,2);assert.equal(first.lastSuccessfulSnapshot.principal,'10');
  assert.equal(JSON.stringify(first).includes(policy.ignoredSecret),false);
  assert.equal(run().status,2);assert.equal(JSON.parse(await readFile(path,'utf8')).transitions.opened.length,0);
  const saved=await readFile(path,'utf8');await writeFile(path+'.lock','');assert.equal(run().status,1);assert.equal(await readFile(path,'utf8'),saved);
 }finally{await rm(dir,{recursive:true,force:true});}
});
