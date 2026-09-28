// Public read traffic only; wallet submission must never be retried here.
export function publicReadProvider(provider,{spacing=70,retries=2}={}) {
  let next=0,active=0;const queue=[];
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function run(fn){
    if(active>=4)await new Promise(resolve=>queue.push(resolve));
    active++;
    try{
      for(let attempt=0;;attempt++){
        const wait=Math.max(0,next-Date.now());next=Math.max(next,Date.now())+spacing;
        if(wait)await sleep(wait);
        try{return await fn();}catch(error){
          const code=error.info?.error?.code??error.error?.code;
          if(attempt>=retries||!(code===-32005||error.code==='NETWORK_ERROR'||error.code==='TIMEOUT'))throw error;
          await sleep(500*(attempt+1));
        }
      }
    }finally{active--;queue.shift()?.();}
  }
  const reads=new Set(['getNetwork','getCode','getBlockNumber','getBlock','getTransaction','getTransactionReceipt','getLogs','call','getBalance','getFeeData','estimateGas']);
  return new Proxy(provider,{get(target,prop){const value=Reflect.get(target,prop,target);return typeof value==='function'?(reads.has(prop)?(...args)=>run(()=>value.apply(target,args)):value.bind(target)):value;}});
}
