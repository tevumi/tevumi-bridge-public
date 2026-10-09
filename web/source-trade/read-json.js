// Only for read-only RPC and GET quote/index requests. Never use for order writes or wallet sends.
export async function readJson(url,init={},fetcher=fetch){
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 for(let attempt=0;attempt<2;attempt++){
  try{
   const response=await fetcher(url,{...init,signal:AbortSignal.timeout(12000)});
   const transient=[429,502,503,504].includes(response.status);
   if(transient){if(attempt===0){await pause(200);continue;}throw Error('Read service temporarily unavailable');}
   let data;try{data=await response.json();}catch{if(attempt===0){await pause(200);continue;}throw Error('Invalid read service response');}
   return {data,status:response.status};
  }catch(error){if(attempt===1)throw Error('Read service temporarily unavailable');await pause(200);}
 }
}
