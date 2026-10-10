import importlib.util
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('server_history',Path(__file__).resolve().parents[1]/'ops/transfer-history/service.py')
h=importlib.util.module_from_spec(spec);sys.modules[spec.name]=h;spec.loader.exec_module(h)
ACCOUNT='0x'+'1'*40
HASH='0x'+'2'*64
def words(values): return ''.join(f'{v:064x}' for v in values)

class ServerHistory(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.patch=patch.object(h,'DB_PATH',str(Path(self.temp.name)/'history.sqlite3'));self.patch.start();self.c=h.database()
    def tearDown(self): self.c.close();self.patch.stop();self.temp.cleanup()
    def save(self,**extra):
        return h.operation_results.save(self.c,{'account':ACCOUNT,'page':'buy','id':'attempt-1','state':'submitted','hash':HASH,**extra})
    def test_retry_and_out_of_order_are_idempotent(self):
        self.save(state='verified');self.save(state='pending');self.save(state='verified')
        records=h.operation_results.merged(self.c,ACCOUNT,'buy',[])
        self.assertEqual(len(records),1);self.assertEqual(records[0]['state'],'verified');self.assertEqual(records[0]['status'],'unknown')
    def test_concurrent_reports_preserve_terminal_result(self):
        def report(state):
            c=h.database()
            try:return h.operation_results.save(c,{'account':ACCOUNT,'page':'buy','id':'parallel-attempt','state':state,'hash':HASH})
            finally:c.close()
        with ThreadPoolExecutor(max_workers=4) as executor:list(executor.map(report,['verified','pending','submitted','pending']*3))
        records=h.operation_results.merged(self.c,ACCOUNT,'buy',[])
        self.assertEqual(len(records),1);self.assertEqual(records[0]['state'],'verified')
    def test_all_four_pages_save_results_without_hash(self):
        for page in ('buy','bridge','swap','usdc'):
            self.save(page=page,state='cancelled',hash=None)
            self.assertEqual(h.operation_results.merged(self.c,ACCOUNT,page,[])[0]['status'],'cancelled')
        self.assertEqual(h.operation_results.merged(self.c,'0x'+'3'*40,'buy',[]),[])
    def test_verified_server_row_wins_over_report(self):
        self.save(state='failed')
        rows=[{'tx_hash':HASH,'status':'verified','created_at':1}]
        self.assertEqual(h.operation_results.merged(self.c,ACCOUNT,'buy',rows),rows)
    def test_input_validation_and_hash_identity(self):
        self.save()
        for extra in ({'hash':'0x'+'3'*64},{'state':'arrived'},{'input_amount':'-1'},{'id':'<script>'}):
            with self.assertRaises(ValueError): self.save(**extra)
    def sale(self,forged=False,multiple=False):
        token=h.buy_history.TOKEN;manager=h.buy_history.MANAGER
        tx={'from':ACCOUNT,'to':manager,'input':h.sell_history.CURVE+words([0,int(token,16),1000,90,0,0]),'value':'0x0','blockNumber':'0x5'}
        receipt={'blockNumber':'0x5','status':'0x1','gasUsed':'0x1','effectiveGasPrice':'0x1','logs':[
            {'address':token,'topics':[h.TRANSFER,'0x'+words([int(ACCOUNT,16)]),'0x'+words([int(manager,16)])],'data':'0x'+words([999 if forged else 1000])},
            {'address':manager,'topics':[h.sell_history.SALE],'data':'0x'+words([int(token,16),int(ACCOUNT,16),1,1000,100,3,0,0])}]}
        def rpc(chain,method,args):
            if method=='eth_getTransactionByHash': return tx
            if method=='eth_getTransactionReceipt': return receipt
            if method=='eth_getBlockByNumber': return {'timestamp':'0x10','transactions':[{'from':ACCOUNT,'hash':HASH}]* (2 if multiple else 1)}
            if method=='eth_getBalance': return hex(100 if args[1]=='0x4' else 196)
            raise AssertionError(method)
        with patch.object(h,'rpc',rpc): return h.upsert_journey(self.c,'buy',HASH)
    def test_sale_is_verified_and_saved_on_server(self):
        result=self.sale();self.assertEqual(result['status'],'verified');self.assertEqual(result['output_amount'],'97');self.assertEqual(result['input_asset'],'WOTR')
        self.assertEqual(self.c.execute('SELECT count(*) FROM journey_transfers').fetchone()[0],1)
    def test_sale_mismatching_debit_is_rejected(self):
        with self.assertRaises(ValueError): self.sale(True)
    def test_multiple_wallet_transactions_do_not_prove_sale_proceeds(self):
        with self.assertRaises(ValueError): self.sale(multiple=True)

if __name__=='__main__':unittest.main()
