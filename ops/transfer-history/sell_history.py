"""Validate the current WOTR sale from its call, token debit and native receipt."""
SALE='0x0a5575b3648bae2210cee56bf33254cc1ddfbc7bf637c0af2ac18b14fb1bae19'
CURVE='0x06e7b98f'
DEX='0x18cbafe5'

def inspect(tx,tx_hash,h):
    account=tx['from'].lower();words=h.transaction_words(tx['input'])
    curve=tx.get('to','').lower()==h.buy_history.MANAGER and tx['input'].lower().startswith(CURVE)
    if int(tx.get('value','0x0'),16)!=0: raise ValueError('Sale cannot send BNB')
    if curve:
        if len(words)!=6 or words[0]!=0 or words[1]!=int(h.buy_history.TOKEN,16) or words[4]!=0 or words[5]!=0: raise ValueError('Curve sale mismatch')
        amount,minimum=words[2:4];sender=h.buy_history.MANAGER
    else:
        if tx.get('to','').lower()!=h.JOURNEY['buy'][1] or not tx['input'].lower().startswith(DEX) or len(words)!=8 or words[2]!=160 or words[3]!=int(account,16) or words[5]!=2 or words[6]!=int(h.buy_history.TOKEN,16) or words[7]!=int(h.WBNB,16): raise ValueError('DEX sale mismatch')
        amount,minimum=words[:2];sender=None
    if amount<=0 or minimum<=0: raise ValueError('Invalid sale amounts')
    status,output,block='pending',None,None;created=int(h.time.time())
    if tx.get('blockNumber'):
        receipt=h.rpc(56,'eth_getTransactionReceipt',[tx_hash]);block=int(receipt['blockNumber'],16)
        confirmed_block=h.rpc(56,'eth_getBlockByNumber',[hex(block),True])
        created=int(confirmed_block['timestamp'],16)
        if int(receipt['status'],16)==0: status='failed'
        else:
            transactions=confirmed_block.get('transactions',[])
            own=[item for item in transactions if item.get('from','').lower()==account]
            if len(own)!=1 or own[0].get('hash','').lower()!=tx_hash.lower(): raise ValueError('Ambiguous wallet block; sale needs review')
            if any(item.get('to','') and item['to'].lower()==account and item.get('hash','').lower()!=tx_hash.lower() and int(item.get('value','0x0'),16)>0 for item in transactions): raise ValueError('Other native receipts in sale block')
            if sender is None:
                data='0xe6a43905'+f'{int(h.WBNB,16):064x}'+f'{int(h.buy_history.TOKEN,16):064x}'
                result=h.rpc(56,'eth_call',[{'to':h.buy_history.FACTORY,'data':data},hex(block)])
                if not h.re.fullmatch(r'0x0{24}[0-9a-fA-F]{40}',result) or int(result,16)==0: raise ValueError('Sale pair missing')
                sender='0x'+result[-40:].lower()
            if h.transfer_amount(receipt,h.buy_history.TOKEN,account,sender)!=amount: raise ValueError('Sale debit mismatch')
            before=int(h.rpc(56,'eth_getBalance',[account,hex(block-1)]),16)
            after=int(h.rpc(56,'eth_getBalance',[account,hex(block)]),16)
            net=after-before+int(receipt['gasUsed'],16)*int(receipt['effectiveGasPrice'],16)
            if net<=0: raise ValueError('No sale proceeds')
            if curve:
                matches=[]
                for log in receipt.get('logs',[]):
                    if log.get('address','').lower()!=sender or log.get('topics')!=[SALE]: continue
                    data=log.get('data','')
                    if not h.re.fullmatch(r'0x[0-9a-fA-F]{512}',data): raise ValueError('Sale event ABI mismatch')
                    values=[int(data[i:i+64],16) for i in range(2,len(data),64)]
                    if values[:2]==[int(h.buy_history.TOKEN,16),int(account,16)]: matches.append(values)
                if len(matches)!=1 or matches[0][3]!=amount or matches[0][4]<minimum or matches[0][4]-matches[0][5]!=net: raise ValueError('Sale event mismatch')
            elif net<minimum: raise ValueError('Sale below minimum')
            status,output='verified',str(net)
    return {'kind':'buy','tx_hash':tx_hash.lower(),'account':account,'input_amount':str(amount),'output_amount':output,'input_asset':'WOTR','output_asset':'BNB','token_address':h.buy_history.TOKEN,'buy_route':'four-sale' if curve else 'pancake-sale','status':status,'block_number':block,'created_at':created}
