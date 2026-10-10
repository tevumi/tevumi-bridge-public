"""Verified, read-only bridge history index. No wallet or signing credentials."""
import json
import os
import re
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, os.path.dirname(__file__))
import cctp_history
import swap_history
import buy_history
import operation_results
import sell_history
from types import SimpleNamespace

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
    'wotr': {56: '0xac93aa5dfd4dff9fc57c470fc6c9172f7a9bfbcf', 5042: '0x70cedd901366ad932203bbb08b22dcd4d4510028'},
    'wotr-four': {56: '0x7b0036fec706761864cfbfa72e6da09da6e61e6b', 5042: '0x0fc104231002e1da57ec5af516f9caca6c4f7bfb'},
}
EIDS = {56: 30102, 5042: 30417}
ADDRESS = re.compile(r'^0x[0-9a-f]{40}$', re.I)
HASH = re.compile(r'^0x[0-9a-f]{64}$', re.I)
JOURNEY = {'buy': (56, '0x10ed43c718714eb63d5aa57b78b54704e256024e', '0x7ff36ab5'),
           'swap': (5042, '0x4fca4a51ab4f23a7447b3284fbd7d73289a89fb1', '0x3593564c')}
WOTR = {56: '0xb97b99cb6dc0edbb89512e14100b2e9c23132ee5', 5042: ASSETS['wotr'][5042]}
SOURCE_TOKENS = {'wotr': WOTR[56], 'wotr-four': '0xe2a0ce4be658ee9b09e461f5283c718a20984444',
                 'cat': '0x6894cde390a3f51155ea41ed24a33a4827d3063d',
                 'binancelife': '0x924fa68a0fc644485b8df8abfa0a41c2e7744444'}
WBNB = '0xbb4cdb9cbd36b01bD1cBaEBF2De08d9173bc095c'.lower()
BNB_PAIR = '0x36092bcf2b17808469ac92ee0f1a9a2cb71dba87'
ARC_POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951'
TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

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
    connection.execute('''CREATE TABLE IF NOT EXISTS usdc_transfers (
      source_hash TEXT PRIMARY KEY, account TEXT NOT NULL, amount TEXT NOT NULL,
      target_chain TEXT NOT NULL, target_domain INTEGER NOT NULL, mint_recipient TEXT NOT NULL,
      nonce TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL, checked_at INTEGER NOT NULL)''')
    connection.execute('CREATE INDEX IF NOT EXISTS usdc_account_time ON usdc_transfers(account, created_at DESC)')
    connection.execute('''CREATE TABLE IF NOT EXISTS journey_transfers (
      kind TEXT NOT NULL, tx_hash TEXT NOT NULL, account TEXT NOT NULL,
      input_amount TEXT, output_amount TEXT, status TEXT NOT NULL,
      block_number INTEGER, created_at INTEGER NOT NULL, checked_at INTEGER NOT NULL,
      PRIMARY KEY(kind, tx_hash))''')
    columns = {row[1] for row in connection.execute('PRAGMA table_info(journey_transfers)')}
    for name in ('input_asset', 'output_asset', 'token_address', 'buy_route'):
        if name not in columns:
            connection.execute(f'ALTER TABLE journey_transfers ADD COLUMN {name} TEXT')
    connection.execute("UPDATE journey_transfers SET input_asset=CASE WHEN kind='buy' THEN 'BNB' ELSE 'WOTR' END, output_asset=CASE WHEN kind='buy' THEN 'WOTR' ELSE 'USDC' END WHERE input_asset IS NULL OR output_asset IS NULL")
    connection.execute("UPDATE journey_transfers SET token_address=? WHERE kind='buy' AND token_address IS NULL", (WOTR[56],))
    operation_results.initialize(connection)
    connection.commit()
    connection.execute('CREATE INDEX IF NOT EXISTS journey_account_time ON journey_transfers(account,kind,created_at DESC)')
    return connection


def transaction_words(data):
    if not isinstance(data, str) or not re.fullmatch(r'0x[0-9a-fA-F]*', data) or (len(data) - 10) % 64:
        raise ValueError('Invalid transaction input')
    return [int(data[i:i+64], 16) for i in range(10, len(data), 64)]


def journey_input(kind, tx, account):
    data = tx.get('input', '').lower()
    words = transaction_words(data)
    if kind == 'buy':
        if tx.get('to','').lower()==buy_history.MANAGER and data.startswith(buy_history.CURVE_SELECTOR):
            return buy_history.curve_input(tx,words)
        # swapExactETHForTokens(minOut, path, recipient, deadline)
        if len(words) != 7 or words[1] != 128 or words[2] != int(account, 16) or words[4] != 2 or words[5] != int(WBNB, 16) or words[6] not in (int(WOTR[56],16),int(buy_history.TOKEN,16)) or words[0] <= 0 or int(tx.get('value', '0x0'), 16) <= 0:
            raise ValueError('Buy route mismatch')
        return str(int(tx['value'], 16)), words[0]
    reverse, amount, minimum = swap_history.inspect_input(tx)
    return str(amount), minimum


def transfer_amount(receipt, token, sender, recipient):
    total = 0
    for log in receipt.get('logs', []):
        topics = log.get('topics', [])
        if (log.get('address', '').lower() == token and len(topics) == 3
                and topics[0].lower() == TRANSFER
                and int(topics[1], 16) == int(sender, 16)
                and int(topics[2], 16) == int(recipient, 16)):
            total += int(log['data'], 16)
    return total


def inspect_journey(kind, tx_hash):
    if kind not in JOURNEY or not HASH.fullmatch(tx_hash):
        raise ValueError('Invalid journey transaction')
    chain, target, selector = JOURNEY[kind]
    tx = rpc(chain, 'eth_getTransactionByHash', [tx_hash])
    if kind=='buy' and tx and tx.get('input','').lower().startswith((sell_history.CURVE,sell_history.DEX)) and ADDRESS.fullmatch(tx.get('from','')):
        return sell_history.inspect(tx,tx_hash,SimpleNamespace(**globals()))
    curve=kind=='buy' and tx and tx.get('to','').lower()==buy_history.MANAGER and tx.get('input','').lower().startswith(buy_history.CURVE_SELECTOR)
    if not tx or not ADDRESS.fullmatch(tx.get('from', '')) or not (curve or tx.get('to', '').lower() == target and tx.get('input', '').lower().startswith(selector)):
        raise ValueError('Not a Tevumi journey transaction')
    account = tx['from'].lower()
    input_amount, minimum = journey_input(kind, tx, account)
    new_dex=kind=='buy' and not curve and transaction_words(tx['input'])[6]==int(buy_history.TOKEN,16)
    token_address=buy_history.TOKEN if curve or new_dex else WOTR[chain]
    buy_route='four-curve' if curve else 'pancake-v2' if kind=='buy' else None
    reverse = kind == 'swap' and int(tx.get('value', '0x0'), 16) > 0
    input_asset = 'BNB' if kind == 'buy' else 'USDC' if reverse else 'WOTR'
    output_asset = 'WOTR' if kind == 'buy' or reverse else 'USDC'
    status, output_amount, block_number = 'pending', None, None
    created_at = int(time.time())
    receipt = rpc(chain, 'eth_getTransactionReceipt', [tx_hash]) if tx.get('blockNumber') else None
    if receipt:
        block_number = int(receipt['blockNumber'], 16)
        block = rpc(chain, 'eth_getBlockByNumber', [hex(block_number), False])
        if not block or not block.get('timestamp'):
            raise ValueError('Transaction block time unavailable')
        created_at = int(block['timestamp'], 16)
        if int(receipt['status'], 16) == 0:
            status = 'failed'
        elif kind == 'buy':
            if curve:
                received=buy_history.curve_output(receipt,account,minimum,transfer_amount)
            else:
                pair=BNB_PAIR
                if new_dex:
                    data='0xe6a43905'+f'{int(WBNB,16):064x}'+f'{int(buy_history.TOKEN,16):064x}'
                    encoded=rpc(56,'eth_call',[{'to':buy_history.FACTORY,'data':data},receipt['blockNumber']])
                    if not re.fullmatch(r'0x0{24}[0-9a-fA-F]{40}',encoded) or int(encoded,16)==0: raise ValueError('Buy pair unavailable')
                    pair='0x'+encoded[-40:].lower()
                received = transfer_amount(receipt, token_address, pair, account)
            if received < minimum:
                raise ValueError('Buy receipt has no matching WOTR delivery')
            status, output_amount = 'verified', str(received)
        else:
            received = swap_history.receipt_output(receipt, reverse, int(input_amount), minimum)
            moved = transfer_amount(receipt, WOTR[5042],
                                    ARC_POOL_MANAGER if reverse else account,
                                    account if reverse else ARC_POOL_MANAGER)
            if moved != (received if reverse else int(input_amount)):
                raise ValueError('Swap receipt has no matching wallet transfer')
            status, output_amount = 'verified', str(received)
    return {'kind': kind, 'tx_hash': tx_hash.lower(), 'account': account,
            'input_amount': input_amount, 'output_amount': output_amount,
            'input_asset': input_asset, 'output_asset': output_asset,
            'token_address': token_address, 'buy_route': buy_route,
            'status': status, 'block_number': block_number, 'created_at': created_at}


def upsert_journey(connection, kind, tx_hash):
    item = inspect_journey(kind, tx_hash)
    now = int(time.time())
    connection.execute('''INSERT INTO journey_transfers
      (kind,tx_hash,account,input_amount,output_amount,input_asset,output_asset,token_address,buy_route,status,block_number,created_at,checked_at)
      VALUES(:kind,:tx_hash,:account,:input_amount,:output_amount,:input_asset,:output_asset,:token_address,:buy_route,:status,:block_number,:created_at,:checked_at)
      ON CONFLICT(kind,tx_hash) DO UPDATE SET input_amount=COALESCE(excluded.input_amount,journey_transfers.input_amount),
      output_amount=COALESCE(excluded.output_amount,journey_transfers.output_amount),
      input_asset=excluded.input_asset,output_asset=excluded.output_asset,
      token_address=excluded.token_address,buy_route=excluded.buy_route,
      status=excluded.status,block_number=excluded.block_number,created_at=excluded.created_at,
      checked_at=excluded.checked_at''',
      {**item, 'checked_at': now})
    connection.commit()
    return item


def update_journey_pending(connection):
    rows = connection.execute("SELECT kind,tx_hash FROM journey_transfers WHERE status='pending' ORDER BY checked_at LIMIT 20").fetchall()
    for row in rows:
        try:
            upsert_journey(connection, row['kind'], row['tx_hash'])
        except (ValueError, TimeoutError, urllib.error.URLError, OSError, KeyError):
            continue


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
    direct = asset is not None
    if direct and not tx.get('input', '').lower().startswith('0xc7c7f5b3'):
        raise ValueError('Not a bridge send transaction')
    target_chain = 5042 if chain == 56 else 56
    receipt = rpc(chain, 'eth_getTransactionReceipt', [tx_hash]) if tx.get('blockNumber') else None
    if not direct:
        # Wallet routing may wrap send(). Only a successful receipt from a
        # configured bridge can establish its identity; never trust the wrapper.
        if not receipt or int(receipt['status'], 16) != 1:
            raise ValueError('Wrapped bridge transaction not confirmed')
        matches = [(name, log) for name, addresses in ASSETS.items()
                   for log in receipt.get('logs', [])
                   if log.get('address', '').lower() == addresses[chain]
                   and len(log.get('topics', [])) == 3
                   and log['topics'][0].lower() == OFT_SENT]
        if len(matches) != 1:
            raise ValueError('Wrapped transaction needs one verified bridge send')
        asset = matches[0][0]
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
            if (not direct or asset == 'wotr-four') and chain == 56:
                token = SOURCE_TOKENS[asset]
                if transfer_amount(receipt, token, tx['from'], ASSETS[asset][chain]) != int(words[1], 16):
                    raise ValueError('Wrapped bridge token debit mismatch')
            if asset == 'wotr-four' and chain == 5042:
                if transfer_amount(receipt, ASSETS[asset][chain], tx['from'], '0x' + '0' * 40) != int(words[1], 16):
                    raise ValueError('Arc bridge burn mismatch')
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
    matched = len(words) >= 2 and row['amount_ld'] is not None and int(words[0], 16) == EIDS[row['chain']] and int(words[1], 16) == int(row['amount_ld'])
    if matched and row['asset'] == 'wotr-four':
        token = ASSETS['wotr-four'][5042] if chain == 5042 else SOURCE_TOKENS['wotr-four']
        sender = '0x' + '0' * 40 if chain == 5042 else ASSETS['wotr-four'][56]
        return transfer_amount(receipt, token, sender, row['account']) == int(row['amount_ld'])
    return matched


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


def upsert_usdc_source(connection, tx_hash):
    item = cctp_history.inspect_source(tx_hash)
    now = int(time.time())
    connection.execute('''INSERT INTO usdc_transfers
      (source_hash,account,amount,target_chain,target_domain,mint_recipient,status,created_at,checked_at)
      VALUES(:source_hash,:account,:amount,:target_chain,:target_domain,:mint_recipient,'source_confirmed',:created_at,:checked_at)
      ON CONFLICT(source_hash) DO UPDATE SET checked_at=excluded.checked_at''',
      {**item, 'created_at': now, 'checked_at': now})
    connection.commit()
    return connection.execute('SELECT * FROM usdc_transfers WHERE source_hash=?', (item['source_hash'],)).fetchone()


def update_usdc_pending(connection):
    rows = connection.execute("SELECT * FROM usdc_transfers WHERE status='source_confirmed' ORDER BY checked_at LIMIT 20").fetchall()
    for row in rows:
        try:
            nonce = row['nonce'] or cctp_history.matching_nonce(row, cctp_history.iris_messages(row['source_hash']))
            arrived = nonce is not None and cctp_history.destination_used(row, nonce)
            connection.execute('''UPDATE usdc_transfers SET nonce=?, status=?, checked_at=? WHERE source_hash=?''',
                               (nonce, 'arrived' if arrived else 'source_confirmed', int(time.time()), row['source_hash']))
            connection.commit()
        except (ValueError, TimeoutError, urllib.error.URLError, OSError, KeyError):
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
        if url.path == '/operation-results':
            query=parse_qs(url.query)
            account=query.get('account',[''])[0].lower();category=query.get('page',[''])[0]
            if not ADDRESS.fullmatch(account) or category not in operation_results.PAGES:
                return self.send_json(400,{'error':'Invalid operation query'})
            with closing(database()) as connection:
                items=operation_results.merged(connection,account,category,[])
            return self.send_json(200,{'items':items})
        if url.path not in ('/transfers', '/usdc-transfers', '/journey-transfers'):
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
            if url.path == '/journey-transfers':
                kind = query.get('kind', [''])[0]
                if kind not in JOURNEY:
                    return self.send_json(400, {'error': 'Invalid kind'})
                rows = connection.execute('''SELECT kind,tx_hash,input_amount,output_amount,input_asset,output_asset,token_address,buy_route,status,block_number,created_at
                  FROM journey_transfers WHERE account=? AND kind=? ORDER BY created_at DESC,tx_hash DESC''',
                  (account, kind)).fetchall()
            elif url.path == '/usdc-transfers':
                rows = connection.execute('''SELECT source_hash,amount,target_chain,mint_recipient,nonce,status,created_at
                  FROM usdc_transfers WHERE account=? ORDER BY created_at DESC,source_hash DESC''',
                  (account,)).fetchall()
            else:
                rows = connection.execute('''SELECT chain,source_hash,asset,target_chain,target_hash,status,amount_ld,created_at
                  FROM transfers WHERE account=? ORDER BY created_at DESC,source_hash DESC''',
                  (account,)).fetchall()
            category=kind if url.path=='/journey-transfers' else 'usdc' if url.path=='/usdc-transfers' else 'bridge'
            rows=operation_results.merged(connection,account,category,rows)[page*10:page*10+11]
        items = [dict(row) for row in rows[:10]]
        if url.path == '/transfers':
            for item in items:
                item['source_token'] = SOURCE_TOKENS.get(item['asset'])
                item['source_bridge'] = ASSETS.get(item['asset'], {}).get(item['chain'])
                item['target_bridge'] = ASSETS.get(item['asset'], {}).get(item['target_chain'])
        return self.send_json(200, {'items': items, 'more': len(rows) > 10})

    def do_POST(self):
        if self.path == '/operation-results':
            try:
                origin=self.headers.get('Origin')
                if origin and origin!='https://bridge.tevumi.com': raise ValueError('Invalid origin')
                size=int(self.headers.get('Content-Length','0'))
                if size<1 or size>4096: raise ValueError('Invalid body')
                with closing(database()) as connection:
                    result=operation_results.save(connection,json.loads(self.rfile.read(size)))
                return self.send_json(200,result)
            except (ValueError,TypeError,KeyError,sqlite3.Error) as error:
                return self.send_json(400,{'error':str(error)[:120]})
        if self.path not in ('/transfers', '/usdc-transfers', '/journey-transfers'):
            return self.send_json(404, {'error': 'Not found'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 1 or size > 256:
                raise ValueError('Invalid body')
            item = json.loads(self.rfile.read(size))
            with closing(database()) as connection:
                if self.path == '/journey-transfers':
                    result = upsert_journey(connection, item.get('kind'), item.get('hash', ''))
                elif self.path == '/usdc-transfers':
                    tx_hash = item.get('hash', '')
                    result = upsert_usdc_source(connection, tx_hash)
                else:
                    chain, tx_hash = item.get('chain'), item.get('hash', '')
                    if chain not in RPC or not HASH.fullmatch(tx_hash):
                        raise ValueError('Invalid transaction')
                    result = upsert_source(connection, chain, tx_hash)
            return self.send_json(200, {'status': result['status']})
        except (ValueError, TypeError, KeyError, TimeoutError, urllib.error.URLError, OSError) as error:
            return self.send_json(400, {'error': str(error)[:120]})


def worker():
    while True:
        try:
            with closing(database()) as connection:
                update_pending(connection)
                update_usdc_pending(connection)
                update_journey_pending(connection)
                operation_results.index_pending(connection,SimpleNamespace(**globals()))
        except (sqlite3.Error, OSError):
            pass
        time.sleep(20)


if __name__ == '__main__':
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with closing(database()):
        pass
    threading.Thread(target=worker, daemon=True).start()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
