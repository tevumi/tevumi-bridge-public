// Publish only public, unsigned deployment and immediate configuration data.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { getCreateAddress, keccak256 } from 'ethers';

const base = 'research/production/immediate-beta-unsigned/';
const plan = JSON.parse(await readFile(base + 'manifest.json', 'utf8'));
const policy = JSON.parse(await readFile(base + 'policy.json', 'utf8'));
const check = JSON.parse(await readFile(base + 'preparation-check.json', 'utf8'));
const networks = JSON.parse(await readFile('config/networks.json', 'utf8'));
if (plan.status !== 'UNSIGNED_PAUSED_CANDIDATE' || plan.governanceMode !== 'immediate-eoa' || plan.deployments.length !== 6 || check.status !== 'PRIOR_CONTRACTS_IDLE_REPLACEMENT_UNSIGNED') throw Error('IMMEDIATE_RELEASE_NOT_READY');
const chains = {};
for (const side of ['bsc', 'arc']) {
  const items = plan.deployments.filter(row => row.side === side);
  if (items.length !== 3 || check.chains[side].pendingNonce !== policy[side].startNonce) throw Error('NONCE_MISMATCH_' + side);
  for (const [i, item] of items.entries()) {
    if (item.transaction.nonce !== policy[side].startNonce + i || getCreateAddress({ from: item.transaction.from, nonce: item.transaction.nonce }) !== item.predictedAddress) throw Error('DEPLOYMENT_MISMATCH_' + side);
  }
  chains[side] = { chainId: side === 'bsc' ? 56 : 5042, startNonce: policy[side].startNonce, deployments: items.map(item => ({ id: item.id, contract: item.contract, assetId: item.assetId, predictedAddress: item.predictedAddress, creationDataHash: keccak256(item.transaction.data), transaction: item.transaction })) };
}
const account = policy.bsc.deployer;
if (account !== policy.arc.deployer) throw Error('ACCOUNT_MISMATCH');
const signing = { releaseId: plan.releaseId, preparedAt: plan.preparedAt, sourceInputHash: plan.sourceInputHash, account, limits: { perSend: '0.000001', burst: '0.000010', window: '0.000100', capacity: '0.000100' }, chains };
const config = { releaseId: plan.releaseId, account, state: 'UNSIGNED_IMMEDIATE_CONFIG', batches: plan.configurations.map(row => ({ side: row.side, chainId: chains[row.side].chainId, account, admin: row.timelock, endpoint: networks[row.side].endpoint, stepCount: row.steps.length, calldataHash: keccak256(row.execute.data), transaction: row.execute, apps: plan.apps[row.side], remoteApps: plan.apps[row.side === 'bsc' ? 'arc' : 'bsc'] })) };
if (config.batches.some(row => row.stepCount !== 12)) throw Error('CONFIG_INCOMPLETE');
await mkdir('web/immediate-deploy/public', { recursive: true });
await writeFile('web/immediate-deploy/public/plan.json', JSON.stringify(signing, null, 2) + '\n');
await writeFile('web/immediate-deploy/public/config-plan.json', JSON.stringify(config, null, 2) + '\n');
console.log(JSON.stringify({ status: 'IMMEDIATE_PAGES_PREPARED_UNSIGNED', deployments: 6, batches: 2 }));
