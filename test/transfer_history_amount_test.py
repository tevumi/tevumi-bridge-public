"""Amount and legacy-schema checks for the read-only history index."""
import importlib.util
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

source = Path(__file__).resolve().parents[1] / 'ops/transfer-history/service.py'
spec = importlib.util.spec_from_file_location('transfer_history', source)
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)


class AmountHistoryTest(unittest.TestCase):
    def test_wrapped_wotr_send_requires_authenticated_receipt(self):
        account = '0x' + '1' * 40
        bridge = history.ASSETS['wotr'][56]
        words = lambda *values: '0x' + ''.join(f'{value:064x}' for value in values)
        amount = 1000 * 10**18
        tx = {'from': account, 'to': '0x' + '9' * 40, 'input': '0xcef6d209', 'blockNumber': '0x1'}
        sent = {'address': bridge, 'topics': [history.OFT_SENT, '0x' + '3' * 64, words(int(account, 16))],
                'data': words(30417, amount, amount)}
        debit = {'address': history.WOTR[56], 'topics': [history.TRANSFER, words(int(account, 16)), words(int(bridge, 16))], 'data': words(amount)}
        receipt = {'status': '0x1', 'logs': [sent, debit]}
        with patch.object(history, 'rpc', side_effect=[tx, receipt]):
            row = history.inspect_source(56, '0x' + '2' * 64)
        self.assertEqual(row['asset'], 'wotr')
        self.assertEqual(row['amount_ld'], str(amount))
        self.assertEqual(row['account'], account)
        cases = {
            'failed wrapper': {'status': '0x0', 'logs': [sent, debit]},
            'fake emitter': {'status': '0x1', 'logs': [{**sent, 'address': tx['to']}, debit]},
            'multiple sends': {'status': '0x1', 'logs': [sent, sent, debit]},
            'wrong sender': {'status': '0x1', 'logs': [{**sent, 'topics': [history.OFT_SENT, sent['topics'][1], words(5)]}, debit]},
            'missing debit': {'status': '0x1', 'logs': [sent]},
            'wrong debit': {'status': '0x1', 'logs': [sent, {**debit, 'data': words(amount - 1)}]},
            'wrong route': {'status': '0x1', 'logs': [{**sent, 'data': words(30102, amount, amount)}, debit]},
        }
        for label, invalid in cases.items():
            with self.subTest(label=label), patch.object(history, 'rpc', side_effect=[tx, invalid]):
                with self.assertRaises(ValueError):
                    history.inspect_source(56, '0x' + '2' * 64)
        with patch.object(history, 'rpc', return_value={**tx, 'blockNumber': None}):
            with self.assertRaises(ValueError):
                history.inspect_source(56, '0x' + '2' * 64)

    def test_wotr_is_mapped_to_dedicated_bridge(self):
        self.assertEqual(history.ASSETS['wotr'][56], '0xac93aa5dfd4dff9fc57c470fc6c9172f7a9bfbcf')
        self.assertEqual(history.ASSETS['wotr'][5042], '0x70cedd901366ad932203bbb08b22dcd4d4510028')

    def test_new_bridge_requires_real_collateral_and_burn_and_arrival(self):
        account = '0x' + '1' * 40
        guid = '0x' + '3' * 64
        amount = 1000 * 10**18
        zero = '0x' + '0' * 40
        words = lambda *values: '0x' + ''.join(f'{value:064x}' for value in values)
        topic = lambda address: words(int(address, 16))
        for chain, target_chain in ((56, 5042), (5042, 56)):
            bridge = history.ASSETS['wotr-four'][chain]
            target = history.ASSETS['wotr-four'][target_chain]
            token = history.SOURCE_TOKENS['wotr-four'] if chain == 56 else bridge
            debit_to = bridge if chain == 56 else zero
            sent = {'address': bridge, 'topics': [history.OFT_SENT, guid, topic(account)],
                    'data': words(history.EIDS[target_chain], amount, amount)}
            debit = {'address': token, 'topics': [history.TRANSFER, topic(account), topic(debit_to)], 'data': words(amount)}
            tx = {'from': account, 'to': bridge, 'input': '0xc7c7f5b3', 'blockNumber': '0x1'}
            receipt = {'status': '0x1', 'logs': [sent, debit]}
            with patch.object(history, 'rpc', side_effect=[tx, receipt]):
                row = history.inspect_source(chain, '0x' + '2' * 64)
            self.assertEqual(row['asset'], 'wotr-four')
            self.assertEqual(row['amount_ld'], str(amount))
            for bad in ([sent], [sent, {**debit, 'address': history.WOTR[chain]}],
                        [sent, {**debit, 'data': words(amount - 1)}]):
                with patch.object(history, 'rpc', side_effect=[tx, {**receipt, 'logs': bad}]):
                    with self.assertRaises(ValueError):
                        history.inspect_source(chain, '0x' + '2' * 64)
            arrival = {'address': target, 'topics': [history.OFT_RECEIVED, guid, topic(account)],
                       'data': words(history.EIDS[chain], amount)}
            credit = {'address': target if target_chain == 5042 else history.SOURCE_TOKENS['wotr-four'],
                      'topics': [history.TRANSFER, topic(zero if target_chain == 5042 else target), topic(account)],
                      'data': words(amount)}
            with patch.object(history, 'rpc', return_value={'status': '0x1', 'logs': [arrival, credit]}):
                self.assertTrue(history.inspect_target(row, '0x' + '4' * 64))
            for bad in ([arrival], [arrival, {**credit, 'address': history.WOTR[target_chain]}],
                        [arrival, {**credit, 'data': words(amount - 1)}],
                        [{**arrival, 'address': history.ASSETS['wotr'][target_chain]}, credit]):
                with patch.object(history, 'rpc', return_value={'status': '0x1', 'logs': bad}):
                    self.assertFalse(history.inspect_target(row, '0x' + '4' * 64))

    def test_existing_verified_rows_gain_legacy_amount(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'history.sqlite3')
            with closing(sqlite3.connect(path)) as db:
                db.execute('''CREATE TABLE transfers (chain INTEGER NOT NULL,source_hash TEXT NOT NULL,
                  account TEXT NOT NULL,asset TEXT NOT NULL,target_chain INTEGER NOT NULL,guid TEXT,
                  target_hash TEXT,status TEXT NOT NULL,created_at INTEGER NOT NULL,
                  checked_at INTEGER NOT NULL,PRIMARY KEY(chain,source_hash))''')
                db.execute('''INSERT INTO transfers VALUES (56,?,?,'cat',5042,?,?,'arrived',1,1)''',
                           ('0x' + 'a' * 64, '0x' + 'b' * 40, '0x' + 'c' * 64, '0x' + 'd' * 64))
                db.commit()
            with patch.object(history, 'DB_PATH', path):
                db = history.database()
                self.assertEqual(db.execute('SELECT amount_ld FROM transfers').fetchone()[0], str(10**12))
                db.close()

    def test_verified_source_and_target_use_event_amount(self):
        for asset in ('cat', 'wotr'):
            with self.subTest(asset=asset):
                self._check_verified_source_and_target(asset)

    def _check_verified_source_and_target(self, asset):
        address = history.ASSETS[asset][56]
        account = '0x' + '1' * 40
        tx_hash = '0x' + '2' * 64
        guid = '0x' + '3' * 64
        amount = 5 * 10**12
        words = lambda *values: '0x' + ''.join(f'{value:064x}' for value in values)
        source_tx = {'from': account, 'to': address, 'input': '0xc7c7f5b3', 'blockNumber': '0x1'}
        source_receipt = {'status': '0x1', 'logs': [{'address': address, 'topics': [history.OFT_SENT, guid, '0x' + f'{int(account, 16):064x}'], 'data': words(30417, amount, amount)}]}
        with patch.object(history, 'rpc', side_effect=[source_tx, source_receipt]):
            row = history.inspect_source(56, tx_hash)
        self.assertEqual(row['asset'], asset)
        self.assertEqual(row['amount_ld'], str(amount))
        target_receipt = {'status': '0x1', 'logs': [{'address': history.ASSETS[asset][5042], 'topics': [history.OFT_RECEIVED, guid, '0x' + f'{int(account, 16):064x}'], 'data': words(30102, amount)}]}
        with patch.object(history, 'rpc', return_value=target_receipt):
            self.assertTrue(history.inspect_target(row, '0x' + '4' * 64))
        target_receipt['logs'][0]['data'] = words(30102, 10**12)
        with patch.object(history, 'rpc', return_value=target_receipt):
            self.assertFalse(history.inspect_target(row, '0x' + '4' * 64))


if __name__ == '__main__':
    unittest.main()
