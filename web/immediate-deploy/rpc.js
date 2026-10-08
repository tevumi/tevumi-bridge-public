// Public, read-only RPCs. Wallet signing remains on the injected provider.
const endpoints = {
  56: ['https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed-public.bnbchain.org', 'https://bsc-rpc.publicnode.com'],
  5042: ['https://rpc.mainnet.arc.io'],
};
let arcReadQueue = Promise.resolve();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function arcReadSlot() {
  const turn = arcReadQueue;
  arcReadQueue = turn.then(() => wait(350));
  return turn;
}

export const hasRpc = chainId => Array.isArray(endpoints[chainId]);

export async function rpc(chainId, method, params) {
  // BSC dataseed nodes reject eth_getLogs even for a single block. PublicNode
  // supports the delivery-event query used by the live roundtrip page.
  const urls = chainId === 56 && method === 'eth_getLogs'
    ? [endpoints[56][2], ...endpoints[56].slice(0, 2)]
    : endpoints[chainId];
  if (!urls) throw Error('不支持的只读网络。');
  let lastReason = '网络不可用';
  for (const url of urls) {
    const attempts = chainId === 5042 ? 4 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if (chainId === 5042) await arcReadSlot();
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(chainId === 5042 ? 30000 : 12000),
      });
      if (!response.ok) {
        lastReason = `HTTP ${response.status}`;
        if (chainId === 5042 && response.status === 429 && attempt + 1 < attempts) { await wait(500 * (attempt + 1)); continue; }
        break;
      }
      const body = await response.json();
      if (body.error) {
        const reason = String(body.error.message || '查询失败').slice(0, 120);
        if (/limit exceeded|rate limit|too many requests/i.test(reason) && (method === 'eth_getLogs' || chainId === 5042)) {
          lastReason = reason;
          if (chainId === 5042 && attempt + 1 < attempts) await wait(500 * (attempt + 1));
          continue;
        }
        throw Object.assign(Error(`只读节点拒绝 ${method}：${reason}`), {
          rpcRevert: true,
          ...(Number.isInteger(body.error.code) ? {code: body.error.code} : {}),
          ...(typeof body.error.data === 'string' && /^0x[0-9a-f]*$/i.test(body.error.data) && body.error.data.length <= 8194 ? {data: body.error.data} : {}),
        });
      }
      if (body.result == null) { lastReason = '空结果'; break; }
      return body.result;
    } catch (error) {
      if (error.rpcRevert) throw error;
      lastReason = error.name === 'TimeoutError' ? '超时' : '连接失败';
    }
    }
  }
  throw Error(`只读 RPC ${method} ${lastReason}；尚未请求钱包签名。可稍后点击“继续”，页面会先复核链上状态。`);
}
