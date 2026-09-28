// Read-only verification of the user-signed mainnet CREATE transactions.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Contract, FetchRequest, JsonRpcProvider, keccak256, formatEther } from 'ethers';

const manifest = JSON.parse(await readFile('research/production/public-beta-unsigned/manifest.json', 'utf8'));
const networks = JSON.parse(await readFile('config/networks.json', 'utf8'));
const proposal = JSON.parse(await readFile('research/production/public-beta-preparation/proposal-check.json', 'utf8'));
const policy = JSON.parse(await readFile('research/production/public-beta-preparation/proposed-policy.json', 'utf8'));
const report = { checkedAt: new Date().toISOString(), releaseId: manifest.releaseId, status: 'CHECKING', chains: {}, limitations: ['This is read-only chain verification, not block-explorer source publication or an audit.', 'Business contracts remain paused; deployment alone does not enable public bridging.'] };
for (const side of ['bsc', 'arc']) {
  const net = networks[side];
  if (!process.env[net.rpcEnv]) throw Error('MISSING_RPC_' + side);
  const request = new FetchRequest(process.env[net.rpcEnv]);
  request.timeout = 30000;
  const provider = new JsonRpcProvider(request, net.chainId, { batchMaxCount: 1 });
  try {
    const items = manifest.deployments.filter(item => item.side === side);
    const account = items[0].transaction.from;
    const [block, pendingNonce, minedNonce, balance] = await Promise.all([
      provider.getBlockNumber(),
      provider.getTransactionCount(account, 'pending'),
      provider.getTransactionCount(account, 'latest'),
      provider.getBalance(account),
    ]);
    const deployments = await Promise.all(items.map(async item => {
      const code = await provider.getCode(item.predictedAddress);
      const row = { id: item.id, address: item.predictedAddress, codePresent: code !== '0x', runtimeHash: code === '0x' ? null : keccak256(code) };
      if (code === '0x') return row;
      let low = proposal.heads[side].number;
      let high = block;
      while (low + 1 < high) {
        const middle = Math.floor((low + high) / 2);
        if (await provider.getCode(item.predictedAddress, middle) === '0x') low = middle;
        else high = middle;
      }
      const creationBlock = await provider.send('eth_getBlockByNumber', ['0x' + high.toString(16), true]);
      const sent = creationBlock.transactions.find(tx => tx.to === null && tx.from.toLowerCase() === account.toLowerCase() && Number(BigInt(tx.nonce)) === item.transaction.nonce);
      if (!sent) throw Error('CREATE_TRANSACTION_NOT_FOUND_' + item.id);
      const receipt = await provider.getTransactionReceipt(sent.hash);
      row.transactionHash = sent.hash;
      row.blockNumber = high;
      row.creationDataMatchesPlan = keccak256(sent.input) === keccak256(item.transaction.data);
      row.receiptOk = receipt.status === 1 && receipt.contractAddress.toLowerCase() === item.predictedAddress.toLowerCase();
      row.gasUsed = receipt.gasUsed.toString();
      row.feeWei = (receipt.gasUsed * receipt.gasPrice).toString();
      if (item.assetId === null) {
        const contract = new Contract(item.predictedAddress, ['function getMinDelay() view returns(uint256)','function PROPOSER_ROLE() view returns(bytes32)','function EXECUTOR_ROLE() view returns(bytes32)','function hasRole(bytes32,address) view returns(bool)'], provider);
        const [delay, proposer, executor] = await Promise.all([contract.getMinDelay(), contract.PROPOSER_ROLE(), contract.EXECUTOR_ROLE()]);
        row.identity = { delay: delay.toString(), delayOk: delay === 86400n, proposerOk: await contract.hasRole(proposer, account), executorOk: await contract.hasRole(executor, account) };
      } else {
        const contract = new Contract(item.predictedAddress, ['function owner() view returns(address)','function guardian() view returns(address)','function endpoint() view returns(address)','function depositsPaused() view returns(bool)','function receivesPaused() view returns(bool)','function sendsPaused() view returns(bool)','function capacityLD() view returns(uint256)','function principalLD() view returns(uint256)','function totalSupply() view returns(uint256)','function peers(uint32) view returns(bytes32)'], provider);
        const [owner, guardian, endpoint, receivePaused] = await Promise.all([contract.owner(), contract.guardian(), contract.endpoint(), contract.receivesPaused()]);
        row.identity = { ownerOk: owner.toLowerCase() === manifest.governance[side].toLowerCase(), guardianOk: guardian.toLowerCase() === account.toLowerCase(), endpointOk: endpoint.toLowerCase() === net.endpoint.toLowerCase(), receivePaused, sendPaused: await contract[side === 'bsc' ? 'depositsPaused' : 'sendsPaused'](), peerUnset: (await contract.peers(networks[side === 'bsc' ? 'arc' : 'bsc'].eid)) === '0x' + '00'.repeat(32) };
        if (side === 'bsc') {
          row.identity.capacityLD = (await contract.capacityLD()).toString();
          row.identity.capacityOk = row.identity.capacityLD === String(policy.assets[item.assetId].capacityLD);
          row.identity.principalZero = (await contract.principalLD()) === 0n;
        } else row.identity.supplyZero = (await contract.totalSupply()) === 0n;
      }
      return row;
    }));
    report.chains[side] = { chainId: net.chainId, block, pendingNonce, minedNonce, balance: formatEther(balance), deployments };
  } finally {
    provider.destroy();
  }
}
const rows = Object.values(report.chains).flatMap(chain => chain.deployments);
report.status = rows.length === 6 && rows.every(row => row.codePresent && row.creationDataMatchesPlan && row.receiptOk && Object.values(row.identity).every(value => typeof value !== 'boolean' || value)) ? 'SIX_DEPLOYMENTS_VERIFIED_PAUSED' : 'INCOMPLETE_OR_IDENTITY_MISMATCH';
await mkdir('research/production/public-beta-mainnet', { recursive: true });
await writeFile('research/production/public-beta-mainnet/deployment-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, checkedAt: report.checkedAt, chains: Object.fromEntries(Object.entries(report.chains).map(([side, chain]) => [side, { block: chain.block, pendingNonce: chain.pendingNonce, minedNonce: chain.minedNonce, verified: chain.deployments.filter(row => row.receiptOk && row.creationDataMatchesPlan).length }])) }));
if (report.status !== 'SIX_DEPLOYMENTS_VERIFIED_PAUSED') process.exitCode = 1;
