import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {network} from 'hardhat';
import {HDNodeWallet} from 'ethers';
import {openStore} from '../dev/candidate/store.mjs';
import {createPersistentRuntime,connectLocalChains,archiveCandidate} from '../dev/candidate/persistent.mjs';
import {openJournal,journalPath} from '../dev/candidate/chain-journal.mjs';
const directory=()=>resolve('.local','test-'+randomUUID());
const intent={asset:'cat',account:0,side:'bsc',amount:'1'};
async function fixture(t){const dir=directory();let runtime=await createPersistentRuntime(dir);t.after(async()=>{await runtime.close();await connectLocalChains(dir,{recover:false}).then(chains=>chains.stop()).catch(()=>{});});return {dir,get runtime(){return runtime;},async restart(){await runtime.close();runtime=await createPersistentRuntime(dir);return runtime;}};}
async function killHost(dir){const meta=JSON.parse(await readFile(join(dir,'host.json'),'utf8'));process.kill(meta.pid,'SIGKILL');for(let i=0;i<100;i++){try{await fetch('http://127.0.0.1:'+meta.port+'/identity',{signal:AbortSignal.timeout(100)});}catch{return;}await new Promise(r=>setTimeout(r,20));}throw Error('local host did not exit');}

test('atomic store detects corruption, stale writers and write failure',async()=>{
 const dir=directory(),store=await openStore(dir);await store.save({n:1});const stale=await openStore(dir);await store.save({n:2});await assert.rejects(stale.save({n:3}),/写入失败/);assert.equal((await openStore(dir)).loaded.n,2);
 await writeFile(join(dir,'write.lock'),'test');await assert.rejects(store.save({n:4}),/写入失败/);await unlink(join(dir,'write.lock'));await assert.rejects(store.save({n:4}),/锁定/);
 await writeFile(join(dir,'state.json'),'{broken');await assert.rejects(openStore(dir),/损坏/);
});

test('pending delivery and account isolation survive restart; retry keeps original source transaction',async t=>{
 const f=await fixture(t),r=f.runtime;let p=await r.preview(intent);const a=await r.confirm({id:p.id});await r.confirm({id:a.next.id,autoDeliver:false});const before=await r.state();
 const restored=await f.restart();assert.equal(restored.sessionId,before.sessionId);assert.deepEqual((await restored.state()).assets,before.assets);await assert.rejects(restored.preview(intent),/未到账/);
 assert.equal((await restored.preview({...intent,account:1})).key,'approve');await restored.retry({id:before.records[0].id});await restored.retry({id:before.records[0].id});
 const after=await restored.state();assert.equal(after.records.length,1);assert.equal(after.records[0].sourceHash,before.records[0].sourceHash);assert.equal(after.assets[1].balances[0].arc,'1.0');assert.equal(after.assets[1].balances[1].arc,'0.0');
 await f.restart();assert.equal((await f.runtime.state()).records[0].status,'received');
});

test('process exit after broadcast recovers by nonce without duplicate source send',async t=>{
 const f=await fixture(t),p=await f.runtime.preview(intent);await f.runtime.confirm({id:p.id});await f.runtime.close();
 const code=`import {createPersistentRuntime} from './dev/candidate/persistent.mjs';const r=await createPersistentRuntime(process.argv[1]);const p=await r.preview(${JSON.stringify(intent)});const request=await r.walletPrepare({id:p.id,autoDeliver:false});await r.walletBroadcast(request);process.exit(0);`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',code,f.dir],{cwd:process.cwd(),encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(child.status,0,child.stderr);
 const restored=await f.restart(),s=await restored.state();assert.equal(s.records.length,1);assert.equal(s.assets[1].principal,'1.0');assert.equal(s.records[0].status,'pending');
 await f.restart();assert.equal((await f.runtime.state()).records.length,1);
});

test('reservation without broadcast stays locked after restart; write failure prevents submission',async t=>{
 const f=await fixture(t),r=f.runtime,p=await r.preview(intent),prepared=await r.walletPrepare({id:p.id});
 await writeFile(join(f.dir,'write.lock'),'injected failure');await assert.rejects(r.walletBroadcast(prepared),/写入失败/);assert.equal((await r.state()).assets[1].balances[0].allowance,'0.0');await unlink(join(f.dir,'write.lock'));
 const restored=await f.restart();assert.equal((await restored.state()).walletRequests[0].status,'unknown');await assert.rejects(restored.preview(intent),/待核验/);assert.equal((await restored.preview({...intent,account:1})).key,'approve');
});

test('lost target result is reconciled from original GUID without a second delivery',async t=>{
 const f=await fixture(t);let p=await f.runtime.preview(intent),a=await f.runtime.confirm({id:p.id});await f.runtime.confirm({id:a.next.id,autoDeliver:false});
 const saved=await readFile(join(f.dir,'state.json'));const pending=(await f.runtime.state()).records[0];await f.runtime.retry({id:pending.id});const destination=(await f.runtime.state()).records[0].destinationHash;await f.runtime.close();
 // Simulate termination after target receipt but before its checkpoint reached disk.
 await writeFile(join(f.dir,'state.json'),saved);await killHost(f.dir);await f.restart();const restored=(await f.runtime.state()).records[0];assert.equal(restored.destinationHash,destination);assert.equal(restored.status,'received');await f.runtime.retry({id:restored.id});assert.equal((await f.runtime.state()).assets[1].supply,'1.0');
});

test('corrupt state or wrong contract version fails closed without overwriting evidence',async t=>{
 const f=await fixture(t);await f.runtime.close();const file=join(f.dir,'state.json'),store=await openStore(f.dir);await store.save({...store.loaded,buildId:'wrong'});const before=await readFile(file);await assert.rejects(createPersistentRuntime(f.dir),/版本不匹配/);assert.deepEqual(await readFile(file),before);
 await writeFile(file,'invalid');await assert.rejects(createPersistentRuntime(f.dir),/损坏/);assert.equal(await readFile(file,'utf8'),'invalid');
});

test('chain process crash restores approved balance, pending message and old transaction hashes',async t=>{
 const f=await fixture(t);let p=await f.runtime.preview(intent),a=await f.runtime.confirm({id:p.id});await f.runtime.confirm({id:a.next.id,autoDeliver:false});
 const before=await f.runtime.state(),sourceHash=before.records[0].sourceHash;
 await killHost(f.dir);const restored=await f.restart(),after=await restored.state();
 assert.equal(after.sessionId,before.sessionId);assert.deepEqual(after.assets,before.assets);assert.equal(after.records[0].sourceHash,sourceHash);
 assert.equal(after.records[0].status,'pending');await assert.rejects(restored.preview(intent),/未到账/);
 await restored.retry({id:after.records[0].id});const received=(await restored.state()).records[0];assert.equal(received.status,'received');
 await killHost(f.dir);await f.restart();const again=await f.runtime.state();assert.equal(again.records.length,1);assert.equal(again.records[0].destinationHash,received.destinationHash);assert.equal(again.assets[1].supply,'1.0');
 const returnPreview=await f.runtime.preview({...intent,side:'arc'});await f.runtime.confirm({id:returnPreview.id});const roundtrip=await f.runtime.state();assert.equal(roundtrip.assets[1].principal,'0.0');assert.equal(roundtrip.assets[1].supply,'0.0');
});

test('crash after wallet broadcast reconstructs source receipt by nonce without duplicate send',async t=>{
 const f=await fixture(t);let p=await f.runtime.preview(intent),a=await f.runtime.confirm({id:p.id});const prepared=await f.runtime.walletPrepare({id:a.next.id,autoDeliver:false});await f.runtime.walletBroadcast(prepared);
 await killHost(f.dir);await f.restart();const state=await f.runtime.state();assert.equal(state.records.length,1);assert.equal(state.assets[1].principal,'1.0');assert.equal(state.records[0].status,'pending');
 await killHost(f.dir);await f.restart();assert.equal((await f.runtime.state()).records.length,1);
});

test('signed raw wallet transaction survives chain host restart',async t=>{
 const f=await fixture(t),p=await f.runtime.preview(intent),prepared=await f.runtime.walletPrepare({id:p.id});
 const local=await network.create({network:'local',override:{chainId:31337}});let signer;
 try{const accounts=local.networkConfig.accounts;signer=HDNodeWallet.fromPhrase(await accounts.mnemonic._getRawValue(),await accounts.passphrase._getRawValue(),`${accounts.path}/${accounts.initialIndex+1}`);}
 finally{await local.close();}
 const tx=prepared.tx;assert.equal(signer.address.toLowerCase(),tx.from.toLowerCase());
 const raw=await signer.signTransaction({to:tx.to,nonce:Number(BigInt(tx.nonce)),chainId:Number(BigInt(tx.chainId)),data:tx.data,value:0n,gasLimit:BigInt(tx.gas),maxFeePerGas:BigInt(tx.maxFeePerGas),maxPriorityFeePerGas:BigInt(tx.maxPriorityFeePerGas),type:2});
 const hash=await f.runtime.walletRpc({side:'bsc',method:'eth_sendRawTransaction',params:[raw]});
 await killHost(f.dir);await f.restart();const state=await f.runtime.state();
 assert.equal(state.walletRequests[0].status,'confirmed');assert.equal(state.walletRequests[0].hash,hash);
 assert.equal(state.assets[1].balances[0].allowance,'1.0');assert.equal((await f.runtime.preview(intent)).key,'send');
 await assert.rejects(f.runtime.walletRpc({side:'bsc',method:'eth_sendRawTransaction',params:[raw]}),/签名交易与本地预留操作不符/);
});

test('reverted send and fee spike replay without creating principal or a message',async t=>{
 const f=await fixture(t);await f.runtime.faults({failSend:true,pauseReceive:false});let p=await f.runtime.preview(intent),a=await f.runtime.confirm({id:p.id});
 await assert.rejects(f.runtime.confirm({id:a.next.id}),/回滚/);await f.runtime.gasSpike();const before=await f.runtime.state();assert.equal(before.assets[1].principal,'0.0');assert.equal(before.records.length,0);
 await killHost(f.dir);await f.restart();const after=await f.runtime.state();assert.deepEqual(after.assets,before.assets);assert.equal(after.records.length,0);assert.equal(after.walletRequests.at(-1).status,'failed');
});

test('uncommitted chain operation remains blocked; broken journal preserves evidence and stops recovery',async t=>{
 const f=await fixture(t),p=await f.runtime.preview(intent),prepared=await f.runtime.walletPrepare({id:p.id});await killHost(f.dir);
 const journal=await openJournal(f.dir);await journal.append('intent',{side:'bsc',method:'eth_sendTransaction',params:[prepared.tx]});
 await f.restart();assert.equal((await f.runtime.state()).walletRequests[0].status,'unknown');await assert.rejects(f.runtime.preview(intent),/待核验/);assert.equal((await f.runtime.state()).assets[1].balances[0].allowance,'0.0');
 await killHost(f.dir);const file=journalPath(f.dir),original=await readFile(file);await writeFile(file,Buffer.concat([original,Buffer.from('truncated')]));
 await assert.rejects(createPersistentRuntime(f.dir),/日志尾部不完整/);assert.equal((await readFile(file)).at(-1),'d'.charCodeAt(0));
});

test('explicit reset archives records and starts a new chain identity',async()=>{
 const dir=directory(),r=await createPersistentRuntime(dir),old=r.sessionId;await r.close();const before=await readFile(join(dir,'state.json'));
 const archived=await archiveCandidate(dir);assert.deepEqual(await readFile(join(archived,'state.json')),before);
 const fresh=await createPersistentRuntime(dir);assert.notEqual(fresh.sessionId,old);assert.equal((await fresh.state()).records.length,0);await fresh.close();await(await connectLocalChains(dir)).stop();
 await assert.rejects(archiveCandidate(resolve('docs')),/路径必须/);
});
