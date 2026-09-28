// Only errors that prove the wallet did not submit a transaction may unlock a
// new attempt. Generic RPC/internal errors can also follow an actual broadcast.
export function classifyWalletSendError(error) {
  const nested = [error, error?.data, error?.data?.originalError, error?.error, error?.cause];
  const codes = nested.map(item => Number(item?.code));
  if (codes.includes(4001)) return 'rejected';
  if (codes.includes(4100) || codes.includes(4200) || codes.includes(-32602)) return 'not_submitted';
  const messages = nested.map(item => String(item?.message ?? '')).join(' ').toLowerCase();
  if (/insufficient funds|intrinsic gas too low|max fee per gas less than block base fee|invalid transaction params/.test(messages)) return 'not_submitted';
  return 'unknown';
}
