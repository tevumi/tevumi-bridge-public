"""Read-only CCTP V2 evidence checks for the Circle USDC history index."""
import json
import os
import re
import urllib.error
import urllib.request

HASH = re.compile(r'^0x[0-9a-f]{64}$', re.I)
ADDRESS = re.compile(r'^0x[0-9a-f]{40}$', re.I)
DEPOSIT_FOR_BURN = '0x0c8c1cbdc5190613ebd485511d4e2812cfa45eecb79d845893331fedad5130a5'
USED_NONCES = '0xfeb61724'
ARC_USDC = '0x3600000000000000000000000000000000000000'
IRIS = 'https://iris-api.circle.com/v2/messages/26?transactionHash='

with open(os.path.join(os.path.dirname(__file__), 'cctp-chains.json'), encoding='utf-8') as file:
    CONFIG = json.load(file)
CHAINS = {chain['domain']: chain for chain in CONFIG['chains']}
ARC = CHAINS[26]


def rpc(url, method, params):
    payload = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode()
    request = urllib.request.Request(url, payload, {'content-type': 'application/json', 'user-agent': 'Tevumi read-only history'})
    with urllib.request.urlopen(request, timeout=15) as response:
        data = json.load(response)
    if 'error' in data or data.get('result') is None:
        raise ValueError(f'RPC {method} failed')
    return data['result']


def word(data, index):
    value = data[2 + index * 64:2 + (index + 1) * 64]
    if len(value) != 64:
        raise ValueError('Incomplete CCTP event')
    return value.lower()


def evm_bytes32(address):
    return '0x' + '0' * 24 + address[2:].lower()


def inspect_source(tx_hash, call=rpc):
    if not HASH.fullmatch(tx_hash):
        raise ValueError('Invalid transaction hash')
    if int(call(ARC['rpc'], 'eth_chainId', []), 16) != ARC['chainId']:
        raise ValueError('Arc RPC chain mismatch')
    receipt = call(ARC['rpc'], 'eth_getTransactionReceipt', [tx_hash])
    if not receipt:
        raise ValueError('Arc transaction is not confirmed')
    if int(receipt['status'], 16) != 1:
        raise ValueError('Arc transaction failed')
    logs = [log for log in receipt.get('logs', []) if
            log.get('address', '').lower() == ARC['tokenMessenger'].lower() and
            log.get('topics', [''])[0].lower() == DEPOSIT_FOR_BURN]
    if len(logs) != 1:
        raise ValueError('Expected one Circle CCTP V2 burn event')
    log = logs[0]
    topics = log.get('topics', [])
    if len(topics) != 4 or not all(HASH.fullmatch(topic) for topic in topics):
        raise ValueError('Malformed Circle burn topics')
    burn_token = '0x' + topics[1][-40:].lower()
    account = '0x' + topics[2][-40:].lower()
    if burn_token != ARC_USDC or not ADDRESS.fullmatch(account):
        raise ValueError('Not an Arc USDC burn')
    amount = int(word(log['data'], 0), 16)
    recipient = '0x' + word(log['data'], 1)
    domain = int(word(log['data'], 2), 16)
    chain = CHAINS.get(domain)
    if amount <= 0 or not chain or domain == 26:
        raise ValueError('Unsupported CCTP destination')
    if chain['type'] == 'evm' and '0x' + word(log['data'], 3) != evm_bytes32(chain['tokenMessenger']):
        raise ValueError('Destination TokenMessenger mismatch')
    return {'source_hash': tx_hash.lower(), 'account': account, 'amount': str(amount),
            'target_chain': chain['name'], 'target_domain': domain, 'mint_recipient': recipient}


def iris_messages(tx_hash):
    request = urllib.request.Request(IRIS + tx_hash, headers={'user-agent': 'Tevumi read-only history'})
    with urllib.request.urlopen(request, timeout=15) as response:
        data = json.load(response)
    return data.get('messages', [])


def matching_nonce(row, messages):
    for item in messages:
        message = item.get('message', '')
        if not isinstance(message, str) or not re.fullmatch(r'0x[0-9a-fA-F]+', message) or len(message) % 2:
            continue
        raw = bytes.fromhex(message[2:])
        if len(raw) < 148 + 228:
            continue
        if int.from_bytes(raw[4:8], 'big') != 26 or int.from_bytes(raw[8:12], 'big') != row['target_domain']:
            continue
        if raw[44:76].hex() != evm_bytes32(ARC['tokenMessenger'])[2:]:
            continue
        target = CHAINS[row['target_domain']]
        if target['type'] == 'evm' and raw[76:108].hex() != evm_bytes32(target['tokenMessenger'])[2:]:
            continue
        body = raw[148:]
        if body[4:36].hex() != evm_bytes32(ARC_USDC)[2:] or '0x' + body[36:68].hex() != row['mint_recipient']:
            continue
        if int.from_bytes(body[68:100], 'big') != int(row['amount']):
            continue
        nonce = '0x' + raw[12:44].hex()
        if nonce != '0x' + '0' * 64:
            return nonce
    return None


def destination_used(row, nonce, call=rpc):
    chain = CHAINS[row['target_domain']]
    if chain['type'] != 'evm' or not chain['rpc']:
        return False
    if int(call(chain['rpc'], 'eth_chainId', []), 16) != chain['chainId']:
        raise ValueError('Destination RPC chain mismatch')
    result = call(chain['rpc'], 'eth_call', [{'to': chain['messageTransmitter'],
                                            'data': USED_NONCES + nonce[2:]}, 'latest'])
    return int(result, 16) == 1
