"""Fail-closed checks for the server's verified Circle USDC history."""
import importlib.util
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

directory = Path(__file__).resolve().parents[1] / 'ops/transfer-history'
sys.path.insert(0, str(directory))
import cctp_history as cctp

spec = importlib.util.spec_from_file_location('transfer_history_cctp', directory / 'service.py')
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)

ACCOUNT = '0x' + '12' * 20
RECIPIENT = '0x' + '34' * 32
TX = '0x' + '56' * 32
AMOUNT = 2_000_000
BASE = cctp.CHAINS[6]


def source_receipt(amount=AMOUNT, domain=6):
    word = lambda value: f'{value:064x}'
    return {'status': '0x1', 'logs': [{
        'address': cctp.ARC['tokenMessenger'],
        'topics': [cctp.DEPOSIT_FOR_BURN, cctp.evm_bytes32(cctp.ARC_USDC),
                   cctp.evm_bytes32(ACCOUNT), '0x' + word(2000)],
        'data': '0x' + word(amount) + RECIPIENT[2:] + word(domain) +
                cctp.evm_bytes32(BASE['tokenMessenger'])[2:] + word(0) + word(0),
    }]}


def message(amount=AMOUNT, domain=6):
    raw = bytearray(148 + 228)
    raw[0:4] = (1).to_bytes(4, 'big')
    raw[4:8] = (26).to_bytes(4, 'big')
    raw[8:12] = domain.to_bytes(4, 'big')
    raw[12:44] = bytes.fromhex('11' * 32)
    raw[44:76] = bytes.fromhex(cctp.evm_bytes32(cctp.ARC['tokenMessenger'])[2:])
    raw[76:108] = bytes.fromhex(cctp.evm_bytes32(BASE['tokenMessenger'])[2:])
    raw[148:152] = (1).to_bytes(4, 'big')
    raw[152:184] = bytes.fromhex(cctp.evm_bytes32(cctp.ARC_USDC)[2:])
    raw[184:216] = bytes.fromhex(RECIPIENT[2:])
    raw[216:248] = amount.to_bytes(32, 'big')
    return {'message': '0x' + raw.hex(), 'status': 'complete'}


class CircleHistoryTest(unittest.TestCase):
    def test_only_confirmed_arc_circle_burn_is_indexed(self):
        def call(url, method, params):
            return '0x13b2' if method == 'eth_chainId' else source_receipt()
        row = cctp.inspect_source(TX, call)
        self.assertEqual((row['account'], row['amount'], row['target_chain']), (ACCOUNT, str(AMOUNT), 'Base'))
        self.assertEqual(cctp.matching_nonce(row, [message()]), '0x' + '11' * 32)
        self.assertIsNone(cctp.matching_nonce(row, [message(amount=AMOUNT + 1)]))
        self.assertIsNone(cctp.matching_nonce(row, [message(domain=0)]))
        with self.assertRaisesRegex(ValueError, 'chain mismatch'):
            cctp.inspect_source(TX, lambda url, method, params: '0x1')
        with self.assertRaisesRegex(ValueError, 'Expected one'):
            cctp.inspect_source(TX, lambda url, method, params: '0x13b2' if method == 'eth_chainId' else {'status': '0x1', 'logs': []})

    def test_destination_requires_correct_chain_and_used_nonce(self):
        row = {'target_domain': 6}
        nonce = '0x' + '11' * 32
        def used(url, method, params):
            self.assertEqual(url, BASE['rpc'])
            if method == 'eth_chainId': return hex(BASE['chainId'])
            self.assertEqual(params[0]['data'], cctp.USED_NONCES + nonce[2:])
            return '0x1'
        self.assertTrue(cctp.destination_used(row, nonce, used))
        self.assertFalse(cctp.destination_used(row, nonce, lambda url, method, params: hex(BASE['chainId']) if method == 'eth_chainId' else '0x0'))
        with self.assertRaisesRegex(ValueError, 'chain mismatch'):
            cctp.destination_used(row, nonce, lambda url, method, params: '0x1')

    def test_server_preserves_verified_source_and_upgrades_only_on_target_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(service, 'DB_PATH', str(Path(temp) / 'history.sqlite3')):
                with closing(service.database()) as db:
                    row = {'source_hash': TX, 'account': ACCOUNT, 'amount': str(AMOUNT),
                           'target_chain': 'Base', 'target_domain': 6, 'mint_recipient': RECIPIENT}
                    with patch.object(cctp, 'inspect_source', return_value=row):
                        saved = service.upsert_usdc_source(db, TX)
                    self.assertEqual(saved['status'], 'source_confirmed')
                    with patch.object(cctp, 'iris_messages', return_value=[message()]), \
                         patch.object(cctp, 'destination_used', return_value=False):
                        service.update_usdc_pending(db)
                    self.assertEqual(db.execute('SELECT status FROM usdc_transfers').fetchone()[0], 'source_confirmed')
                    with patch.object(cctp, 'destination_used', return_value=True):
                        service.update_usdc_pending(db)
                    self.assertEqual(db.execute('SELECT status FROM usdc_transfers').fetchone()[0], 'arrived')
                    with patch.object(cctp, 'inspect_source', return_value=row):
                        self.assertEqual(service.upsert_usdc_source(db, TX)['status'], 'arrived')


if __name__ == '__main__':
    unittest.main()
