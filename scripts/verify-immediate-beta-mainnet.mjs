// Independently verify the six user-signed mainnet CREATEs before any configuration.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Contract, FetchRequest, JsonRpcProvider, getCreateAddress, keccak256 } from 'ethers';

const manifest = JSON.parse(await readFile('research/production/immediate-beta-unsigned/manifest.json', 'utf8'));
const policy = JSON.parse(await readFile('research/production/immediate-beta-unsigned/policy.json', 'utf8'));
const networks = JSON.parse(await readFile('config/networks.json', 'utf8'));
const beforeRelease = { bsc: 123724235, arc: 22488516 };
const report = { checkedAt: new Date().toISOString(), releaseId: manifest.releaseId, status: 'CHECKING', chains: {}, limitations: ['Read-only verification of live chain state, not an audit or source publication.', 'Deployment does not configure the channels or permit bridging.'] };

for (const side of ['bsc', 'arc']) {
  const net = networks[side];
  const rpcUrl = process.env[net.rpcEnv];
  if (!rpcUrl) throw Error('MISSING_RPC_' + side);
  const request = new FetchRequest(rpcUrl); request.timeout = 60000;
  const provider = new JsonRpcProvider(request, net.chainId, { staticNetwork: true, batchMaxCount: 1 });
  try {
    const entries = manifest.deployments.filter(item => item.side === side);
    const account = entries[0].transaction.from;
    const [head, pendingNonce, latestNonce] = await Promise.all([
      provider.getBlockNumber(), provider.getTransactionCount(account, 'pending'), provider.getTransactionCount(account, 'latest'),
    ]);
    const deployments = [];
    for (const item of entries) {
      const code = await provider.getCode(item.predictedAddress);
      const row = { id: item.id, address: item.predictedAddress, nonce: item.transaction.nonce, codePresent: code !== '0x', runtimeHash: code === '0x' ? null : keccak256(code) };
      if (code === '0x') { deployments.push(row); continue; }
      let low = beforeRelease[side], high = head;
      if (await provider.getCode(item.predictedAddress, low) !== '0x') throw Error('CREATION_BEFORE_PLAN_' + item.id);
      while (low + 1 < high) {
        const mid = Math.floor((low + high) / 2);
        if (await provider.getCode(item.predictedAddress, mid) === '0x') low = mid;
        else high = mid;
      }
      const block = await provider.send('eth_getBlockByNumber', ['0x' + high.toString(16), true]);
      const sent = block.transactions.find(tx => tx.to === null && tx.from.toLowerCase() === account.toLowerCase() && Number(BigInt(tx.nonce)) === item.transaction.nonce);
      if (!sent) throw Error('CREATE_TRANSACTION_NOT_FOUND_' + item.id);
      const receipt = await provider.getTransactionReceipt(sent.hash);
      row.transactionHash = sent.hash;
      row.blockNumber = high;
      row.predictedAddressMatchesNonce = getCreateAddress({ from: account, nonce: item.transaction.nonce }).toLowerCase() === item.predictedAddress.toLowerCase();
      row.creationDataMatchesPlan = keccak256(sent.input) === keccak256(item.transaction.data);
      row.receiptOk = receipt?.status === 1 && receipt.contractAddress?.toLowerCase() === item.predictedAddress.toLowerCase();
      row.gasUsed = receipt?.gasUsed.toString();
      if (item.assetId === null) {
        const admin = new Contract(item.predictedAddress, ['function owner() view returns(address)'], provider);
        row.identity = { ownerOk: (await admin.owner()).toLowerCase() === account.toLowerCase() };
      } else {
        const app = new Contract(item.predictedAddress, [
          'function owner() view returns(address)', 'function endpoint() view returns(address)', 'function peers(uint32) view returns(bytes32)',
          'function receivesPaused() view returns(bool)', side === 'bsc' ? 'function depositsPaused() view returns(bool)' : 'function sendsPaused() view returns(bool)',
          side === 'bsc' ? 'function capacityLD() view returns(uint256)' : 'function totalSupply() view returns(uint256)',
          ...(side === 'bsc' ? ['function principalLD() view returns(uint256)'] : []),
        ], provider);
        const endpoint = new Contract(net.endpoint, ['function delegates(address) view returns(address)'], provider);
        const [owner, endpointAddress, delegate, peer, receivePaused, sendPaused] = await Promise.all([
          app.owner(), app.endpoint(), endpoint.delegates(item.predictedAddress), app.peers(networks[side === 'bsc' ? 'arc' : 'bsc'].eid),
          app.receivesPaused(), app[side === 'bsc' ? 'depositsPaused' : 'sendsPaused'](),
        ]);
        row.identity = {
          ownerOk: owner.toLowerCase() === manifest.governance[side].toLowerCase(),
          endpointOk: endpointAddress.toLowerCase() === net.endpoint.toLowerCase(),
          delegateOk: delegate.toLowerCase() === manifest.governance[side].toLowerCase(),
          peerUnset: peer === '0x' + '00'.repeat(32), receivePaused, sendPaused,
        };
        if (side === 'bsc') {
          row.identity.capacityOk = (await app.capacityLD()).toString() === policy.assets[item.assetId].capacityLD;
          row.identity.principalZero = (await app.principalLD()) === 0n;
        } else row.identity.supplyZero = (await app.totalSupply()) === 0n;
      }
      deployments.push(row);
    }
    report.chains[side] = { chainId: net.chainId, head, pendingNonce, latestNonce, deployments };
  } finally { provider.destroy(); }
}

const rows = Object.values(report.chains).flatMap(chain => chain.deployments);
report.status = rows.length === 6 && rows.every(row => row.codePresent && row.predictedAddressMatchesNonce && row.creationDataMatchesPlan && row.receiptOk && Object.values(row.identity).every(Boolean)) ? 'SIX_DEPLOYMENTS_VERIFIED_PAUSED_UNCONFIGURED' : 'INCOMPLETE_OR_STATE_MISMATCH';
await mkdir('research/production/immediate-beta-mainnet', { recursive: true });
await writeFile('research/production/immediate-beta-mainnet/deployment-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, checkedAt: report.checkedAt, chains: Object.fromEntries(Object.entries(report.chains).map(([side, chain]) => [side, { head: chain.head, pendingNonce: chain.pendingNonce, latestNonce: chain.latestNonce, verified: chain.deployments.filter(row => row.receiptOk && row.creationDataMatchesPlan).length }])) }));
if (report.status !== 'SIX_DEPLOYMENTS_VERIFIED_PAUSED_UNCONFIGURED') process.exitCode = 1;
