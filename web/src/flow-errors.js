// Deliberately exclude provider messages, URLs, calldata and arbitrary error data.
export function classifyFlowError(error) {
 const codes=[error?.code,error?.error?.code,error?.info?.error?.code,error?.cause?.code];
 if(codes.some(c=>c===4001||c==='ACTION_REJECTED'))return 'USER_REJECTED';
 if(codes.some(c=>c===-32005||c===429)||error?.info?.responseStatus===429)return 'RATE_LIMIT';
 for(const code of ['TIMEOUT','NETWORK_ERROR','SERVER_ERROR','INSUFFICIENT_FUNDS'])if(codes.includes(code))return code;
 if(codes.includes('CALL_EXCEPTION')){
  const data=error?.data??error?.info?.error?.data;
  return typeof data==='string'&&/^0x[\da-fA-F]+$/.test(data)?'CONTRACT_REVERT':'CALL_FAILED';
 }
 if(codes.includes('BAD_DATA'))return 'INVALID_RESPONSE';
 return error?.code?'UNKNOWN_ERROR':'VALIDATION';
}
export const flowErrorReasons={USER_REJECTED:'用户取消钱包操作',RATE_LIMIT:'RPC 请求受限',TIMEOUT:'读取超时',NETWORK_ERROR:'网络连接失败',SERVER_ERROR:'RPC 服务未正常响应',INSUFFICIENT_FUNDS:'手续费余额不足',CONTRACT_REVERT:'合约调用回退',CALL_FAILED:'合约读取失败，未取得明确回退原因',INVALID_RESPONSE:'RPC 返回数据无法解析',UNKNOWN_ERROR:'钱包或 RPC 返回异常',VALIDATION:'操作条件核验未通过'};
