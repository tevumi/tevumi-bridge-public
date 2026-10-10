import {Interface} from 'ethers';
import {BUY} from './buy-plan.js';
const token=new Interface(['function approve(address,uint256)']);
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const check=ok=>{if(!ok)throw Error('Approval transaction does not match the selected token, wallet or spender.');};
// Wallets may let the owner edit the allowance before signing. Recognize the
// confirmed approval, but never use this exception for a sale or another call.
export function confirmedSaleApproval(record,transaction,account){
 check(record.chainId===56&&same(record.token,BUY.token)&&same(record.to,BUY.token)&&[BUY.manager,BUY.router].some(a=>same(a,record.spender)));
 check(same(transaction.hash,record.hash)&&same(transaction.from,account)&&same(transaction.to,record.to)&&transaction.nonce===record.nonce&&transaction.value===0n&&BigInt(record.value)===0n);
 let planned,actual;try{planned=token.parseTransaction({data:record.data});actual=token.parseTransaction({data:transaction.data});}catch{check(false);}
 check(planned?.name==='approve'&&actual?.name==='approve'&&same(planned.args[0],record.spender)&&same(actual.args[0],record.spender)&&planned.args[1]===BigInt(record.amount));
 check(token.encodeFunctionData('approve',actual.args)===transaction.data.toLowerCase());
 return {...record,data:transaction.data,amount:String(actual.args[1]),requestedData:record.requestedData||record.data,requestedAmount:record.requestedAmount||record.amount,walletAdjusted:actual.args[1]!==BigInt(record.amount)};
}
