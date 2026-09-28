import { readFileSync, writeFileSync } from 'node:fs';
import { Contract, FetchRequest, Interface, JsonRpcProvider, zeroPadValue } from 'ethers';

const networks = JSON.parse(readFileSync('config/networks.json', 'utf8'));
const before = JSON.parse(readFileSync('research/production/immediate-beta-mainnet/cat-activation-readiness.json', 'utf8'));
const adminIface = new Interface(['function executeBatch(address[] targets,bytes[] payloads)']);
const appIface = new Interface(['function setPauses(bool,bool)']);
const report = { checkedAt: new Date().toISOString(), kind: 'independent-read-only-cat-activation', account: before.account, sides: {}, status: 'INCOMPLETE' };
for (const side of ['bsc', 'arc']) {
  const expected = before.sides[side], remote = before.sides[side === 'bsc' ? 'arc' : 'bsc'];
  const url = process.env[networks[side].rpcEnv]; if (!url) throw Error(`MISSING_${side.toUpperCase()}_RPC`);
  const request = new FetchRequest(url); request.timeout = 60000;
  const provider = new JsonRpcProvider(request, networks[side].chainId, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 });
  try {
    const [head, latestNonce, pendingNonce] = await Promise.all([provider.getBlockNumber(), provider.getTransactionCount(before.account, 'latest'), provider.getTransactionCount(before.account, 'pending')]);
    const result = { chainId: networks[side].chainId, head, latestNonce, pendingNonce, expectedNonce: expected.latestNonce, app: expected.app, admin: expected.admin, transactionFound: false };
    report.sides[side] = result;
    if (latestNonce <= expected.latestNonce) continue;
    let low = Math.max(0, head - 20000), high = head;
    if (await provider.getTransactionCount(before.account, low) > expected.latestNonce) throw Error(`CAT_TRANSACTION_BEFORE_SEARCH_WINDOW_${side.toUpperCase()}`);
    while (low + 1 < high) {
      const mid = Math.floor((low + high) / 2);
      if (await provider.getTransactionCount(before.account, mid) <= expected.latestNonce) low = mid;
      else high = mid;
    }
    const block = await provider.send('eth_getBlockByNumber', ['0x' + high.toString(16), true]);
    const tx = block.transactions.find(item => item.from.toLowerCase() === before.account.toLowerCase() && Number(BigInt(item.nonce)) === expected.latestNonce);
    if (!tx) throw Error(`CAT_TRANSACTION_NOT_FOUND_${side.toUpperCase()}`);
    const receipt = await provider.getTransactionReceipt(tx.hash);
    const data = adminIface.encodeFunctionData('executeBatch', [[expected.app], [appIface.encodeFunctionData('setPauses', [false, false])]]);
    const app = new Contract(expected.app, ['function owner() view returns(address)', 'function peers(uint32) view returns(bytes32)', 'function depositsPaused() view returns(bool)', 'function sendsPaused() view returns(bool)', 'function receivesPaused() view returns(bool)', 'function principalLD() view returns(uint256)', 'function totalSupply() view returns(uint256)'], provider);
    const [owner, peer, sendPaused, receivePaused, principalOrSupply] = await Promise.all([
      app.owner(), app.peers(networks[side === 'bsc' ? 'arc' : 'bsc'].eid), side === 'bsc' ? app.depositsPaused() : app.sendsPaused(), app.receivesPaused(), side === 'bsc' ? app.principalLD() : app.totalSupply(),
    ]);
    Object.assign(result, { transactionFound: true, transactionHash: tx.hash, blockNumber: high, senderOk: tx.from.toLowerCase() === before.account.toLowerCase(), toAdminOk: tx.to?.toLowerCase() === expected.admin.toLowerCase(), calldataOk: tx.input.toLowerCase() === data.toLowerCase(), valueZero: BigInt(tx.value) === 0n, receiptSuccess: receipt?.status === 1 && receipt.blockNumber === high, appOwnerOk: owner.toLowerCase() === expected.admin.toLowerCase(), peerOk: peer.toLowerCase() === zeroPadValue(remote.app, 32).toLowerCase(), sendPaused, receivePaused, principalOrSupply: principalOrSupply.toString() });
  } finally { provider.destroy(); }
}
report.status = Object.values(report.sides).length === 2 && Object.values(report.sides).every(item => item.transactionFound && item.senderOk && item.toAdminOk && item.calldataOk && item.valueZero && item.receiptSuccess && item.appOwnerOk && item.peerOk && item.sendPaused === false && item.receivePaused === false && item.principalOrSupply === '0') ? 'BOTH_CAT_ROUTES_OPEN_VERIFIED' : 'INCOMPLETE';
report.limitations = ['Read-only receipt and current-state verification; no wallet signing or broadcast.', 'Does not represent a new CAT transfer or independent audit.'];
const path = 'research/production/immediate-beta-mainnet/cat-activation-verification.json';
writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ path, status: report.status, sides: report.sides }, null, 2));
if (report.status !== 'BOTH_CAT_ROUTES_OPEN_VERIFIED') process.exitCode = 1;
