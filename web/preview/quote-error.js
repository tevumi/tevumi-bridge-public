import {AbiCoder, id} from 'ethers';

// Decode only recognized ABI errors. Unknown failures must not be labelled
// insufficient liquidity, and no RPC payload or URL is shown to the user.
const coder = AbiCoder.defaultAbiCoder();
const wrapped = id('UnexpectedRevertBytes(bytes)').slice(0,10);
const illiquid = id('NotEnoughLiquidity(bytes32)').slice(0,10);
export function quoteFailure(error) {
  let data = error?.data ?? error?.info?.error?.data ?? error?.error?.data;
  try {
    if (typeof data === 'string' && data.slice(0,10) === wrapped) [data] = coder.decode(['bytes'], '0x'+data.slice(10));
    if (typeof data === 'string' && data.slice(0,10) === illiquid && data.length === 74) return 'liquidity';
  } catch { /* malformed or unrelated revert */ }
  return 'unavailable';
}
