import solc from 'solc';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function compile() {
  const sources = {};
  function collect(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name).replaceAll('\\', '/');
      if (entry.isDirectory()) collect(path);
      else if (path.endsWith('.sol')) sources[path] = { content: readFileSync(path, 'utf8') };
    }
  }
  collect('contracts');
  const input = { language: 'Solidity', sources, settings: {
    optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'paris',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  } };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: path => {
    try { return { contents: readFileSync(join('node_modules', path), 'utf8') }; }
    catch { return { error: `Import not found: ${path}` }; }
  } }));
  const errors = (output.errors ?? []).filter(e => e.severity === 'error');
  if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/build.json', JSON.stringify({ compiler: solc.version(), input, output }, null, 2));
  return output.contracts;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const contracts = compile();
  console.log(`Compiled ${Object.keys(contracts).length} Solidity source units with ${solc.version()}`);
}
