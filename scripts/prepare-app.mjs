import { mkdirSync, writeFileSync } from 'node:fs';
import { keccak256 } from 'ethers';
import { compile } from './compile.mjs';
const compiled = compile();
const output = {};
for (const name of ['PilotToken', 'PilotAdapter', 'PilotOFT']) {
  const contract = compiled[`contracts/pilot/${name}.sol`][name];
  const bytecode = `0x${contract.evm.bytecode.object}`;
  output[name] = { abi: contract.abi, bytecode, bytecodeHash: keccak256(bytecode) };
}
mkdirSync('web/generated', { recursive: true });
writeFileSync('web/generated/contracts.json', JSON.stringify(output));
const real = {};
for (const name of ['RestrictedAssetAdapter', 'RestrictedAssetOFT', 'RestrictedAssetOFTV2']) {
  const contract = compiled[`contracts/assets/${name}.sol`][name];
  const bytecode = `0x${contract.evm.bytecode.object}`;
  real[name] = {abi:contract.abi, bytecode, bytecodeHash:keccak256(bytecode)};
}
writeFileSync('web/generated/real-contracts.json', JSON.stringify(real));
console.log('Prepared pilot and restricted real-asset artifacts; no secrets or mocks exported.');
