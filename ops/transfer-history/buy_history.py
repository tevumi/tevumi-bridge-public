"""Strict native BNB buys of the new Four.meme WOTR, preserving old routes."""
TOKEN='0xe2a0ce4be658ee9b09e461f5283c718a20984444'
MANAGER='0x5c952063c7fc8610ffdb798152d69f0b9550762b'
FACTORY='0xca143ce32fe78f1f7019d7d551a6402fc5350c73'
CURVE_SELECTOR='0x87f27655'
PURCHASE='0x7db52723a3b2cdd6164364b3b766e65e540d7be48ffa89582956d8eaebe62942'

def curve_input(tx,words):
    if len(words)!=3 or words[0]!=int(TOKEN,16) or words[1]<=0 or words[2]<=0 or int(tx.get('value','0x0'),16)<=0:
        raise ValueError('Four.meme buy route mismatch')
    return str(int(tx['value'],16)),words[2]

def curve_output(receipt,account,minimum,transfer_amount):
    received=transfer_amount(receipt,TOKEN,MANAGER,account)
    matches=[]
    for log in receipt.get('logs',[]):
        topics=log.get('topics',[])
        if log.get('address','').lower()!=MANAGER or len(topics)!=1 or topics[0].lower()!=PURCHASE:
            continue
        data=log.get('data','')
        if len(data)!=514: raise ValueError('Four.meme purchase ABI mismatch')
        values=[int(data[i:i+64],16) for i in range(2,len(data),64)]
        if values[0]==int(TOKEN,16) and values[1]==int(account,16): matches.append(values[3])
    if len(matches)!=1 or received<=0 or received<minimum or matches[0]!=received:
        raise ValueError('Four.meme purchase and wallet delivery mismatch')
    return received
