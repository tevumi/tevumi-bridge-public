import { readFileSync, writeFileSync } from 'node:fs';
import { Contract, FetchRequest, Interface, JsonRpcProvider, formatEther, zeroPadValue } from 'ethers';

const networks = JSON.parse(readFileSync('config/networks.json', 'utf8'));
const manifest = JSON.parse(readFileSync('research/production/immediate-beta-unsigned/manifest.json', 'utf8'));
const account = '0x489594537CB76aC256079D710B6E18498E1a5402';
const addresses = {};
for (const item of manifest.deployments) {
  if (item.assetId === 'cat') addresses[item.side] = { ...addresses[item.side], app: item.predictedAddress };
  else if (!item.assetId) addresses[item.side] = { ...addresses[item.side], admin: item.predictedAddress };
}
const pauseData = new Interface(['function setPauses(bool,bool)']).encodeFunctionData('setPauses', [false, false]);
const output = { checkedAt: new Date().toISOString(), asset: 'cat', account, kind: 'read-only-activation-preflight', sides: {}, limitations: ['No wallet signing or transaction broadcast.', 'Fee and balance quotes change before signing.'] };
for (const side of ['bsc', 'arc']) {
  const url = process.env[networks[side].rpcEnv];
  if (!url) throw Error(`MISSING_${side.toUpperCase()}_RPC`);
  const request = new FetchRequest(url); request.timeout = 45000;
  const provider = new JsonRpcProvider(request, networks[side].chainId, { batchMaxCount: 1, cacheTimeout: -1 });
  const other = side === 'bsc' ? 'arc' : 'bsc';
  const app = new Contract(addresses[side].app, ['function owner() view returns(address)', 'function peers(uint32) view returns(bytes32)', 'function depositsPaused() view returns(bool)', 'function sendsPaused() view returns(bool)', 'function receivesPaused() view returns(bool)'], provider);
  const admin = new Contract(addresses[side].admin, ['function owner() view returns(address)', 'function executeBatch(address[] targets,bytes[] payloads)'], provider);
  const [appOwner, adminOwner, peer, sendPaused, receivePaused, gas, fee, native, latestNonce, pendingNonce] = await Promise.all([
    app.owner(), admin.owner(), app.peers(networks[other].eid), side === 'bsc' ? app.depositsPaused() : app.sendsPaused(), app.receivesPaused(),
    admin.executeBatch.estimateGas([addresses[side].app], [pauseData], { from: account }), provider.getFeeData(), provider.getBalance(account),
    provider.getTransactionCount(account, 'latest'), provider.getTransactionCount(account, 'pending'),
  ]);
  const expectedPeer = zeroPadValue(addresses[other].app, 32);
  if (appOwner.toLowerCase() !== addresses[side].admin.toLowerCase() || adminOwner.toLowerCase() !== account.toLowerCase() || peer.toLowerCase() !== expectedPeer.toLowerCase() || !sendPaused || !receivePaused || latestNonce !== pendingNonce) throw Error(`CAT_ACTIVATION_STATE_MISMATCH_${side.toUpperCase()}`);
  const maxPrice = fee.maxFeePerGas ?? fee.gasPrice;
  if (!maxPrice || native <= gas * maxPrice) throw Error(`CAT_ACTIVATION_FEE_INSUFFICIENT_${side.toUpperCase()}`);
  output.sides[side] = { chainId: networks[side].chainId, admin: addresses[side].admin, app: addresses[side].app, adminOwner, appOwner, peer, sendPaused, receivePaused, estimatedGas: gas.toString(), estimatedMaxNetworkFee: formatEther(gas * maxPrice), nativeBalance: formatEther(native), latestNonce, pendingNonce, balanceCoversEstimate: true };
}
output.status = 'CAT_ACTIVATION_READY_FOR_TWO_WALLET_SIGNATURES';
const path = 'research/production/immediate-beta-mainnet/cat-activation-readiness.json';
writeFileSync(path, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ path, status: output.status, sides: output.sides }, null, 2));
