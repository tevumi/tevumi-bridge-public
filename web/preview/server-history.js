// History writes are bounded and never resend an asset transaction.
export async function historyWrite(path, body, {fetcher=fetch, timeout=8000, attempts=3}={}) {
  const payload=JSON.stringify(body);
  for(let attempt=0;attempt<attempts;attempt++){
    try{
      const response=await fetcher(path,{method:'POST',headers:{'content-type':'application/json'},body:payload,signal:AbortSignal.timeout(timeout)});
      if(response.ok){await response.json();return true;}
      if(response.status>=400&&response.status<500&&![408,429].includes(response.status))return false;
    }catch{}
    if(attempt+1<attempts)await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
  }
  return false;
}
const reported=new Map();
export function saveOutcome(page,account,id,record){
  if(!/^0x[0-9a-f]{40}$/i.test(account||'')||!id)return Promise.resolve(false);
  const body={page,account,id,...record},key=JSON.stringify(body);
  if(reported.has(key))return reported.get(key);
  const result=historyWrite('/api/operation-results',body).then(saved=>{
    if(saved)window.dispatchEvent(new CustomEvent('tevumi:server-history-saved',{detail:{page,account}}));
    return saved;
  });
  if(reported.size>=2000)reported.delete(reported.keys().next().value);
  reported.set(key,result);return result;
}
