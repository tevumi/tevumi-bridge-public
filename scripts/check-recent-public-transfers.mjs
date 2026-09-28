// Read-only recent transfer audit for the public bridge. No wallet access or broadcasts.
import { readFileSync, writeFileSync } from 'node:fs';
import { FetchRequest, Interface, JsonRpcProvider, zeroPadValue } from 'ethers';

const networks = JSON.parse(readFileSync('config/networks.json', 'utf8'));
const account = process.argv[2] ?? '0x489594537CB76aC256079D710B6E18498E1a5402';
if (!/^0x[0-9a-fA-F]{40}$/.test(account)) throw Error('Invalid public wallet address');
const sinceHours = Number(process.argv[3] ?? 8);
if (!Number.isFinite(sinceHours) || sinceHours <= 0 || sinceHours > 72) throw Error('Invalid hours');
const evidencePath = process.argv[4];
if (evidencePath && !/^research\/production\/immediate-beta-mainnet\/[a-z0-9-]+\.json$/.test(evidencePath)) throw Error('Invalid evidence path');
const since = Math.floor(Date.now() / 1000 - sinceHours * 3600);
const apps = {
  bsc: {
    binancelife: '0x89F3A44786C97618cc4b45721D433c9a83921ec4',
    cat: '0x561750f93BAC5BC237De7FE092b9A40e1cC20b06',
  },
  arc: {
    binancelife: '0x9aF52E914DCC692Af046A136AC1c59f98F7347E7',
    cat: '0x503200C60aaA078899B31268833c5F090693E30B',
  },
};
const iface = new Interface([
  'event OFTSent(bytes32 indexed guid,uint32 dstEid,address indexed fromAddress,uint256 amountSentLD,uint256 amountReceivedLD)',
  'event OFTReceived(bytes32 indexed guid,uint32 srcEid,address indexed toAddress,uint256 amountReceivedLD)',
]);
const topics = [iface.getEvent('OFTSent').topicHash, iface.getEvent('OFTReceived').topicHash];
const providers = {};
for (const side of ['bsc', 'arc']) {
  const url = process.env[networks[side].rpcEnv];
  if (!url) throw Error(`Missing read-only ${side} RPC`);
  const request = new FetchRequest(url);
  request.timeout = 60000;
  providers[side] = new JsonRpcProvider(request, networks[side].chainId, { batchMaxCount: 1, cacheTimeout: -1 });
}

async function blockSince(provider, head) {
  let low = 1, high = head;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const block = await provider.getBlock(mid);
    if (block.timestamp < since) low = mid + 1;
    else high = mid;
  }
  return low;
}

const result = { checkedAt: new Date().toISOString(), account, since: new Date(since * 1000).toISOString(), sides: {}, transfers: [] };
for (const side of ['bsc', 'arc']) {
  const provider = providers[side];
  const head = await provider.getBlockNumber();
  const start = await blockSince(provider, head);
  const events = [];
  for (let from = start; from <= head; from += 500) {
    const to = Math.min(from + 499, head);
    for (const [asset, address] of Object.entries(apps[side])) {
      const logs = await provider.getLogs({ address, topics: [topics, null, zeroPadValue(account, 32)], fromBlock: from, toBlock: to });
      for (const log of logs) {
        const event = iface.parseLog(log);
        const receipt = await provider.getTransactionReceipt(log.transactionHash);
        const block = await provider.getBlock(log.blockNumber);
        events.push({ asset, kind: event.name, guid: event.args.guid, remoteEid: Number(event.args.dstEid ?? event.args.srcEid), amountSentLD: event.name === 'OFTSent' ? event.args.amountSentLD.toString() : null, amountReceivedLD: event.args.amountReceivedLD.toString(), hash: log.transactionHash, block: log.blockNumber, at: new Date(block.timestamp * 1000).toISOString(), receiptSuccess: receipt?.status === 1 });
      }
    }
  }
  result.sides[side] = { chainId: networks[side].chainId, start, head, events };
}
for (const side of ['bsc', 'arc']) {
  const destination = side === 'bsc' ? 'arc' : 'bsc';
  for (const sent of result.sides[side].events.filter(e => e.kind === 'OFTSent')) {
    const matches = result.sides[destination].events.filter(e => e.kind === 'OFTReceived' && e.asset === sent.asset && e.guid.toLowerCase() === sent.guid.toLowerCase() && e.remoteEid === networks[side].eid && e.amountReceivedLD === sent.amountReceivedLD && e.receiptSuccess);
    result.transfers.push({ asset: sent.asset, from: side, to: destination, sent, received: matches.length === 1 ? matches[0] : null, matchingReceipts: matches.length, status: sent.receiptSuccess ? matches.length === 1 ? 'DELIVERED' : 'SOURCE_CONFIRMED_DELIVERY_UNVERIFIED' : 'SOURCE_FAILED' });
  }
}
result.transfers.sort((a, b) => b.sent.block - a.sent.block);
if (evidencePath) writeFileSync(evidencePath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
for (const provider of Object.values(providers)) provider.destroy();
