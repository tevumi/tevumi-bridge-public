// Read-only snapshot checker. Caller supplies independently reviewed expected policy.
import {Contract,ZeroAddress,ZeroHash,id,keccak256} from 'ethers';
export async function inspectGovernance(provider, policy) {
 const block=await provider.getBlock('latest'),at={blockTag:block.number},checks=[];
 const eq=(label,actual,expected)=>checks.push({label,ok:String(actual).toLowerCase()===String(expected).toLowerCase()});
 const abi=['function owner() view returns(address)','function endpoint() view returns(address)','function guardian() view returns(address)','function peers(uint32) view returns(bytes32)','function depositsPaused() view returns(bool)','function sendsPaused() view returns(bool)','function receivesPaused() view returns(bool)','function capacityLD() view returns(uint256)','function outbound() view returns(uint64,uint64,uint64,uint256,uint256,bool)','function inbound() view returns(uint64,uint64,uint64,uint256,uint256,bool)'];
 const app=new Contract(policy.app,abi,provider),tl=new Contract(policy.timelock,['function getMinDelay() view returns(uint256)','function hasRole(bytes32,address) view returns(bool)','event RoleGranted(bytes32 indexed role,address indexed account,address indexed sender)','event RoleRevoked(bytes32 indexed role,address indexed account,address indexed sender)'],provider);
 const ep=new Contract(policy.endpoint,['function delegates(address) view returns(address)'],provider);
 eq('chainId',(await provider.getNetwork()).chainId,policy.chainId);
 for(const name of ['app','timelock','endpoint']){
  const code=await provider.getCode(policy[name],block.number);
  eq(name+' code present',code!=='0x',true);eq(name+' code hash',keccak256(code),policy.codeHashes[name]);
 }
 eq('owner',await app.owner(at),policy.timelock);eq('endpoint',await app.endpoint(at),policy.endpoint);
 eq('delegate',await ep.delegates(policy.app,at),policy.timelock);eq('guardian',await app.guardian(at),policy.guardian);
 eq('peer',await app.peers(policy.remoteEid,at),policy.peer);
 eq('delay',await tl.getMinDelay(at),policy.delay);
 eq('send pause',await app[policy.kind==='adapter'?'depositsPaused':'sendsPaused'](at),policy.sendPaused);
 eq('receive pause',await app.receivesPaused(at),policy.receivePaused);
 if(policy.kind==='adapter')eq('capacity',await app.capacityLD(at),policy.capacityLD);
 for(const direction of ['outbound','inbound']){
  const values=await app[direction](at);for(let i=0;i<3;i++)eq(direction+' '+i,values[i],policy[direction][i]);eq(direction+' initialized',values[5],true);
 }
 // Scan from genesis so a caller cannot hide early role grants with a late start block.
 // RPC log limits fail closed; chunking/indexer support is future work.
 const events=await tl.queryFilter(tl.filters.RoleGranted(),0,block.number);
 const candidates=new Set([ZeroAddress,policy.timelock,...Object.values(policy.roles).flat(),...events.map(e=>e.args.account)].map(a=>a.toLowerCase()));
 const roleIds={admin:ZeroHash,proposer:id('PROPOSER_ROLE'),executor:id('EXECUTOR_ROLE'),canceller:id('CANCELLER_ROLE')};
 for(const [name,role] of Object.entries(roleIds))for(const address of candidates)
  eq(name+' '+address,await tl.hasRole(role,address,at),policy.roles[name].some(a=>a.toLowerCase()===address));
 const after=await provider.getBlock(block.number);eq('snapshot block unchanged',after.hash,block.hash);
 return {blockNumber:block.number,blockHash:block.hash,ready:checks.every(c=>c.ok),checks,
  limitations:['Expected code hashes/policy require independent review.','No multisig threshold, DVN configuration or cross-chain delivery certification.']};
}
