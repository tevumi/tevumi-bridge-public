import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Interface, ZeroAddress } from 'ethers';

// No signer, private key, wallet creation, or write RPC is used in this script.
const networks = JSON.parse(await readFile(new URL('../config/networks.json', import.meta.url)));
const metadataUrl = 'https://metadata.layerzero-api.com/v1/metadata';
const endpointAbi = new Interface([
  'function eid() view returns (uint32)',
  'function nativeToken() view returns (address)',
  'function defaultSendLibrary(uint32) view returns (address)',
  'function defaultReceiveLibrary(uint32) view returns (address)',
]);
const libraryAbi = new Interface([
  'function getUlnConfig(address,uint32) view returns ((uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs))',
  'function getExecutorConfig(address,uint32) view returns ((uint32 maxMessageSize,address executor))',
]);
const executorAbi = new Interface([
  'function dstConfig(uint32) view returns (uint64,uint16,uint128,uint128,uint64)',
]);
const dvnAbi = new Interface([
  'function dstConfig(uint32) view returns (uint64,uint16,uint128)',
  'function getFee(uint32,uint64,address,bytes) view returns (uint256)',
]);
const allowedMethods = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getCode', 'eth_call', 'eth_gasPrice', 'eth_getBalance']);
let requestId = 0;
async function rpc(url, method, params = []) {
  if (!allowedMethods.has(method)) throw new Error('Write RPC forbidden');
  let response;
  try {
    response = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
      signal: AbortSignal.timeout(15000),
    });
  } catch { throw new Error(`${method}: transport failure (RPC URL omitted)`); }
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: RPC error ${body.error.code}`);
  if (body.result === undefined) throw new Error(`${method}: no result`);
  return body.result;
}
async function inspect(key, config, remote, metadata) {
  const result = { chainId: config.chainId, eid: config.eid, checks: {}, problems: [] };
  const url = process.env[config.rpcEnv] || config.rpc;
  const attempt = async (label, fn) => {
    try { result.checks[label] = await fn(); return result.checks[label]; }
    catch (error) { result.problems.push(`${label}: ${error.message}`); return undefined; }
  };
  const chainId = Number(await rpc(url, 'eth_chainId'));
  if (chainId !== config.chainId) throw new Error(`Wrong chain: expected ${config.chainId}, received ${chainId}`);
  const block = await rpc(url, 'eth_blockNumber');
  result.blockNumber = Number(block);
  result.rpcSource = process.env[config.rpcEnv] ? 'private environment override (URL omitted)' : 'official public RPC';
  const call = async (address, abi, method, args = []) => {
    const raw = await rpc(url, 'eth_call', [{ to: address, data: abi.encodeFunctionData(method, args) }, block]);
    return abi.decodeFunctionResult(method, raw);
  };
  const code = async address => {
    const bytes = await rpc(url, 'eth_getCode', [address, block]);
    if (bytes === '0x') throw new Error(`No bytecode at ${address}`);
    return (bytes.length - 2) / 2;
  };
  await attempt('endpointBytes', () => code(config.endpoint));
  await attempt('endpointEid', async () => {
    const value = Number((await call(config.endpoint, endpointAbi, 'eid'))[0]);
    if (value !== config.eid) throw new Error(`EID mismatch: ${value}`);
    return value;
  });
  await attempt('nativeToken', async () => (await call(config.endpoint, endpointAbi, 'nativeToken'))[0]);
  await attempt('gasPrice', async () => ({ wei: BigInt(await rpc(url, 'eth_gasPrice')).toString(), symbol: config.nativeSymbol }));
  const dvnDetails = async addresses => Promise.all(addresses.map(async address => {
    const entry = metadata?.[key]?.dvns?.[address.toLowerCase()];
    return { address, id: entry?.id ?? 'unknown', deprecated: entry?.deprecated ?? null, codeBytes: await code(address) };
  }));
  for (const [label, method] of [['send', 'defaultSendLibrary'], ['receive', 'defaultReceiveLibrary']]) {
    await attempt(`${label}Library`, async () => {
      const address = (await call(config.endpoint, endpointAbi, method, [remote.eid]))[0];
      if (address === ZeroAddress) throw new Error('No default library configured');
      const codeBytes = await code(address);
      const [uln] = await call(address, libraryAbi, 'getUlnConfig', [ZeroAddress, remote.eid]);
      const library = {
        address, codeBytes, confirmations: uln.confirmations.toString(),
        requiredDVNs: await dvnDetails([...uln.requiredDVNs]),
        optionalDVNs: await dvnDetails([...uln.optionalDVNs]),
        optionalDVNThreshold: Number(uln.optionalDVNThreshold),
      };
      if (label === 'send') {
        const [executor] = await call(address, libraryAbi, 'getExecutorConfig', [ZeroAddress, remote.eid]);
        library.executor = { address: executor.executor, maxMessageSize: Number(executor.maxMessageSize), codeBytes: await code(executor.executor) };
        // Older executor versions may expose a different tuple. Keep this a separate check.
        await attempt('executorDestination', async () => [...await call(executor.executor, executorAbi, 'dstConfig', [remote.eid])].map(String));
      }
      return library;
    });
  }
  result.defaultRouteUsable = ['sendLibrary', 'receiveLibrary'].every(label => {
    const lib = result.checks[label];
    return lib && lib.requiredDVNs.length > 0 && lib.requiredDVNs.every(d => d.deprecated !== true && d.id !== 'unknown');
  });
  result.candidateDVNs = [];
  for (const [address, entry] of Object.entries(metadata?.[key]?.dvns ?? {})) {
    if (entry.deprecated || entry.version !== 2) continue;
    if (!Object.values(metadata?.[key === 'bsc' ? 'arc' : 'bsc']?.dvns ?? {}).some(d => d.id === entry.id && !d.deprecated && d.version === 2)) continue;
    const candidate = { address, id: entry.id };
    try {
      candidate.codeBytes = await code(address);
      candidate.destinationConfig = [...await call(address, dvnAbi, 'dstConfig', [remote.eid])].map(String);
      // Diagnostic fee only: no Tevumi contract exists and this is not a send quote.
      candidate.confirmationsForDiagnostic = key === 'arc' ? 5 : 20;
      candidate.diagnosticFeeWei = (await call(address, dvnAbi, 'getFee', [remote.eid, candidate.confirmationsForDiagnostic, ZeroAddress, '0x']))[0].toString();
    } catch (error) { candidate.problem = error.message; }
    result.candidateDVNs.push(candidate);
  }
  return result;
}
const report = {
  checkedAt: new Date().toISOString(), mode: 'read-only-mainnet',
  metadataSource: metadataUrl, networks: {},
  limitations: ['Default library settings are not application configuration.', 'Bytecode/configuration does not prove live DVN service or delivery.', 'No deployed Tevumi app, fee quote, or end-to-end transfer is tested.'],
};
let metadata;
try {
  const response = await fetch(metadataUrl, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error();
  metadata = await response.json();
} catch { report.metadataProblem = 'Live metadata unavailable; DVN identities cannot be confirmed.'; }
const results = await Promise.allSettled(Object.entries(networks).map(async ([key, config]) => [key, await inspect(key, config, networks[key === 'bsc' ? 'arc' : 'bsc'], metadata)]));
for (let i = 0; i < results.length; i++) {
  const outcome = results[i];
  const key = Object.keys(networks)[i];
  report.networks[key] = outcome.status === 'fulfilled' ? outcome.value[1] : { problems: [outcome.reason.message] };
}
report.infrastructureChecksComplete = !report.metadataProblem && Object.values(report.networks).every(n => n.problems.length === 0);
report.readyForDeployment = false;
await mkdir(new URL('../research/preflight/', import.meta.url), { recursive: true });
const output = new URL('../research/preflight/latest.json', import.meta.url);
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.infrastructureChecksComplete) process.exitCode = 1;
