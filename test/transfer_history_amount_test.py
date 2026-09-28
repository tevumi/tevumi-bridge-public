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
        address = history.ASSETS['cat'][56]
        account = '0x' + '1' * 40
        tx_hash = '0x' + '2' * 64
        guid = '0x' + '3' * 64
        amount = 5 * 10**12
        words = lambda *values: '0x' + ''.join(f'{value:064x}' for value in values)
        source_tx = {'from': account, 'to': address, 'input': '0xc7c7f5b3', 'blockNumber': '0x1'}
        source_receipt = {'status': '0x1', 'logs': [{'address': address, 'topics': [history.OFT_SENT, guid, '0x' + f'{int(account, 16):064x}'], 'data': words(30417, amount, amount)}]}
        with patch.object(history, 'rpc', side_effect=[source_tx, source_receipt]):
            row = history.inspect_source(56, tx_hash)
        self.assertEqual(row['amount_ld'], str(amount))
        target_receipt = {'status': '0x1', 'logs': [{'address': history.ASSETS['cat'][5042], 'topics': [history.OFT_RECEIVED, guid, '0x' + f'{int(account, 16):064x}'], 'data': words(30102, amount)}]}
        with patch.object(history, 'rpc', return_value=target_receipt):
            self.assertTrue(history.inspect_target(row, '0x' + '4' * 64))
        target_receipt['logs'][0]['data'] = words(30102, 10**12)
        with patch.object(history, 'rpc', return_value=target_receipt):
            self.assertFalse(history.inspect_target(row, '0x' + '4' * 64))


if __name__ == '__main__':
    unittest.main()
