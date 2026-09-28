import { ContractFactory, getAddress, keccak256, parseUnits } from 'ethers';
import contracts from '../generated/contracts.json' with { type: 'json' };

export const chains = {
  56: { name: 'BSC Mainnet', symbol: 'BNB', endpoint: '0x1a44076050125825900e736c501f859c50fe728c', eid: 30102, remote: 30417, explorer: 'https://bscscan.com', rpc: 'https://bsc-dataseed.bnbchain.org', deliveryRpc: 'https://bsc-rpc.publicnode.com' },
  5042: { name: 'Arc Mainnet', symbol: 'USDC', endpoint: '0x6f475642a6e85809b1c36fa62763669b1b48dd5b', eid: 30417, remote: 30102, explorer: 'https://explorer.arc.io', rpc: 'https://rpc.mainnet.arc.io' },
};
export const kinds = { PilotToken: 56, PilotAdapter: 56, PilotOFT: 5042 };
export const artifacts = contracts;
export function limits(single, total) {
  const parse = value => {
    if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value.trim())) throw new Error('额度必须为正数，最多 6 位小数。');
    const amount = parseUnits(value.trim(), 18);
    if (amount <= 0n || amount > parseUnits('1000', 18)) throw new Error('实验额度应大于 0 且不超过 1,000 枚。');
    return amount;
  };
  const perSend = parse(single), cap = parse(total);
  if (cap < perSend) throw new Error('累计额度不能低于单笔额度。');
  return { perSend, cap };
}
export async function deployment(kind, account, single, total, token) {
  if (!Object.hasOwn(kinds, kind)) throw new Error('未知合约类型。');
  const owner = getAddress(account), chainId = kinds[kind], chain = chains[chainId];
  const { perSend, cap } = limits(single, total);
  const args = kind === 'PilotToken' ? [owner]
    : kind === 'PilotAdapter' ? [getAddress(token), chain.endpoint, owner, owner, chain.remote, perSend, cap]
    : [chain.endpoint, owner, owner, chain.remote, perSend, cap];
  const artifact = contracts[kind];
  const tx = await new ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(...args);
  return { kind, account: owner, chainId, single, total, args: args.map(String), data: tx.data, dataHash: keccak256(tx.data), bytecodeHash: artifact.bytecodeHash };
}
export function assertContext(plan, account, chainId) {
  if (getAddress(account) !== plan.account || Number(chainId) !== plan.chainId) throw new Error('钱包账号或网络已变化，请重新估算并确认。');
}
export function transactionRecord(tx, plan) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx.hash)) throw new Error('钱包未返回有效交易哈希。');
  return { ...plan, txHash: tx.hash, status: 'pending', submittedAt: new Date().toISOString() };
}
export async function verifyRecord(record, provider) {
  if (Number((await provider.getNetwork()).chainId) !== record.chainId) throw new Error('请切换到记录对应的网络再核验。');
  const receipt = await provider.getTransactionReceipt(record.txHash);
  if (!receipt) return { ...record, status: 'pending' };
  if (receipt.status !== 1) return { ...record, status: 'failed' };
  const tx = await provider.getTransaction(record.txHash);
  if (!tx || tx.to !== null || getAddress(tx.from) !== getAddress(record.account) || keccak256(tx.data) !== record.dataHash) throw new Error('链上交易与本地部署记录不匹配。');
  // Do not trust local storage's calldata hash alone: reconstruct the exact approved build.
  const expected = await deployment(record.kind, record.account, record.single, record.total, record.kind === 'PilotAdapter' ? record.args[0] : undefined);
  if (expected.dataHash !== record.dataHash || record.bytecodeHash !== expected.bytecodeHash) throw new Error('记录不是当前构建版本，请保留原始导出记录并核查。');
  if (!receipt.contractAddress || await provider.getCode(receipt.contractAddress) === '0x') throw new Error('回执存在，但未发现部署合约代码。');
  return { ...record, status: 'confirmed', address: getAddress(receipt.contractAddress), blockNumber: receipt.blockNumber, gasUsed: String(receipt.gasUsed) };
}
