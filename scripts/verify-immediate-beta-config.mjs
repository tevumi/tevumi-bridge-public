// Read-only verification of the two user-signed immediate mainnet configuration batches.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { AbiCoder, Contract, FetchRequest, Interface, JsonRpcProvider, keccak256, zeroPadValue } from 'ethers';
import { endpointAbi, ulnType } from '../web/src/bridge.js';

const plan = JSON.parse(await readFile('web/immediate-deploy/public/config-plan.json', 'utf8'));
const manifest = JSON.parse(await readFile('research/production/immediate-beta-unsigned/manifest.json', 'utf8'));
const deployed = JSON.parse(await readFile('research/production/immediate-beta-mainnet/deployment-verification.json', 'utf8'));
const networks = JSON.parse(await readFile('config/networks.json', 'utf8'));
const epi = new Interface(endpointAbi);
const coder = AbiCoder.defaultAbiCoder();
const report = { checkedAt: new Date().toISOString(), releaseId: plan.releaseId, status: 'CHECKING', chains: {}, limitations: ['Read-only live state verification, not an audit or proof of real message delivery.', 'All four business contracts remain paused and no public bridging is enabled.'] };

for (const item of plan.batches) {
  const side = item.side, net = networks[side], remote = networks[side === 'bsc' ? 'arc' : 'bsc'];
  const batch = manifest.configurations.find(value => value.side === side);
  const previous = deployed.chains[side].deployments.at(-1);
  const nonce = previous.nonce + 1;
  if (item.chainId !== net.chainId || item.admin.toLowerCase() !== manifest.governance[side].toLowerCase() || item.stepCount !== 12 || keccak256(item.transaction.data) !== item.calldataHash || keccak256(batch.execute.data) !== item.calldataHash) throw Error('INVALID_PLAN_' + side);
  const rpcUrl = process.env[net.rpcEnv];
  if (!rpcUrl) throw Error('MISSING_RPC_' + side);
  const request = new FetchRequest(rpcUrl); request.timeout = 60000;
  const provider = new JsonRpcProvider(request, net.chainId, { staticNetwork: true, batchMaxCount: 1 });
  try {
    const [head, latestNonce, pendingNonce] = await Promise.all([
      provider.getBlockNumber(), provider.getTransactionCount(item.account, 'latest'), provider.getTransactionCount(item.account, 'pending'),
    ]);
    const result = { chainId: net.chainId, head, latestNonce, pendingNonce, expectedNonce: nonce, transactionFound: false, assets: {} };
    report.chains[side] = result;
    if (latestNonce <= nonce) continue;
    let low = previous.blockNumber, high = head;
    if (await provider.getTransactionCount(item.account, low) > nonce) throw Error('CONFIG_BEFORE_DEPLOYMENT_EVIDENCE_' + side);
    while (low + 1 < high) {
      const mid = Math.floor((low + high) / 2);
      if (await provider.getTransactionCount(item.account, mid) <= nonce) low = mid;
      else high = mid;
    }
    const block = await provider.send('eth_getBlockByNumber', ['0x' + high.toString(16), true]);
    const sent = block.transactions.find(tx => tx.from.toLowerCase() === item.account.toLowerCase() && Number(BigInt(tx.nonce)) === nonce);
    if (!sent) throw Error('CONFIG_TRANSACTION_NOT_FOUND_' + side);
    const receipt = await provider.getTransactionReceipt(sent.hash);
    Object.assign(result, {
      transactionFound: true, transactionHash: sent.hash, blockNumber: high, blockTimestamp: Number(BigInt(block.timestamp)),
      senderOk: sent.from.toLowerCase() === item.account.toLowerCase(), toAdminOk: sent.to?.toLowerCase() === item.admin.toLowerCase(),
      calldataMatchesPlan: keccak256(sent.input) === item.calldataHash, zeroValue: BigInt(sent.value) === 0n,
      receiptOk: receipt?.status === 1 && receipt.blockNumber === high,
      gasUsed: receipt?.gasUsed.toString(),
    });
    const admin = new Contract(item.admin, ['function owner() view returns(address)'], provider);
    result.adminOwnerOk = (await admin.owner()).toLowerCase() === item.account.toLowerCase();
    const ep = new Contract(net.endpoint, endpointAbi, provider);
    for (const [assetId, address] of Object.entries(item.apps)) {
      const other = item.remoteApps[assetId];
      const app = new Contract(address, [
        'function owner() view returns(address)', 'function peers(uint32) view returns(bytes32)', 'function receivesPaused() view returns(bool)',
        side === 'bsc' ? 'function depositsPaused() view returns(bool)' : 'function sendsPaused() view returns(bool)',
        side === 'bsc' ? 'function principalLD() view returns(uint256)' : 'function totalSupply() view returns(uint256)',
      ], provider);
      const [owner, peer, receivePaused, sendPaused, delegate, principalOrSupply] = await Promise.all([
        app.owner(), app.peers(remote.eid), app.receivesPaused(), app[side === 'bsc' ? 'depositsPaused' : 'sendsPaused'](),
        ep.delegates(address), app[side === 'bsc' ? 'principalLD' : 'totalSupply'](),
      ]);
      const state = {
        address, ownerOk: owner.toLowerCase() === item.admin.toLowerCase(), delegateOk: delegate.toLowerCase() === item.admin.toLowerCase(),
        peerOk: peer.toLowerCase() === zeroPadValue(other, 32).toLowerCase(), receivePaused, sendPaused, principalOrSupplyZero: principalOrSupply === 0n,
      };
      const steps = batch.steps.filter(step => step.assetId === assetId);
      if (steps.length !== 6) throw Error('ASSET_STEPS_INCOMPLETE_' + side + '_' + assetId);
      const step = key => steps.find(value => value.key === key);
      const send = epi.decodeFunctionData('setSendLibrary', step('sendLibrary').data);
      const receive = epi.decodeFunctionData('setReceiveLibrary', step('receiveLibrary').data);
      const actualReceive = await ep.getReceiveLibrary(address, remote.eid);
      state.sendLibraryOk = (await ep.getSendLibrary(address, remote.eid)).toLowerCase() === send[2].toLowerCase() && !(await ep.isDefaultSendLibrary(address, remote.eid));
      state.receiveLibraryOk = actualReceive[0].toLowerCase() === receive[2].toLowerCase() && actualReceive[1] === false;
      for (const key of ['sendDVN', 'receiveDVN', 'executor']) {
        const args = epi.decodeFunctionData('setConfig', step(key).data);
        const raw = await ep.getConfig(address, args[1], remote.eid, args[2][0].configType);
        if (key === 'executor') state.executorOk = raw.toLowerCase() === args[2][0].config.toLowerCase();
        else {
          const actual = coder.decode([ulnType], raw)[0], expected = coder.decode([ulnType], args[2][0].config)[0];
          // 255 is LayerZero's stored NIL_DVN_COUNT sentinel; getConfig returns the effective empty set as 0.
          const normalized = value => ({ confirmations: String(value.confirmations), requiredDVNCount: String(value.requiredDVNCount), optionalDVNCount: String(value.optionalDVNCount === 255n ? 0n : value.optionalDVNCount), optionalDVNThreshold: String(value.optionalDVNThreshold), requiredDVNs: Array.from(value.requiredDVNs).map(v => String(v).toLowerCase()), optionalDVNs: Array.from(value.optionalDVNs).map(v => String(v).toLowerCase()) });
          const got = normalized(actual), want = normalized(expected);
          state[key + 'Ok'] = JSON.stringify(got) === JSON.stringify(want);
          if (!state[key + 'Ok']) state[key + 'Difference'] = { got, want };
        }
      }
      result.assets[assetId] = state;
    }
  } finally { provider.destroy(); }
}

report.status = Object.values(report.chains).length === 2 && Object.values(report.chains).every(chain => chain.transactionFound && chain.senderOk && chain.toAdminOk && chain.calldataMatchesPlan && chain.zeroValue && chain.receiptOk && chain.adminOwnerOk && Object.keys(chain.assets).length === 2 && Object.values(chain.assets).every(asset => Object.entries(asset).every(([key, value]) => key === 'address' || value === true))) ? 'BOTH_CONFIG_BATCHES_VERIFIED_PAUSED' : 'INCOMPLETE_OR_CONFIG_MISMATCH';
await mkdir('research/production/immediate-beta-mainnet', { recursive: true });
await writeFile('research/production/immediate-beta-mainnet/config-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, checkedAt: report.checkedAt, chains: Object.fromEntries(Object.entries(report.chains).map(([side, value]) => [side, { head: value.head, latestNonce: value.latestNonce, pendingNonce: value.pendingNonce, transactionHash: value.transactionHash, receiptOk: value.receiptOk, assets: Object.keys(value.assets) }])) }));
if (report.status !== 'BOTH_CONFIG_BATCHES_VERIFIED_PAUSED') process.exitCode = 1;
