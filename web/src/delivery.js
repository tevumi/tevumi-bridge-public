import { Interface } from 'ethers';
import { pilotAbi, verifyDelivery } from './bridge.js';

const iface = new Interface(pilotAbi);
// Cursor is session-only. Reloading always searches again from the source timestamp.
export async function findDelivery(record, source, destination, cursor) {
  if (record.status !== 'sent' || !record.guid) throw new Error('源链发送尚未核验。');
  if (Number((await source.getNetwork()).chainId) !== record.chainId || Number((await destination.getNetwork()).chainId) !== record.destinationChainId) throw new Error('查询网络不匹配。');
  const head = await destination.getBlockNumber();
  let next = cursor;
  if (!Number.isSafeInteger(next) || next < 0 || next > head) {
    const block = await source.getBlock(record.blockNumber);
    if (!block) throw new Error('源链区块暂不可读取。');
    const timestamp = block.timestamp - 120;
    let lo = 0, hi = head;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2), candidate = await destination.getBlock(mid);
      if (!candidate) throw new Error('目标链区块暂不可读取。');
      if (candidate.timestamp >= timestamp) hi = mid; else lo = mid;
    }
    next = lo;
  }
  // Bound work per poll; resume large historical ranges without skipping any blocks.
  for (let batch = 0; batch < 4 && next <= head; batch++) {
    const end = Math.min(next + 999, head);
    const logs = await destination.getLogs({ address: record.destinationAddress, fromBlock: next, toBlock: end, topics: [iface.getEvent('OFTReceived').topicHash, record.guid] });
    for (const log of logs) {
      if (log.removed || log.address.toLowerCase() !== record.destinationAddress.toLowerCase()) continue;
      let event; try { event = iface.parseLog(log); } catch { continue; }
      if (!event || event.args.guid.toLowerCase() !== record.guid.toLowerCase() || Number(event.args.srcEid) !== record.sourceEid || event.args.toAddress.toLowerCase() !== record.account.toLowerCase() || event.args.amountReceivedLD !== BigInt(record.amount)) continue;
      const delivered = await verifyDelivery(record, destination, log.transactionHash);
      return { record: delivered, cursor: next };
    }
    next = end + 1;
  }
  return { record, cursor: next > head ? Math.max(0, head - 32) : next };
}
