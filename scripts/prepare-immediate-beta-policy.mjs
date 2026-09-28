// Read-only replacement policy for a development release without a timelock.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Contract, FetchRequest, JsonRpcProvider, getAddress } from 'ethers';

const previous = JSON.parse(await readFile('research/production/public-beta-preparation/proposed-policy.json', 'utf8'));
const prior = JSON.parse(await readFile('research/production/public-beta-mainnet/deployment-verification.json', 'utf8'));
const net = JSON.parse(await readFile('config/networks.json', 'utf8'));
const policy = structuredClone(previous);
policy.releaseId = 'tevumi-immediate-beta-1';
policy.governanceMode = 'immediate-eoa';
policy.delaySeconds = 0;
const snapshot = { checkedAt: new Date().toISOString(), status: 'CHECKING', chains: {}, limitations: ['Read-only preparation; no replacement contract has been deployed.', 'The prior six contracts and scheduled operations remain on-chain and paused.'] };
for (const side of ['bsc', 'arc']) {
  const network = net[side];
  const url = process.env[network.rpcEnv];
  if (!url) throw Error('MISSING_RPC_' + side);
  const request = new FetchRequest(url); request.timeout = 60000;
  const provider = new JsonRpcProvider(request, network.chainId, { staticNetwork: true, batchMaxCount: 1 });
  try {
    const account = getAddress(policy[side].deployer);
    if (account !== getAddress(policy[side].governor) || account !== getAddress(policy[side].guardian)) throw Error('ACCOUNT_MISMATCH_' + side);
    const [chain, accountCode, endpointCode, nonce, balance, head] = await Promise.all([
      provider.getNetwork(), provider.getCode(account), provider.getCode(network.endpoint), provider.getTransactionCount(account, 'pending'), provider.getBalance(account), provider.getBlock('latest'),
    ]);
    if (Number(chain.chainId) !== network.chainId || accountCode !== '0x' || endpointCode === '0x') throw Error('NETWORK_OR_ACCOUNT_MISMATCH_' + side);
    const assets = {};
    for (const assetId of ['binancelife', 'cat']) {
      const address = prior.chains[side].deployments.find(item => item.id === `${side}:${assetId}`)?.address;
      if (!address) throw Error('MISSING_PRIOR_APP_' + side + '_' + assetId);
      const abi = ['function owner() view returns(address)', 'function peers(uint32) view returns(bytes32)', 'function receivesPaused() view returns(bool)', side === 'bsc' ? 'function depositsPaused() view returns(bool)' : 'function sendsPaused() view returns(bool)', side === 'bsc' ? 'function principalLD() view returns(uint256)' : 'function totalSupply() view returns(uint256)'];
      const app = new Contract(address, abi, provider);
      const [owner, peer, incomingPaused, outgoingPaused, amount] = await Promise.all([
        app.owner(), app.peers(net[side === 'bsc' ? 'arc' : 'bsc'].eid), app.receivesPaused(), side === 'bsc' ? app.depositsPaused() : app.sendsPaused(), side === 'bsc' ? app.principalLD() : app.totalSupply(),
      ]);
      if (getAddress(owner) !== getAddress(prior.chains[side].deployments.find(item => item.id === `${side}:governance`).address) || peer !== '0x' + '00'.repeat(32) || !incomingPaused || !outgoingPaused || amount !== 0n) throw Error('PRIOR_APP_NOT_IDLE_' + side + '_' + assetId);
      assets[assetId] = { address, paused: true, peerUnset: true, principalOrSupply: '0' };
    }
    policy[side].startNonce = nonce;
    snapshot.chains[side] = { chainId: network.chainId, blockNumber: head.number, blockHash: head.hash, pendingNonce: nonce, nativeBalanceWei: balance.toString(), priorAssets: assets };
  } finally { provider.destroy(); }
}
snapshot.status = 'PRIOR_CONTRACTS_IDLE_REPLACEMENT_UNSIGNED';
await mkdir('research/production/immediate-beta-unsigned', { recursive: true });
await writeFile('research/production/immediate-beta-unsigned/policy.json', JSON.stringify(policy, null, 2) + '\n');
await writeFile('research/production/immediate-beta-unsigned/preparation-check.json', JSON.stringify(snapshot, null, 2) + '\n');
console.log(JSON.stringify({ status: snapshot.status, nonces: Object.fromEntries(Object.entries(snapshot.chains).map(([side, item]) => [side, item.pendingNonce])) }));
