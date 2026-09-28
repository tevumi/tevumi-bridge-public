// Read-only check before asking the wallet to retry a timed-out deployment page.
import { readFile } from 'node:fs/promises';
import { FetchRequest, JsonRpcProvider } from 'ethers';

const plan = JSON.parse(await readFile('research/production/immediate-beta-unsigned/manifest.json', 'utf8'));
const net = JSON.parse(await readFile('config/networks.json', 'utf8'));
const result = { checkedAt: new Date().toISOString(), releaseId: plan.releaseId, chains: {} };
for (const side of ['bsc', 'arc']) {
  const url = process.env[net[side].rpcEnv];
  if (!url) throw Error('MISSING_RPC_' + side);
  const request = new FetchRequest(url); request.timeout = 60000;
  const provider = new JsonRpcProvider(request, net[side].chainId, { staticNetwork: true, batchMaxCount: 1 });
  try {
    const entries = plan.deployments.filter(item => item.side === side);
    const [pendingNonce, latestNonce, codes] = await Promise.all([
      provider.getTransactionCount(entries[0].transaction.from, 'pending'),
      provider.getTransactionCount(entries[0].transaction.from, 'latest'),
      Promise.all(entries.map(item => provider.getCode(item.predictedAddress))),
    ]);
    result.chains[side] = { pendingNonce, latestNonce, plannedStartNonce: entries[0].transaction.nonce, predictedContractsWithCode: entries.filter((_, i) => codes[i] !== '0x').map(item => ({ id: item.id, address: item.predictedAddress })) };
  } finally { provider.destroy(); }
}
result.status = Object.values(result.chains).every(chain => chain.pendingNonce === chain.plannedStartNonce && chain.latestNonce === chain.plannedStartNonce && chain.predictedContractsWithCode.length === 0) ? 'NO_REPLACEMENT_TRANSACTION_DETECTED' : 'REVIEW_BEFORE_RETRY';
console.log(JSON.stringify(result));
