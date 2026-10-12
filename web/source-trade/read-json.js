// Only for read-only RPC and GET quote/index requests. Never use for order writes or wallet sends.
export async function readJson(url,init={},fetcher=fetch){
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 for(let attempt=0;attempt<2;attempt++){
  try{
   const response=await fetcher(url,{...init,signal:AbortSignal.timeout(12000)});
   if(response.status===429){const wait=Number(response.headers?.get('ratelimit-reset')||response.headers?.get('retry-after'));throw Object.assign(Error('Read service rate limited'),{code:'RATE_LIMITED',retryAfter:Number.isFinite(wait)&&wait>0?Math.min(Math.ceil(wait),86400):60});}
   const transient=[502,503,504].includes(response.status);
   if(transient){if(attempt===0){await pause(200);continue;}throw Error('Read service temporarily unavailable');}
   let data;try{data=await response.json();}catch{if(attempt===0){await pause(200);continue;}throw Error('Invalid read service response');}
   return {data,status:response.status};
  }catch(error){if(error.code==='RATE_LIMITED')throw error;if(attempt===1)throw Error('Read service temporarily unavailable');await pause(200);}
 }
}
