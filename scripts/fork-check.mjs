// Local forks only. Remote URLs are used by Hardhat for state reads.
// All deployments/configuration/sends below execute in the in-memory EVM.
import { network } from 'hardhat';
import { BrowserProvider, ContractFactory, parseEther, zeroPadValue, formatUnits } from 'ethers';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { compile } from './compile.mjs';
import { configurationSteps, inspectConfiguration, transferPlan } from '../web/src/bridge.js';

const chains = JSON.parse(await readFile('config/networks.json'));
const preflight = JSON.parse(await readFile('research/preflight/latest.json'));
const build = compile();
const result = { checkedAt: new Date().toISOString(), mode: 'local-mainnet-forks-only', chains: {}, limitations: ['No transaction is broadcast to mainnet.', 'Source-chain send simulation does not test DVN offchain verification or cross-chain delivery.', 'Numbers use local fork execution; not a live deployment budget.'] };
const selected = process.env.FORK_CHAIN;
if (selected && !Object.hasOwn(chains, selected)) throw new Error('FORK_CHAIN must be bsc or arc');
for (const key of selected ? [selected] : Object.keys(chains)) {
  let connection;
  const c = chains[key], other = chains[key === 'bsc' ? 'arc' : 'bsc'];
  const state = preflight.networks[key];
  const record = result.chains[key] = { chainId: c.chainId, forkBlock: state.blockNumber };
  try {
    if (!state.blockNumber || state.problems.length) throw new Error('Successful preflight required');
    // Prefer providers with one active address per chain in this snapshot.
    const dvns = ['canary', 'p2p'].map(id => {
      const candidates = state.candidateDVNs.filter(d => d.id === id && !d.problem && BigInt(d.destinationConfig[0]) > 0n);
      if (candidates.length !== 1) throw new Error(`Ambiguous/unavailable DVN ${id}`);
      return candidates[0].address;
    }).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
    connection = await network.create({ network: 'local', override: {
      chainId: c.chainId, hardfork: 'cancun',
      forking: { url: process.env[c.rpcEnv] || c.rpc, blockNumber: state.blockNumber },
    } });
    const provider = new BrowserProvider(connection.provider, undefined, { cacheTimeout: -1 });
    const admin = await provider.getSigner(0), who = await admin.getAddress();
    let deploymentGas = 0n, configurationGas = 0n;
    const deploy = async (name, args) => {
      const a = Object.values(build).find(f => f[name])[name];
      const deployed = await new ContractFactory(a.abi, `0x${a.evm.bytecode.object}`, admin).deploy(...args);
      const receipt = await deployed.deploymentTransaction().wait();
      deploymentGas += receipt.gasUsed;
      return deployed;
    };
    const token = key === 'bsc' ? await deploy('PilotToken', [who]) : undefined;
    const pilot = key === 'bsc'
      ? await deploy('PilotAdapter', [await token.getAddress(), c.endpoint, who, who, other.eid, parseEther('1'), parseEther('2')])
      : await deploy('PilotOFT', [c.endpoint, who, who, other.eid, parseEther('1'), parseEther('2')]);
    const address = await pilot.getAddress();
    const configure = async tx => { configurationGas += (await (await tx).wait()).gasUsed; };
    // Dummy peer for local send simulation only; never an approved mainnet peer.
    // Exercise exactly the reviewed configuration builder used by the browser.
    const browserChain = { ...c, remote:other.eid };
    for (const step of configurationSteps(c.chainId,browserChain,address,who)) {
      await configure(admin.sendTransaction({to:step.to,data:step.data,value:0n}));
    }
    const browserCheck = await inspectConfiguration(provider,c.chainId,browserChain,address,who,who,token?await token.getAddress():address,'1','2');
    if (!browserCheck.ready) throw new Error('Browser configuration checks failed on the real forked Endpoint');
    record.browserConfigurationVerified = true;
    // TYPE_3, executor worker 1, option length 17, lzReceive option 1, 200000 gas.
    const options = '0x000301001101' + BigInt(200000).toString(16).padStart(32, '0');
    const p = [other.eid, zeroPadValue(who, 32), parseEther('0.000001'), parseEther('0.000001'), options, '0x', '0x'];
    const fee = await pilot.quoteSend(p, false);
    Object.assign(record, { deployedLocally: true, dvns, deploymentGas: String(deploymentGas), configurationGas: String(configurationGas), diagnosticNativeFee: formatUnits(fee.nativeFee, 18), nativeSymbol: c.nativeSymbol });
    if (token) {
      const approval = await transferPlan(provider,c.chainId,browserChain,address,await token.getAddress(),who,'0.000001',true);
      await (await admin.sendTransaction({to:approval.to,data:approval.data,value:0n})).wait();
      const sending = await transferPlan(provider,c.chainId,browserChain,address,await token.getAddress(),who,'0.000001');
      const receipt = await (await admin.sendTransaction({to:sending.to,data:sending.data,value:BigInt(sending.value)})).wait();
      record.browserSourceSendVerified = true;
      record.sourceSendGas = String(receipt.gasUsed);
      record.lockedBalance = String(await token.balanceOf(address));
    } else {
      record.sourceSendNotTested = 'No authentic inbound message on isolated fork; no artificial mint was added.';
    }
  } catch (error) {
    // Do not log provider error objects or URLs (may contain private API credentials).
    const safeMessage = String(error.shortMessage || error.message || 'Unknown failure').replace(/https?:\/\/[^\s"')]+/g, '[RPC URL omitted]').slice(0,600);
    record.problem = `${error.code ?? 'ERROR'}: ${safeMessage}`;
    console.error(`${key}: ${record.problem}`);
  } finally { if (connection) await connection.close(); }
}
await mkdir('research/preflight', { recursive: true });
await writeFile(`research/preflight/fork-${selected ?? 'latest'}.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (Object.values(result.chains).some(c => c.problem)) process.exitCode = 1;
