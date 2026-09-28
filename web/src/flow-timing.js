import {Interface} from 'ethers';
import {endpointAbi,pilotAbi,tokenAbi} from './bridge.js';
import {classifyFlowError} from './flow-errors.js';
// Only allowlisted method names and classified errors; never provider messages.
const diagnosticAbi=new Interface([...endpointAbi,...pilotAbi,...tokenAbi,'function sourceToken() view returns(address)','function name() view returns(string)','function symbol() view returns(string)','function decimals() view returns(uint8)']);
const key='tevumi-flow-timing-v1';
let history=[],active;
try{const saved=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(saved))history=saved.slice(-10);}catch{}
const listeners=new Set();
const now=()=>performance.now();
function changed(){for(const fn of listeners)fn();}
function persist(){try{localStorage.setItem(key,JSON.stringify(history));}catch{}changed();}
export function beginTiming(kind,asset,chain){
 active={version:2,kind,asset,chain,at:new Date().toISOString(),started:now(),status:'running',marks:[],reads:[]};
 history.push(active);history=history.slice(-10);persist();return active;
}
export function markTiming(label){if(active){active.marks.push({label,ms:Math.round(now()-active.started)});persist();}}
export async function timeRead(label,fn){
 const trace=active,start=now(),read={label,startMs:trace?Math.round(start-trace.started):0,status:'running'};
 if(trace){trace.reads.push(read);changed();}
 try{const value=await fn();read.status='ok';return value;}catch(e){read.status='error';read.errorCode=classifyFlowError(e);throw e;}
 finally{if(trace){read.durationMs=Math.round(now()-start);persist();}}
}
export function endTiming(trace,status){if(trace){trace.status=status;trace.totalMs=Math.round(now()-trace.started);if(active===trace)active=undefined;persist();}}
function report(){return JSON.stringify({note:'marks 为点击后的时间；reads 可重叠，不能相加。钱包返回耗时包含用户确认，不能当作弹窗出现耗时。',runs:history.map(({started,...rest})=>rest)},null,2);}
export function mountTiming(parent,id){
 const box=document.createElement('details');box.id=id;
 const title=document.createElement('summary');title.textContent='查看 / 复制耗时诊断';box.append(title);
 const hint=document.createElement('p');hint.textContent='记录预览、请求钱包及返回耗时；不记录地址、交易数据或 RPC URL。';
 const copy=document.createElement('button');copy.type='button';copy.className='button secondary';copy.textContent='复制耗时诊断';
 const pre=document.createElement('pre');pre.textContent=report();
 copy.onclick=async()=>{try{await navigator.clipboard.writeText(report());copy.textContent='已复制';}catch{copy.textContent='复制失败，请选中下方文本复制';}};
 box.append(hint,copy,pre);parent.append(box);
 listeners.add(()=>{pre.textContent=report();copy.textContent='复制耗时诊断';});
}
const proxies=new WeakMap();
export function timedProvider(provider,chain){
 if(!provider)return provider;
 if(proxies.has(provider))return proxies.get(provider);
 const methods=new Set(['getNetwork','getCode','getBlockNumber','getBlock','getTransaction','getTransactionReceipt','getLogs','call','getBalance','getFeeData','estimateGas']);
 const wrapped=new Proxy(provider,{get(target,prop){const value=Reflect.get(target,prop,target);if(typeof value!=='function')return value;return methods.has(prop)?(...args)=>{
  let method='';
  if(['call','estimateGas'].includes(prop)&&typeof args[0]?.data==='string'){
   try{method=diagnosticAbi.getFunction(args[0].data.slice(0,10))?.name??'unknown';}catch{method='unknown';}
  }
  return timeRead(String(chain)+':'+prop+(method?':'+method:''),()=>value.apply(target,args));
 }:value.bind(target);}});
 proxies.set(provider,wrapped);return wrapped;
}
