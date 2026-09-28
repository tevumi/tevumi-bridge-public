import solc from 'solc';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { AbiCoder, Interface, keccak256 } from 'ethers';

// Only source files and public chain evidence are exported. No environment values.
const build = JSON.parse(readFileSync('artifacts/build.json', 'utf8'));
if (build.compiler !== solc.version()) throw new Error('Compiler version differs from build');
const real = process.argv.includes("--real");
const v2 = process.argv.includes('--real-v2');
const targets = v2 ? ['binancelife','cat'].map(id=>{const r=JSON.parse(readFileSync(`research/real-assets/${id}-v2-deployment.json`,'utf8')).verified;return [r.chainId,r.kind,r.address.toLowerCase(),r.txHash,r.assetId];}) : real ? ["binancelife-bsc", "binancelife-arc", "cat-bsc", "cat-arc"].map(id => {
 const r=JSON.parse(readFileSync(`research/real-assets/${id}-deployment.json`, "utf8"));
 return [r.chainId,r.kind,r.address.toLowerCase(),r.txHash,r.assetId];
}) : [
  [56, 'PilotToken', '0x484fb9303206a4ced7227165abdef57f8eb031d8', '0xca8dcb2a73a2a51f37d5abe676a28786e25147970fa94dcfb50d4d2df072821d'],
  [56, 'PilotAdapter', '0x687dda42344013822536cb8f0f5f54d6edaefa9a', '0x161b937d6c6d3fd5125f7a9d619fe6215770552ecad42c76cad56e6b00124534'],
  [5042, 'PilotOFT', '0x484fb9303206a4ced7227165abdef57f8eb031d8', '0xe0638f6987c9c18db6b3897647c4069ab35219c295d7beab7d31a1735dfa83d0'],
];
const sources = structuredClone(build.input.sources);
const expanded = structuredClone(build.input);
expanded.settings.outputSelection = { '*': { '*': ['metadata', 'abi', 'evm.bytecode.object', 'evm.deployedBytecode'] } };
const output = JSON.parse(solc.compile(JSON.stringify(expanded), { import: path => {
  const content = readFileSync('node_modules/' + path, 'utf8');
  sources[path] = { content };
  return { contents: content };
} }));
if (output.errors?.some(e => e.severity === 'error')) throw new Error('Compilation failed');
async function rpc(id, method, params) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(process.env[id === 56 ? 'BSC_RPC_URL' : 'ARC_RPC_URL'], {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000),
      });
      const j = await r.json(); if (!r.ok || j.error) throw new Error(); return j.result;
    } catch { if (attempt === 1) throw new Error(`RPC read failed: ${id} ${method}`); }
  }
}
const manifest = { generatedAt: new Date().toISOString(), compiler: solc.version(), targets: [] };
for (const [chainId, name, address, hash, assetId] of targets) {
  if (Number(await rpc(chainId, 'eth_chainId', [])) !== chainId) throw new Error('Wrong network');
  const file = Object.keys(output.contracts).find(f => f.startsWith('contracts/') && output.contracts[f][name]);
  const artifact = output.contracts[file][name], metadata = JSON.parse(artifact.metadata);
  const input = { language: 'Solidity', sources: Object.fromEntries(Object.keys(metadata.sources).map(p => [p, sources[p]])), settings: structuredClone(expanded.settings) };
  if (Object.keys(input.sources).some(p => p.startsWith('contracts/test/'))) throw new Error('Mock in production closure');
  const standalone = JSON.parse(solc.compile(JSON.stringify(input)));
  if (standalone.errors?.some(e => e.severity === 'error')) throw new Error('Standalone compilation failed');
  const creation = standalone.contracts[file][name].evm.bytecode.object;
  if (creation !== build.output.contracts[file][name].evm.bytecode.object) throw new Error('Build mismatch');
  const tx = await rpc(chainId, 'eth_getTransactionByHash', [hash]);
  const receipt = await rpc(chainId, 'eth_getTransactionReceipt', [hash]);
  if (tx.to || Number(receipt.status) !== 1 || receipt.contractAddress.toLowerCase() !== address || !tx.input.startsWith('0x' + creation)) throw new Error('Deployment mismatch');
  const args = tx.input.slice(creation.length + 2), constructor = new Interface(artifact.abi).deploy;
  const decoded = AbiCoder.defaultAbiCoder().decode(constructor.inputs, '0x' + args);
  if (AbiCoder.defaultAbiCoder().encode(constructor.inputs, decoded).slice(2) !== args) throw new Error('Constructor encoding mismatch');
  const runtime = await rpc(chainId, 'eth_getCode', [address, 'latest']);
  const expected = artifact.evm.deployedBytecode.object.split(''), actual = runtime.slice(2).split('');
  const refs = Object.values(artifact.evm.deployedBytecode.immutableReferences ?? {}).flat();
  for (const ref of refs) { expected.fill('0', ref.start * 2, (ref.start + ref.length) * 2); actual.fill('0', ref.start * 2, (ref.start + ref.length) * 2); }
  if (expected.join('') !== actual.join('')) throw new Error('Runtime differs outside immutable slots');
  const dir = `research/verification/${assetId ? assetId + "-" : ""}${chainId}-${name}`; mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/standard-input.json`, JSON.stringify(input, null, 2) + '\n');
  writeFileSync(`${dir}/constructor-arguments.txt`, args + '\n');
  const info = { assetId, chainId, address, contractIdentifier: `${file}:${name}`, compilerVersion: solc.version().split('.Emscripten')[0], creationTransactionHash: hash, constructorArguments: args, constructorDecoded: Array.from(decoded, String), creationMatches: true, runtimeMatchesOutsideImmutableSlots: true, immutableSlotCount: refs.length, runtimeHash: keccak256(runtime), sourceCount: Object.keys(input.sources).length, directory: dir };
  manifest.targets.push(info); console.log(name, 'deployment and standalone compilation match;', info.sourceCount, 'source files');
}
writeFileSync(v2 ? 'research/verification/real-v2-manifest.json' : real ? 'research/verification/real-manifest.json' : 'research/verification/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
