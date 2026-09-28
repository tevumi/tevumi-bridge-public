import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interface,getCreateAddress} from 'ethers';
import {validateReleasePolicy,prepareRelease} from '../scripts/production-release.mjs';
const net=JSON.parse(readFileSync('config/networks.json')),assets=JSON.parse(readFileSync('config/meme-candidates.json')).assets;
const address=n=>'0x'+n.toString(16).padStart(40,'0');
function policy(){return {releaseId:'local-test',delaySeconds:86400,bsc:{deployer:address(1),startNonce:7,safe:address(2),guardian:address(3),owners:[address(4),address(5),address(6)],threshold:2},arc:{deployer:address(7),startNonce:9,safe:address(8),guardian:address(9),owners:[address(4),address(5),address(6)],threshold:2},assets:Object.fromEntries(assets.map(a=>[a.id,{capacityLD:'100000000000000',bsc:{outbound:['10','20','40'],inbound:['10','20','40']},arc:{outbound:['10','20','40'],inbound:['10','20','40']}}]))};}
test('unresolved template identifies missing decisions; it is not a valid deploy plan',()=>{
 const r=validateReleasePolicy(JSON.parse(readFileSync('config/production-release.template.json')),assets);
 assert.equal(r.valid,false);for(const x of ['bsc.safe','arc.guardian','assets.cat.capacityLD'])assert.ok(r.issues.includes(x));
});
test('wrong owners, delay, nonce, amount units and exhausted non-refilling policy are rejected',()=>{
 const mutations=[p=>p.bsc.owners[1]=p.bsc.owners[0],p=>p.delaySeconds=0,p=>p.arc.startNonce=-1,p=>p.assets.cat.capacityLD='1001',p=>p.assets.cat.bsc.outbound=['10','20','20'],p=>p.assets.cat.arc.inbound=['1','2','18446744073709551616']];
 assert.equal(validateReleasePolicy(policy(),assets).valid,true);
 for(const mutate of mutations){const p=policy();mutate(p);assert.equal(validateReleasePolicy(p,assets).valid,false);}
});
test('direct EOA public beta has no tester account and preserves the governance delay',async()=>{
 const p=policy();p.governanceMode='direct-eoa';
 for(const side of ['bsc','arc']){p[side].governor=p[side].safe;delete p[side].safe;delete p[side].owners;delete p[side].threshold;}
 assert.equal(validateReleasePolicy(p,assets).valid,true);
 const plan=await prepareRelease(build,p,net,assets);
 assert.equal(plan.governanceMode,'direct-eoa');assert.equal(plan.deployments.length,6);
 for(const side of ['bsc','arc']){
  const governor=plan.deployments.find(x=>x.side===side&&x.contract==='BridgeTimelock');
  assert.equal(governor.constructorArgs[1],p[side].governor);
  const batch=plan.configurations.find(x=>x.side===side);
  assert.equal(batch.proposer,p[side].governor);assert.equal(batch.safe,undefined);
  assert.match(batch.note,/named EOA/);
 }
 const missing=structuredClone(p);delete missing.arc.governor;
 assert.ok(validateReleasePolicy(missing,assets).issues.includes('arc.governor'));
});
test('target must accommodate source single, burst and refill independently in both directions',()=>{
 for(const receiver of ['arc','bsc'])for(const v of [['9','20','40'],['10','19','40'],['10','20','39']]){
  const p=policy();p.assets.cat[receiver].inbound=v;assert.ok(validateReleasePolicy(p,assets).issues.some(x=>x.endsWith('.compatibility')));
 }
 const p=policy();p.assets.cat.capacityLD='1000000000000';assert.ok(validateReleasePolicy(p,assets).issues.some(x=>x.endsWith('capacityBelowSingle')));
});
// ABI-only planning tests; real compiled deployment bytes are exercised by release-fork.
const constructors={BridgeTimelock:['constructor(uint256,address)','function scheduleBatch(address[],uint256[],bytes[],bytes32,bytes32,uint256)','function executeBatch(address[],uint256[],bytes[],bytes32,bytes32)'],GovernedAdapter:['constructor(address,address,address,address,uint256,uint64[3],uint64[3])'],GovernedOFT:['constructor(string,string,address,address,address,address,uint64[3],uint64[3])'],ImmediateAdmin:['constructor(address)','function executeBatch(address[],bytes[])'],ImmediateAdapter:['constructor(address,address,address,address,uint256,uint64[3],uint64[3])'],ImmediateOFT:['constructor(string,string,address,address,address,address,uint64[3],uint64[3])']};

test('development release uses immediate admin batches without a schedule or unpause',async()=>{
 const p=policy();p.governanceMode='immediate-eoa';p.delaySeconds=0;
 for(const side of ['bsc','arc']){p[side].governor=p[side].safe;delete p[side].safe;delete p[side].owners;delete p[side].threshold;}
 assert.equal(validateReleasePolicy(p,assets).valid,true);
 const plan=await prepareRelease(build,p,net,assets),admin=new Interface(constructors.ImmediateAdmin);
 assert.equal(plan.governanceMode,'immediate-eoa');assert.equal(plan.deployments.length,6);
 for(const side of ['bsc','arc']){
  assert.deepEqual(plan.deployments.filter(item=>item.side===side).map(item=>item.contract),["ImmediateAdmin","ImmediateAdapter","ImmediateAdapter"].map(name=>side==='arc'&&name==='ImmediateAdapter'?'ImmediateOFT':name));
  const batch=plan.configurations.find(item=>item.side===side),decoded=admin.decodeFunctionData('executeBatch',batch.execute.data);
  assert.equal(batch.schedule,undefined);assert.equal(batch.steps.length,12);assert.equal(decoded[0].length,12);assert.equal(decoded[1].length,12);
  assert.ok(batch.steps.every(step=>step.key!=='setPauses'));
 }
});
const build=Object.fromEntries(Object.entries(constructors).map(([name,abi])=>['contracts/production/'+name+'.sol',{[name]:{abi,evm:{bytecode:{object:'6000'}}}}]));
test('six unsigned creations bind EOA nonce sequence, exact metadata and predicted governance',async()=>{
 const p=policy(),plan=await prepareRelease(build,p,net,assets);assert.equal(plan.deployments.length,6);
 for(const side of ['bsc','arc']){
  const d=plan.deployments.filter(x=>x.side===side);assert.deepEqual(d.map(x=>x.transaction.nonce),[p[side].startNonce,p[side].startNonce+1,p[side].startNonce+2]);
  assert.equal(plan.governance[side],getCreateAddress({from:p[side].deployer,nonce:p[side].startNonce}));
  for(const app of d.slice(1))assert.equal(app.constructorArgs[side==='bsc'?2:4],plan.governance[side]);
 }
 const oft=plan.deployments.find(x=>x.side==='arc'&&x.assetId==='binancelife');assert.deepEqual(oft.constructorArgs.slice(0,2),['币安人生','币安人生']);
});
test('configuration batches contain two isolated six-step routes and no unpause',async()=>{
 const plan=await prepareRelease(build,policy(),net,assets),tl=new Interface(constructors.BridgeTimelock);
 for(const batch of plan.configurations){
  assert.equal(batch.steps.length,12);assert.deepEqual([...new Set(batch.steps.map(x=>x.assetId))],assets.map(x=>x.id));
  const args=tl.decodeFunctionData('scheduleBatch',batch.schedule.data);assert.equal(args[0].length,12);assert.equal(args[5],86400n);
  assert.ok(batch.steps.every(x=>['peer','sendLibrary','receiveLibrary','sendDVN','receiveDVN','executor'].includes(x.key)));
 }
});
test('changing deployer nonce changes predicted apps and batch operation salt',async()=>{
 const p=policy(),one=await prepareRelease(build,p,net,assets);p.bsc.startNonce++;
 const two=await prepareRelease(build,p,net,assets);assert.notEqual(one.apps.bsc.cat,two.apps.bsc.cat);
 assert.notEqual(one.configurations[1].salt,two.configurations[1].salt);
 await assert.rejects(prepareRelease(build,{},net,assets),/INVALID_RELEASE_POLICY/);
});
