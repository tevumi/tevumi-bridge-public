import {getAddress,parseUnits} from 'ethers';
import {wotrRoutes} from '../src/wotr-routes.js';
export const stringify=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v);
export const legs=kind=>kind==='buy'?['funding','buy','bridge']:['bridge','sell','funding'];
export function createOrder(kind,account,input,id){
 if(!['buy','sell'].includes(kind))throw Error('Unknown trade direction.');
 const amount=parseUnits(input,6);
 if(amount<=0n)throw Error('Enter a positive amount with at most 6 decimal places.');
 return {version:1,id,account:getAddress(account),kind,input:String(amount),asset:wotrRoutes.current,revision:0,createdAt:Date.now(),state:'OPEN',transactions:[]};
}
export function validateOrder(o){
 if(o?.version!==1||!/^[-a-zA-Z0-9]{8,100}$/.test(o.id)||!['buy','sell'].includes(o.kind)||!Number.isSafeInteger(o.revision)||o.revision<0||!Array.isArray(o.transactions))throw Error('Order journal is invalid. Preserve it before recovery.');
 getAddress(o.account);
 if(!/^[1-9]\d*$/.test(o.input)||o.asset?.sourceToken!==wotrRoutes.current.sourceToken||o.asset?.bsc!==wotrRoutes.current.bsc||o.asset?.arc!==wotrRoutes.current.arc)throw Error('Order asset does not match current WOTR.');
 if(!['OPEN','COMPLETED','CANCELLED'].includes(o.state))throw Error('Invalid order state.');
 if(o.state==='CANCELLED'&&o.transactions.some(t=>t.state!=='REJECTED'))throw Error('Uncertain or submitted transactions cannot be cancelled.');
 const seen=new Set();
 for(const t of o.transactions){
  if(!Number.isSafeInteger(t.leg)||t.leg<0||t.leg>2||![56,5042].includes(t.chain)||!['approval',legs(o.kind)[t.leg]].includes(t.kind)||!['AWAITING_WALLET','SUBMITTED','REJECTED','UNCERTAIN','VERIFIED'].includes(t.state)||!Number.isSafeInteger(t.nonce))throw Error('Invalid saved transaction.');
  if(!/^0x[0-9a-f]{40}$/i.test(t.to)||!/^0x(?:[0-9a-f]{2})+$/i.test(t.data)||!/^\d+$/.test(t.value))throw Error('Saved call is invalid.');
  if(t.hash){if(!/^0x[0-9a-f]{64}$/i.test(t.hash)||seen.has(t.hash.toLowerCase()))throw Error('Duplicate or invalid transaction hash.');seen.add(t.hash.toLowerCase());}
  if(t.state==='REJECTED'&&t.hash)throw Error('Submitted transaction cannot be marked rejected.');
 }
 if(o.state==='COMPLETED'&&legs(o.kind).some((kind,leg)=>o.transactions.filter(t=>t.leg===leg&&t.kind===kind&&t.hash&&t.state!=='REJECTED').length!==1))throw Error('Completed order is missing its original transactions.');
 return o;
}
// Persisted VERIFIED is only a display hint. Every continuation rebuilds results from receipts.
export function progress(kind,results){
 const index=legs(kind).findIndex((_,i)=>!results[i]);return index<0?3:index;
}
export function assertJournalUpdate(previous,next){
 validateOrder(next);
 if(!previous){if(next.revision!==0||next.transactions.length)throw Error('New order must begin empty.');return;}
 validateOrder(previous);
 if(next.revision!==previous.revision+1||['id','account','kind','input','createdAt'].some(k=>next[k]!==previous[k]))throw Error('Order changed in another tab. Reload the original order.');
 if(next.transactions.length<previous.transactions.length)throw Error('Transaction history cannot be removed.');
 for(let i=0;i<previous.transactions.length;i++){
  const a=previous.transactions[i],b=next.transactions[i];
  for(const k of ['leg','kind','chain','targetChain','to','data','value','nonce','amount','token','spender','targetStart'])if(a[k]!==b[k])throw Error('Saved transaction intent cannot change.');
  if(a.hash&&a.hash!==b.hash)throw Error('Original transaction hash cannot change.');
  if(stringify(a.quote)!==stringify(b.quote))throw Error('Saved transaction quote cannot change.');
  if(a.state==='REJECTED'&&b.state!=='REJECTED')throw Error('Rejected attempts stay archived.');
 }
}
