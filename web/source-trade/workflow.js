// Only an explicit Start authorizes new wallet requests. Refresh resumes reads.
export function waitingForProof(error){return error?.code==='WAITING_PROOF';}
export async function continueTrade({engine,wallet,firstQuote,signal,onQuote=()=>{},onStatus=()=>{},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now,timeout=15*60*1000}){
 const deadline=now()+timeout;
 const stopped=()=>signal.aborted||now()>=deadline;
 let selected=firstQuote;
 while(!stopped()){
  try{await engine.verify();}
  catch(error){
   if(!waitingForProof(error))throw error;
   onStatus('waiting');await wait(4000);continue;
  }
  if(engine.order.state==='COMPLETED'){onStatus('completed');return;}
  if(stopped())break;
  if(!selected||now()-selected.at>=60000){onStatus('quoting');selected=await engine.quote();}
  onQuote(selected);
  if(stopped())break;
  onStatus('wallet');
  // Never retry a wallet request, uncertain result, rejection, or failed write.
  await engine.transact(wallet,selected);
  selected=null;onStatus('waiting');
 }
 onStatus(signal.aborted?'paused':'timeout');
}
