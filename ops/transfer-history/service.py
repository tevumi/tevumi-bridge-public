"""Verified, read-only bridge history index. No wallet or signing credentials."""
import json
import os
import re
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DB_PATH = os.environ.get('TEVUMI_HISTORY_DB', '/var/lib/tevumi/transfer-history.sqlite3')
HOST = os.environ.get('TEVUMI_HISTORY_HOST', '127.0.0.1')
PORT = int(os.environ.get('TEVUMI_HISTORY_PORT', '8765'))
RPC = {
    56: 'https://bsc-dataseed.bnbchain.org',
    5042: 'https://rpc.mainnet.arc.io',
}
ASSETS = {
    'binancelife': {56: '0x89f3a44786c97618cc4b45721d433c9a83921ec4', 5042: '0x9af52e914dcc692af046a136ac1c59f98f7347e7'},
    'cat': {56: '0x561750f93bac5bc237de7fe092b9a40e1cc20b06', 5042: '0x503200c60aaa078899b31268833c5f090693e30b'},
}
EIDS = {56: 30102, 5042: 30417}
ADDRESS = re.compile(r'^0x[0-9a-f]{40}$', re.I)
HASH = re.compile(r'^0x[0-9a-f]{64}$', re.I)

# Keccak event selectors are computed from the deployed contract ABI.
OFT_SENT = '0x85496b760a4b7f8d66384b9df21b381f5d1b1e79f229a47aaf4c232edc2fe59a'
OFT_RECEIVED = '0xefed6d3500546b29533b128a29e3a94d70788727f0507505ac12eaf2e578fd9c'


def rpc(chain, method, params):
    payload = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode()
    request = urllib.request.Request(RPC[chain], payload, {'content-type': 'application/json',
                                   'user-agent': 'Mozilla/5.0', 'origin': 'https://bridge.tevumi.com'})
    with urllib.request.urlopen(request, timeout=20) as response:
        body = json.load(response)
    if 'error' in body or body.get('result') is None:
        raise ValueError(f'RPC {chain} {method} failed')
    return body['result']


def database():
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA journal_mode=WAL')
    connection.execute('''CREATE TABLE IF NOT EXISTS transfers (
      chain INTEGER NOT NULL, source_hash TEXT NOT NULL, account TEXT NOT NULL,
      asset TEXT NOT NULL, target_chain INTEGER NOT NULL, guid TEXT,
      target_hash TEXT, status TEXT NOT NULL, amount_ld TEXT, created_at INTEGER NOT NULL,
      checked_at INTEGER NOT NULL, PRIMARY KEY(chain, source_hash))''')
    if 'amount_ld' not in {row[1] for row in connection.execute('PRAGMA table_info(transfers)')}:
        connection.execute('ALTER TABLE transfers ADD COLUMN amount_ld TEXT')
        # All records before this migration passed the exact 0.000001 event check.
        connection.execute("UPDATE transfers SET amount_ld=? WHERE status IN ('in_transit','arrived')", (str(10**12),))
        connection.commit()
    connection.execute('CREATE INDEX IF NOT EXISTS transfers_account_time ON transfers(account, created_at DESC)')
    return connection


def matching_log(receipt, address, topic):
    return next((log for log in receipt.get('logs', [])
                 if log.get('address', '').lower() == address and
                 len(log.get('topics', [])) >= 3 and log['topics'][0].lower() == topic), None)


def inspect_source(chain, tx_hash):
    tx = rpc(chain, 'eth_getTransactionByHash', [tx_hash])
    if not tx or not ADDRESS.fullmatch(tx.get('from', '')):
        raise ValueError('Transaction not found')
    asset = next((name for name, addresses in ASSETS.items()
                  if tx.get('to', '').lower() == addresses[chain]), None)
    if not asset:
        raise ValueError('Not a Tevumi bridge transaction')
    if not tx.get('input', '').lower().startswith('0xc7c7f5b3'):
        raise ValueError('Not a bridge send transaction')
    target_chain = 5042 if chain == 56 else 56
    receipt = rpc(chain, 'eth_getTransactionReceipt', [tx_hash]) if tx.get('blockNumber') else None
    status, guid, amount_ld = 'pending', None, None
    if receipt:
        if int(receipt['status'], 16) == 0:
            status = 'failed'
        else:
            log = matching_log(receipt, ASSETS[asset][chain], OFT_SENT)
            if not log:
                raise ValueError('Confirmed transaction has no matching OFTSent event')
            # OFTSent(guid indexed, dstEid, fromAddress indexed, amountSentLD, amountReceivedLD)
            if int(log['topics'][2][-40:], 16) != int(tx['from'], 16):
                raise ValueError('Sender mismatch')
            words = [log['data'][2+i:2+i+64] for i in range(0, len(log['data'])-2, 64)]
            if len(words) < 3 or int(words[0], 16) != EIDS[target_chain] or int(words[1], 16) < 10**12 or int(words[1], 16) % 10**12 or int(words[1], 16) != int(words[2], 16):
                raise ValueError('Transfer parameters mismatch')
            status, guid, amount_ld = 'in_transit', log['topics'][1].lower(), str(int(words[1], 16))
    return {'chain': chain, 'source_hash': tx_hash.lower(), 'account': tx['from'].lower(),
            'asset': asset, 'target_chain': target_chain, 'guid': guid, 'status': status, 'amount_ld': amount_ld}


def inspect_target(row, target_hash):
    chain = row['target_chain']
    if not HASH.fullmatch(target_hash):
        return False
    receipt = rpc(chain, 'eth_getTransactionReceipt', [target_hash])
    if not receipt or int(receipt['status'], 16) != 1:
        return False
    log = matching_log(receipt, ASSETS[row['asset']][chain], OFT_RECEIVED)
    if not log or log['topics'][1].lower() != row['guid'] or int(log['topics'][2][-40:], 16) != int(row['account'], 16):
        return False
    words = [log['data'][2+i:2+i+64] for i in range(0, len(log['data'])-2, 64)]
    return len(words) >= 2 and row['amount_ld'] is not None and int(words[0], 16) == EIDS[row['chain']] and int(words[1], 16) == int(row['amount_ld'])


def destination_hash(guid, source_chain, target_chain):
    url = f'https://scan.layerzero-api.com/v1/messages/guid/{guid}'
    with urllib.request.urlopen(url, timeout=15) as response:
        result = json.load(response)
    for item in result.get('data', []):
        pathway = item.get('pathway') or {}
        if item.get('guid', '').lower() == guid and pathway.get('srcEid') == EIDS[source_chain] and pathway.get('dstEid') == EIDS[target_chain]:
            return (((item.get('destination') or {}).get('tx') or {}).get('txHash'))
    return None


def upsert_source(connection, chain, tx_hash):
    item = inspect_source(chain, tx_hash)
    now = int(time.time())
    connection.execute('''INSERT INTO transfers(chain,source_hash,account,asset,target_chain,guid,status,amount_ld,created_at,checked_at)
      VALUES(:chain,:source_hash,:account,:asset,:target_chain,:guid,:status,:amount_ld,:created_at,:checked_at)
      ON CONFLICT(chain,source_hash) DO UPDATE SET guid=excluded.guid,
      status=CASE WHEN transfers.status='arrived' THEN 'arrived' ELSE excluded.status END,
      amount_ld=COALESCE(excluded.amount_ld,transfers.amount_ld),
      checked_at=excluded.checked_at''', {**item, 'created_at': now, 'checked_at': now})
    connection.commit()
    return item


def update_pending(connection):
    rows = connection.execute("SELECT * FROM transfers WHERE status IN ('pending','in_transit') ORDER BY checked_at LIMIT 20").fetchall()
    for row in rows:
        try:
            if row['status'] == 'pending':
                upsert_source(connection, row['chain'], row['source_hash'])
                continue
            target = destination_hash(row['guid'], row['chain'], row['target_chain'])
            if target and inspect_target(row, target):
                connection.execute("UPDATE transfers SET status='arrived',target_hash=?,checked_at=? WHERE chain=? AND source_hash=?",
                                   (target.lower(), int(time.time()), row['chain'], row['source_hash']))
            else:
                connection.execute('UPDATE transfers SET checked_at=? WHERE chain=? AND source_hash=?',
                                   (int(time.time()), row['chain'], row['source_hash']))
            connection.commit()
        except (ValueError, TimeoutError, urllib.error.URLError, OSError):
            continue


class Handler(BaseHTTPRequestHandler):
    def send_json(self, code, data):
        body = json.dumps(data, separators=(',', ':')).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        from urllib.parse import urlparse, parse_qs
        url = urlparse(self.path)
        if url.path == '/healthz':
            return self.send_json(200, {'ok': True})
        if url.path != '/transfers':
            return self.send_json(404, {'error': 'Not found'})
        query = parse_qs(url.query)
        account = query.get('account', [''])[0].lower()
        if not ADDRESS.fullmatch(account):
            return self.send_json(400, {'error': 'Invalid wallet address'})
        try:
            page = min(max(int(query.get('page', ['0'])[0]), 0), 10000)
        except ValueError:
            return self.send_json(400, {'error': 'Invalid page'})
        with closing(database()) as connection:
            rows = connection.execute('''SELECT chain,source_hash,asset,target_chain,target_hash,status,amount_ld,created_at
              FROM transfers WHERE account=? ORDER BY created_at DESC,source_hash DESC LIMIT 11 OFFSET ?''',
              (account, page * 10)).fetchall()
        return self.send_json(200, {'items': [dict(row) for row in rows[:10]], 'more': len(rows) > 10})

    def do_POST(self):
        if self.path != '/transfers':
            return self.send_json(404, {'error': 'Not found'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 1 or size > 256:
                raise ValueError('Invalid body')
            item = json.loads(self.rfile.read(size))
            chain, tx_hash = item.get('chain'), item.get('hash', '')
            if chain not in RPC or not HASH.fullmatch(tx_hash):
                raise ValueError('Invalid transaction')
            with closing(database()) as connection:
                result = upsert_source(connection, chain, tx_hash)
            return self.send_json(200, {'status': result['status']})
        except (ValueError, TypeError, KeyError, TimeoutError, urllib.error.URLError, OSError) as error:
            return self.send_json(400, {'error': str(error)[:120]})


def worker():
    while True:
        try:
            with closing(database()) as connection:
                update_pending(connection)
        except (sqlite3.Error, OSError):
            pass
        time.sleep(20)


if __name__ == '__main__':
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with closing(database()):
        pass
    threading.Thread(target=worker, daemon=True).start()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
