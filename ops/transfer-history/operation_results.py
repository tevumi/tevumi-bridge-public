"""Bounded client outcome journal. Reported outcomes never become chain proofs."""
import json
import re
import time

ADDRESS=re.compile(r'^0x[0-9a-f]{40}$',re.I)
HASH=re.compile(r'^0x[0-9a-f]{64}$',re.I)
PAGES={'buy','swap','bridge','usdc'}
STATES={'pending','submitted','unknown','verified','failed','error','cancelled','success'}

def initialize(c):
    c.execute('''CREATE TABLE IF NOT EXISTS operation_results(
      account TEXT NOT NULL,page TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,
      created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,index_checks INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(account,page,id))''')
    c.execute('CREATE INDEX IF NOT EXISTS operation_account_time ON operation_results(account,page,created_at DESC)')

def save(c,item):
    # Serialize updates so a delayed request cannot overwrite a newer result.
    with c:
        c.execute('BEGIN IMMEDIATE')
        return _save(c,item)

def _save(c,item):
    account=str(item.get('account','')).lower()
    page=item.get('page');identity=item.get('id')
    if not ADDRESS.fullmatch(account) or page not in PAGES or not isinstance(identity,str) or not re.fullmatch(r'[a-zA-Z0-9:_\-.]{1,160}',identity):
        raise ValueError('Invalid operation identity')
    state=item.get('state')
    if state not in STATES: raise ValueError('Invalid operation state')
    clean={'id':identity,'page':page,'account':account,'state':state,'reported':True}
    for field in ('hash','target_hash'):
        value=item.get(field)
        if value:
            if not isinstance(value,str) or not HASH.fullmatch(value): raise ValueError('Invalid hash')
            clean[field]=value.lower()
    for field in ('input_amount','output_amount','amount_ld','amount'):
        value=item.get(field)
        if value is not None:
            if not re.fullmatch(r'\d{1,78}',str(value)): raise ValueError('Invalid amount')
            clean[field]=str(value)
    for field in ('input_asset','output_asset','asset','operation','target_chain'):
        value=item.get(field)
        if value is not None:
            if not isinstance(value,str) or not re.fullmatch(r'[a-zA-Z0-9 _\-]{1,48}',value): raise ValueError('Invalid operation field')
            clean[field]=value
    chain=item.get('chain')
    if chain is not None:
        if chain not in (56,5042): raise ValueError('Invalid chain')
        clean['chain']=chain
    now=int(time.time())
    previous=c.execute('SELECT body,created_at FROM operation_results WHERE account=? AND page=? AND id=?',(account,page,identity)).fetchone()
    if previous:
        old=json.loads(previous['body'])
        if old.get('hash') and clean.get('hash',old['hash'])!=old['hash']: raise ValueError('Operation hash cannot change')
        # A delayed initial request must not overwrite a later terminal result.
        ranks={'pending':0,'unknown':1,'submitted':2,'error':3,'cancelled':4,'failed':4,'success':4,'verified':4}
        if ranks[state]<ranks[old['state']]: return {'saved':True}
        clean={**old,**clean};created=previous['created_at']
    else:
        if c.execute('SELECT count(*) FROM operation_results WHERE account=?',(account,)).fetchone()[0]>=10000: raise ValueError('Operation limit reached')
        created=now
    clean['created_at']=created
    c.execute('''INSERT INTO operation_results(account,page,id,body,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(account,page,id)
      DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at''',(account,page,identity,json.dumps(clean,separators=(',',':')),created,now))
    if previous and not old.get('hash') and clean.get('hash'):
        c.execute('UPDATE operation_results SET index_checks=0 WHERE account=? AND page=? AND id=?',(account,page,identity))
    c.commit()
    return {'saved':True}

def index_pending(c,h):
    rows=c.execute('SELECT account,page,id,body FROM operation_results WHERE index_checks<3 ORDER BY updated_at LIMIT 5').fetchall()
    for row in rows:
        item=json.loads(row['body']);tx_hash=item.get('hash')
        # No-hash attempts are retained as reported results; never invent a tx.
        if tx_hash and not item.get('operation','').startswith('approve'):
            try:
                if row['page'] in ('buy','swap'): h.upsert_journey(c,row['page'],tx_hash)
                elif row['page']=='usdc': h.upsert_usdc_source(c,tx_hash)
                elif row['page']=='bridge': h.upsert_source(c,item['chain'],tx_hash)
            except (ValueError,TypeError,KeyError,TimeoutError,OSError): pass
        c.execute('UPDATE operation_results SET index_checks=index_checks+1 WHERE account=? AND page=? AND id=?',(row['account'],row['page'],row['id']))
    c.commit()

def merged(c,account,page,verified):
    items=[dict(row) for row in verified]
    hashes={item.get('tx_hash',item.get('source_hash')) for item in items}
    for row in c.execute('SELECT body FROM operation_results WHERE account=? AND page=? ORDER BY created_at DESC,id DESC',(account,page)):
        item=json.loads(row['body'])
        if item.get('hash') in hashes: continue
        item['status']='cancelled' if item['state']=='cancelled' else 'error' if item['state'] in ('failed','error') else 'unknown'
        if page in ('buy','swap'): item['tx_hash']=item.get('hash');item['kind']=page
        else: item['source_hash']=item.get('hash')
        if page=='bridge': item['target_chain']=5042 if item.get('chain')==56 else 56
        items.append(item)
    return sorted(items,key=lambda item:(item['created_at'],item.get('id',item.get('tx_hash',item.get('source_hash',''))) or ''),reverse=True)
