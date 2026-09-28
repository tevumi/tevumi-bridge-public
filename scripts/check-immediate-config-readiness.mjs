// Read-only simulation of the two immediate configuration batches.
import { readFile } from 'node:fs/promises';
import { FetchRequest, JsonRpcProvider, keccak256 } from 'ethers';

const plan = JSON.parse(await readFile('web/immediate-deploy/public/config-plan.json', 'utf8'));
const networks = JSON.parse(await readFile('config/networks.json', 'utf8'));
const result = { checkedAt: new Date().toISOString(), releaseId: plan.releaseId, chains: {} };
for (const item of plan.batches) {
  const net = networks[item.side];
  const rpcUrl = process.env[net.rpcEnv];
  if (!rpcUrl) throw Error('MISSING_RPC_' + item.side);
  if (item.chainId !== net.chainId || item.stepCount !== 12 || keccak256(item.transaction.data) !== item.calldataHash || item.transaction.to.toLowerCase() !== item.admin.toLowerCase()) throw Error('INVALID_CONFIG_PLAN_' + item.side);
  const request = new FetchRequest(rpcUrl); request.timeout = 60000;
  const provider = new JsonRpcProvider(request, net.chainId, { staticNetwork: true, batchMaxCount: 1 });
  try {
    const [pendingNonce, balance, gasEstimate, feeData] = await Promise.all([
      provider.getTransactionCount(item.account, 'pending'),
      provider.getBalance(item.account),
      provider.estimateGas({ from: item.account, to: item.admin, data: item.transaction.data, value: 0n }),
      provider.getFeeData(),
    ]);
    const unitPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
    const bufferedGas = gasEstimate * 120n / 100n + 1n;
    result.chains[item.side] = {
      chainId: item.chainId, pendingNonce, gasEstimate: gasEstimate.toString(), bufferedGas: bufferedGas.toString(),
      maxUnitPriceWei: unitPrice?.toString(), balanceCoversBufferedEstimate: unitPrice !== null && balance >= bufferedGas * unitPrice,
      withinPageGasLimit: bufferedGas >= 21000n && bufferedGas <= 3000000n,
    };
  } finally { provider.destroy(); }
}
result.status = Object.values(result.chains).length === 2 && Object.values(result.chains).every(chain => chain.balanceCoversBufferedEstimate && chain.withinPageGasLimit) ? 'BOTH_CONFIG_BATCHES_SIMULATED' : 'CONFIG_REVIEW_REQUIRED';
console.log(JSON.stringify(result));
if (result.status !== 'BOTH_CONFIG_BATCHES_SIMULATED') process.exitCode = 1;
