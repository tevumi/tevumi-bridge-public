// Read-only verification of user-signed Timelock scheduleBatch transactions.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Contract, FetchRequest, JsonRpcProvider, getAddress, keccak256 } from 'ethers';

const manifest = JSON.parse(await readFile('research/production/public-beta-unsigned/manifest.json', 'utf8'));
const deployed = JSON.parse(await readFile('research/production/public-beta-mainnet/deployment-verification.json', 'utf8'));
const networks = JSON.parse(await readFile('config/networks.json', 'utf8'));
const report = { checkedAt: new Date().toISOString(), releaseId: manifest.releaseId, status: 'CHECKING', chains: {}, limitations: ['Scheduling does not execute configuration or unpause business contracts.', 'Each chain has its own 24-hour delay from its confirmed schedule block.'] };
for (const config of manifest.configurations) {
  const side = config.side, net = networks[side];
  if (!process.env[net.rpcEnv]) throw Error('MISSING_RPC_' + side);
  const request = new FetchRequest(process.env[net.rpcEnv]);
  request.timeout = 60000;
  const provider = new JsonRpcProvider(request, net.chainId, { batchMaxCount: 1, staticNetwork: true });
  try {
    const targets = config.steps.map(step => step.to), values = config.steps.map(step => step.value), payloads = config.steps.map(step => step.data);
    const timelock = new Contract(config.timelock, [
      'function hashOperationBatch(address[],uint256[],bytes[],bytes32,bytes32) view returns(bytes32)',
      'function getTimestamp(bytes32) view returns(uint256)',
      'function getMinDelay() view returns(uint256)',
      'function isOperationPending(bytes32) view returns(bool)',
      'function isOperationReady(bytes32) view returns(bool)',
      'function isOperationDone(bytes32) view returns(bool)',
    ], provider);
    const id = await timelock.hashOperationBatch(targets, values, payloads, config.predecessor, config.salt);
    const [timestamp, delay, pending, ready, done, block, nonce] = await Promise.all([
      timelock.getTimestamp(id), timelock.getMinDelay(), timelock.isOperationPending(id), timelock.isOperationReady(id), timelock.isOperationDone(id), provider.getBlockNumber(), provider.getTransactionCount(config.proposer, 'latest'),
    ]);
    const fromBlock = deployed.chains[side].deployments.find(row => row.id === side + ':governance').blockNumber;
    const logs = await provider.getLogs({ address: config.timelock, fromBlock, toBlock: block });
    const matches = logs.filter(log => log.topics.some(topic => topic.toLowerCase() === id.toLowerCase()));
    const hashes = [...new Set(matches.map(log => log.transactionHash))];
    if (hashes.length !== 1) throw Error('SCHEDULE_TRANSACTION_NOT_UNIQUE_' + side);
    const hash = hashes[0], [sent, receipt] = await Promise.all([provider.getTransaction(hash), provider.getTransactionReceipt(hash)]);
    const minedBlock = await provider.getBlock(receipt.blockNumber);
    const dataMatches = keccak256(sent.data) === keccak256(config.schedule.data);
    const identityMatches = getAddress(sent.from) === getAddress(config.proposer) && getAddress(sent.to) === getAddress(config.timelock) && sent.value === 0n;
    const receiptOk = receipt.status === 1 && receipt.to.toLowerCase() === config.timelock.toLowerCase();
    const timeMatches = Number(timestamp) === minedBlock.timestamp + Number(delay);
    const assets = {};
    for (const assetId of ['binancelife', 'cat']) {
      const app = new Contract(manifest.apps[side][assetId], ['function owner() view returns(address)','function depositsPaused() view returns(bool)','function sendsPaused() view returns(bool)','function receivesPaused() view returns(bool)','function peers(uint32) view returns(bytes32)'], provider);
      const [owner, outgoingPaused, incomingPaused, peer] = await Promise.all([
        app.owner(), app[side === 'bsc' ? 'depositsPaused' : 'sendsPaused'](), app.receivesPaused(), app.peers(networks[side === 'bsc' ? 'arc' : 'bsc'].eid),
      ]);
      assets[assetId] = { address: manifest.apps[side][assetId], ownerOk: getAddress(owner) === getAddress(config.timelock), outgoingPaused, incomingPaused, peerUnset: peer === '0x' + '00'.repeat(32) };
    }
    report.chains[side] = { chainId: net.chainId, block, nonce, operationId: id, scheduledAt: new Date(minedBlock.timestamp * 1000).toISOString(), executableAt: new Date(Number(timestamp) * 1000).toISOString(), timestamp: timestamp.toString(), delaySeconds: delay.toString(), pending, ready, done, transactionHash: hash, transactionBlock: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), feeWei: (receipt.gasUsed * receipt.gasPrice).toString(), logsForOperation: matches.length, dataMatches, identityMatches, receiptOk, timeMatches, assets };
  } finally {
    provider.destroy();
  }
}
report.status = Object.keys(report.chains).length === 2 && Object.values(report.chains).every(chain => chain.pending && !chain.ready && !chain.done && chain.delaySeconds === '86400' && chain.dataMatches && chain.identityMatches && chain.receiptOk && chain.timeMatches && Object.values(chain.assets).every(asset => asset.ownerOk && asset.outgoingPaused && asset.incomingPaused && asset.peerUnset)) ? 'TWO_SCHEDULES_VERIFIED_WAITING' : 'INCOMPLETE_OR_MISMATCH';
await mkdir('research/production/public-beta-mainnet', { recursive: true });
await writeFile('research/production/public-beta-mainnet/schedule-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, chains: Object.fromEntries(Object.entries(report.chains).map(([side, chain]) => [side, { transactionHash: chain.transactionHash, scheduledAt: chain.scheduledAt, executableAt: chain.executableAt, pending: chain.pending, ready: chain.ready, done: chain.done }])) }));
if (report.status !== 'TWO_SCHEDULES_VERIFIED_WAITING') process.exitCode = 1;
