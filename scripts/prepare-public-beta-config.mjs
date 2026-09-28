// Public unsigned timelock schedule data, generated only after six on-chain deployments verify.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { AbiCoder, Interface, getAddress, keccak256 } from 'ethers';

const manifest = JSON.parse(await readFile('research/production/public-beta-unsigned/manifest.json', 'utf8'));
const verified = JSON.parse(await readFile('research/production/public-beta-mainnet/deployment-verification.json', 'utf8'));
const networks = JSON.parse(await readFile('config/networks.json', 'utf8'));
if (verified.releaseId !== manifest.releaseId || verified.status !== 'SIX_DEPLOYMENTS_VERIFIED_PAUSED') throw Error('DEPLOYMENTS_NOT_VERIFIED');
const scheduleAbi = new Interface(['function scheduleBatch(address[] targets,uint256[] values,bytes[] payloads,bytes32 predecessor,bytes32 salt,uint256 delay)']);
const schedules = [];
for (const config of manifest.configurations) {
  const side = config.side, chain = verified.chains[side];
  if (chain.deployments.length !== 3 || chain.deployments.some(row => !row.receiptOk || !row.creationDataMatchesPlan || !row.codePresent)) throw Error('DEPLOYMENTS_INCOMPLETE_' + side);
  const targets = config.steps.map(step => step.to), values = config.steps.map(step => step.value), payloads = config.steps.map(step => step.data);
  const encoded = scheduleAbi.encodeFunctionData('scheduleBatch', [targets, values, payloads, config.predecessor, config.salt, 86400]);
  if (encoded !== config.schedule.data || getAddress(config.schedule.to) !== getAddress(config.timelock) || getAddress(config.timelock) !== getAddress(manifest.governance[side])) throw Error('SCHEDULE_MISMATCH_' + side);
  const operationId = keccak256(AbiCoder.defaultAbiCoder().encode(['address[]','uint256[]','bytes[]','bytes32','bytes32'],[targets, values, payloads, config.predecessor, config.salt]));
  schedules.push({ side, chainId: networks[side].chainId, account: config.proposer, timelock: config.timelock, operationId, stepCount: config.steps.length, calldataHash: keccak256(encoded), transaction: config.schedule });
}
if (schedules.length !== 2 || schedules[0].side !== 'bsc' || schedules[1].side !== 'arc') throw Error('SCHEDULE_COUNT_OR_ORDER');
const output = { releaseId: manifest.releaseId, account: schedules[0].account, state: 'DEPLOYED_PAUSED_UNSIGNED_SCHEDULE', minDelaySeconds: 86400, schedules };
await mkdir('web/beta-deploy/public', { recursive: true });
await writeFile('web/beta-deploy/public/config-plan.json', JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ status: output.state, output: 'web/beta-deploy/public/config-plan.json', operationIds: schedules.map(item => item.operationId) }));
