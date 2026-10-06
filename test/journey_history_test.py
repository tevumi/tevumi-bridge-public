"""Buy and Swap history must be derived from chain evidence, not browser claims."""
import importlib.util
import tempfile
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
        data = '0x3593564c' + words(96, 192, 100, 1, 0x10 << 248)
        tx = {'from': ACCOUNT, 'to': history.JOURNEY['swap'][1], 'input': data,
              'value': '0x0', 'blockNumber': '0x2'}
        receipt = {'status': '0x1', 'blockNumber': '0x2', 'gasUsed': '0x1',
                   'effectiveGasPrice': '0x1', 'logs': [
                       transfer(history.WOTR[5042], ACCOUNT, history.ARC_POOL_MANAGER, 8)]}
        block = {'timestamp':'0x64'}
        with patch.object(history, 'rpc', side_effect=[tx, receipt, block, '0x64', '0x6e']):
            item = history.inspect_journey('swap', HASH)
        self.assertEqual((item['status'], item['input_amount'], item['output_amount']),
                         ('verified', '8', '11'))
        with patch.object(history, 'rpc', side_effect=[tx, receipt, block, '0x64', '0x5a']):
            with self.assertRaisesRegex(ValueError, 'increase'):
                history.inspect_journey('swap', HASH)

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
