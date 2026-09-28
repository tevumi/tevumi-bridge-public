// Pure accounting over a complete, pinned, deployment-to-snapshot event history.
// Amounts are decimal strings in local units (18 decimals on both sides).
export function reconcile(snapshot,{pendingSeconds,nowSeconds}) {
 if(!Number.isSafeInteger(pendingSeconds)||pendingSeconds<=0||!Number.isSafeInteger(nowSeconds))throw new Error('INVALID_POLICY');
 const alerts=[],messages=[],seen=new Map(),sends=new Map(),receives=new Map();
 const alert=(code,severity,subject='pair')=>alerts.push({id:code+':'+subject,code,severity,subject});
 const amount=value=>{if(!/^(0|[1-9][0-9]*)$/.test(String(value)))throw new Error('INVALID_AMOUNT');return BigInt(value);};
 let locked=0n,released=0n,minted=0n,burned=0n;
 for(const e of snapshot.events){
  if(!['bsc','arc'].includes(e.side)||!['sent','received'].includes(e.kind)||!/^0x[0-9a-f]{64}$/i.test(e.guid)||!Number.isSafeInteger(e.timestamp)||e.timestamp>nowSeconds)throw new Error('INVALID_EVENT');
  const key=[e.side,e.blockHash,e.transactionHash,e.logIndex].join(':');
  if(seen.has(key)){if(JSON.stringify(seen.get(key))!==JSON.stringify(e))throw new Error('CONFLICTING_LOG');continue;}seen.set(key,e);
  const n=amount(e.amount);if(n===0n)throw new Error('ZERO_EVENT_AMOUNT');
  const direction=(e.side==='bsc')===(e.kind==='sent')?'forward':'return';
  const map=e.kind==='sent'?sends:receives,guid=direction+':'+e.guid.toLowerCase();
  if(map.has(guid)){alert('DUPLICATE_GUID','critical',guid);continue;}map.set(guid,e);
  if(e.side==='bsc'){if(e.kind==='sent')locked+=n;else released+=n;}
  else if(e.kind==='sent')burned+=n;else minted+=n;
 }
 let forward=0n,back=0n,incomplete=false;
 for(const [guid,receive] of receives){
  const send=sends.get(guid);
  if(!send){incomplete=true;alert('UNMATCHED_RECEIVE','warning',guid);continue;}
  if(amount(send.amount)!==amount(receive.amount))alert('MESSAGE_AMOUNT_MISMATCH','critical',guid);
 }
 for(const [guid,send] of sends){
  const receive=receives.get(guid),age=nowSeconds-send.timestamp;
  messages.push({guid:send.guid,direction:guid.split(':')[0],amount:send.amount,status:receive?'received':'pending',sourceTransaction:send.transactionHash,destinationTransaction:receive?.transactionHash??null,recipient:receive?.account??null});
  if(!receive){if(guid.startsWith('forward:'))forward+=amount(send.amount);else back+=amount(send.amount);if(age>=pendingSeconds)alert('PENDING_TOO_LONG','warning',guid);}
 }
 const principal=amount(snapshot.principal),supply=amount(snapshot.supply),balance=amount(snapshot.balance);
 if(principal!==locked-released)alert('PRINCIPAL_HISTORY_MISMATCH','critical');
 if(supply!==minted-burned)alert('SUPPLY_HISTORY_MISMATCH','critical');
 if(balance<principal)alert('COLLATERAL_DEFICIT','critical');
 if(balance>principal)alert('UNEXPLAINED_SURPLUS','warning');
 if(!incomplete&&principal!==supply+forward+back)alert('CONSERVATION_MISMATCH','critical');
 return {status:alerts.some(a=>a.severity==='critical')?'critical':incomplete?'incomplete':alerts.length?'warning':'ok',alerts,messages,
  totals:{principal:String(principal),supply:String(supply),balance:String(balance),forward:String(forward),returning:String(back),unexplainedSurplus:String(balance>principal?balance-principal:0n)},
  boundaries:snapshot.boundaries};
}

// Alert identities remain stable across retries/restarts. Recovery closes old alerts.
export function alertTransitions(previous,current){
 const old=new Set((previous?.alerts??[]).map(x=>x.id)),next=new Set(current.alerts.map(x=>x.id));
 return {opened:current.alerts.filter(x=>!old.has(x.id)),resolved:[...old].filter(x=>!next.has(x)),ongoing:current.alerts.filter(x=>old.has(x.id))};
}
