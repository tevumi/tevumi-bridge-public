"""Buy and Swap history must be derived from chain evidence, not browser claims."""
import importlib.util
import tempfile
import sqlite3
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

source = Path(__file__).resolve().parents[1] / 'ops/transfer-history/service.py'
spec = importlib.util.spec_from_file_location('journey_history', source)
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)

ACCOUNT = '0x' + '1' * 40
HASH = '0x' + '2' * 64


def words(*values):
    return ''.join(f'{value:064x}' for value in values)


def transfer(token, sender, recipient, amount):
    return {'address': token, 'topics': [history.TRANSFER,
            '0x' + words(int(sender, 16)), '0x' + words(int(recipient, 16))],
            'data': '0x' + words(amount)}


def pool_event(reverse=False, amount=8, output=11):
    a0, a1 = (-amount, output) if reverse else (output, -amount)
    return {'address': history.ARC_POOL_MANAGER,
            'topics': [history.swap_history.SWAP, history.swap_history.POOL_ID,
                       '0x' + words(int(history.JOURNEY['swap'][1], 16))],
            'data': '0x' + words(a0 % 2**256, a1 % 2**256, 1, 1, 0, 3000)}


class JourneyHistoryTest(unittest.TestCase):
    def test_buy_requires_planned_route_and_delivered_wotr(self):
        data = '0x7ff36ab5' + words(5, 128, int(ACCOUNT, 16), 100, 2,
                                    int(history.WBNB, 16), int(history.WOTR[56], 16))
        tx = {'from': ACCOUNT, 'to': history.JOURNEY['buy'][1], 'input': data,
              'value': '0xa', 'blockNumber': '0x2'}
        receipt = {'status': '0x1', 'blockNumber': '0x2', 'logs': [
            transfer(history.WOTR[56], history.BNB_PAIR, ACCOUNT, 7)]}
        block = {'timestamp':'0x64'}
        with patch.object(history, 'rpc', side_effect=[tx, receipt, block]):
            item = history.inspect_journey('buy', HASH)
        self.assertEqual((item['status'], item['input_amount'], item['output_amount']),
                         ('verified', '10', '7'))
        receipt['logs'][0]['topics'][2] = '0x' + words(int('0x' + '3' * 40, 16))
        with patch.object(history, 'rpc', side_effect=[tx, receipt, block]):
            with self.assertRaisesRegex(ValueError, 'delivery'):
                history.inspect_journey('buy', HASH)

    def test_swap_requires_debit_and_native_usdc_gain(self):
        data = history.swap_history.encode_plan(False, 8, 10, 100)
        tx = {'from': ACCOUNT, 'to': history.JOURNEY['swap'][1], 'input': data,
              'value': '0x0', 'blockNumber': '0x2'}
        receipt = {'status': '0x1', 'blockNumber': '0x2', 'gasUsed': '0x1',
                   'effectiveGasPrice': '0x1', 'logs': [
                       pool_event(), transfer(history.WOTR[5042], ACCOUNT, history.ARC_POOL_MANAGER, 8)]}
        block = {'timestamp':'0x64'}
        with patch.object(history, 'rpc', side_effect=[tx, receipt, block]):
            item = history.inspect_journey('swap', HASH)
        self.assertEqual((item['status'], item['input_amount'], item['output_amount']),
                         ('verified', '8', '11'))
        receipt['logs'][0] = pool_event(output=9)
        with patch.object(history, 'rpc', side_effect=[tx, receipt, block]):
            with self.assertRaisesRegex(ValueError, 'amounts'):
                history.inspect_journey('swap', HASH)

    def test_reverse_requires_native_payment_pool_and_wallet_credit(self):
        tx = {'from':ACCOUNT, 'to':history.JOURNEY['swap'][1],
              'input':history.swap_history.encode_plan(True,8,10,100),
              'value':'0x8', 'blockNumber':'0x2'}
        receipt = {'status':'0x1', 'blockNumber':'0x2', 'logs':[
            pool_event(True), transfer(history.WOTR[5042], history.ARC_POOL_MANAGER, ACCOUNT, 11)]}
        with patch.object(history,'rpc',side_effect=[tx,receipt,{'timestamp':'0x64'}]):
            item=history.inspect_journey('swap',HASH)
        self.assertEqual((item['input_asset'],item['output_asset'],item['input_amount'],item['output_amount']),('USDC','WOTR','8','11'))
        receipt['logs'][1]['topics'][2]='0x'+words(3)
        with patch.object(history,'rpc',side_effect=[tx,receipt,{'timestamp':'0x64'}]):
            with self.assertRaisesRegex(ValueError,'wallet transfer'):
                history.inspect_journey('swap',HASH)
        for value in ('0x0','0x7','0x9'):
            with self.assertRaisesRegex(ValueError,'native payment'):
                history.swap_history.inspect_input({**tx,'value':value})

    def test_swap_rejects_extra_commands_wrong_pool_and_forged_deltas(self):
        data=history.swap_history.encode_plan(True,8,10,100)
        for bad in (data+'00'*32,data.replace(history.WOTR[5042][2:],'3'*40),data[:266]+'11'+data[268:]):
            with self.assertRaises(ValueError):
                history.swap_history.inspect_input({'input':bad,'value':'0x8'})
        for event in (pool_event(True,7),pool_event(True,8,9)):
            with self.assertRaises(ValueError):
                history.swap_history.receipt_output({'logs':[event]},True,8,10)

    def test_legacy_rows_migrate_without_losing_hashes_or_amounts(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(history,'DB_PATH',str(Path(directory)/'old.sqlite3')):
            with closing(sqlite3.connect(history.DB_PATH)) as db:
                db.execute('CREATE TABLE journey_transfers(kind TEXT,tx_hash TEXT,account TEXT,input_amount TEXT,output_amount TEXT,status TEXT,block_number INTEGER,created_at INTEGER,checked_at INTEGER,PRIMARY KEY(kind,tx_hash))')
                db.execute("INSERT INTO journey_transfers VALUES('swap',?,?, '8','11','verified',2,100,100)",(HASH,ACCOUNT))
                db.commit()
            with closing(history.database()) as db:
                row=dict(db.execute('SELECT * FROM journey_transfers').fetchone())
            self.assertEqual((row['tx_hash'],row['input_amount'],row['output_amount'],row['input_asset'],row['output_asset']),(HASH,'8','11','WOTR','USDC'))

    def test_failed_receipt_has_no_claimed_output_and_database_migrates(self):
        data = '0x7ff36ab5' + words(5, 128, int(ACCOUNT, 16), 100, 2,
                                    int(history.WBNB, 16), int(history.WOTR[56], 16))
        tx = {'from': ACCOUNT, 'to': history.JOURNEY['buy'][1], 'input': data,
              'value': '0xa', 'blockNumber': '0x2'}
        receipt = {'status': '0x0', 'blockNumber': '0x2'}
        with tempfile.TemporaryDirectory() as directory, patch.object(history, 'DB_PATH', str(Path(directory) / 'history.sqlite3')):
            with patch.object(history, 'rpc', side_effect=[tx, receipt, {'timestamp':'0x64'}]):
                with closing(history.database()) as db:
                    item = history.upsert_journey(db, 'buy', HASH)
                    row = db.execute('SELECT status,output_amount FROM journey_transfers').fetchone()
            self.assertEqual(item['status'], 'failed')
            self.assertEqual(tuple(row), ('failed', None))


if __name__ == '__main__':
    unittest.main()
