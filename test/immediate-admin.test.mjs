import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { BrowserProvider, ContractFactory, zeroPadValue } from 'ethers';
import { compile } from '../scripts/compile.mjs';

let build;
const connections = [];
before(() => { build = compile(); });
after(async () => { await Promise.all(connections.map(connection => connection.close())); });

test('development admin applies configuration immediately while apps remain paused', async () => {
  const local = await network.create('local'); connections.push(local);
  const provider = new BrowserProvider(local.provider, undefined, { cacheTimeout: -1 });
  const operator = await provider.getSigner(0), outsider = await provider.getSigner(1);
  const deploy = async (name, args) => {
    const artifact = build[`contracts/production/${name}.sol`]?.[name] ?? Object.values(build).find(entry => entry[name])?.[name];
    const contract = await new ContractFactory(artifact.abi, '0x' + artifact.evm.bytecode.object, operator).deploy(...args);
    await contract.waitForDeployment(); return contract;
  };
  const admin = await deploy('ImmediateAdmin', [await operator.getAddress()]);
  const endpoint = await deploy('MockEndpoint', [30102]);
  const token = await deploy('PilotToken', [await operator.getAddress()]);
  const a = await deploy('ImmediateAdapter', [await token.getAddress(), await endpoint.getAddress(), await admin.getAddress(), await operator.getAddress(), 100n * 10n ** 12n, [1, 10, 100], [1, 10, 100]]);
  const o = await deploy('ImmediateOFT', ['Test', 'TEST', await token.getAddress(), await endpoint.getAddress(), await admin.getAddress(), await operator.getAddress(), [1, 10, 100], [1, 10, 100]]);
  for (const app of [a, o]) {
    assert.equal(await app.owner(), await admin.getAddress());
    assert.equal(await endpoint.delegates(await app.getAddress()), await admin.getAddress());
  }
  const targets = [await a.getAddress(), await o.getAddress()];
  const payloads = [a.interface.encodeFunctionData('setPeer', [30417, zeroPadValue(await o.getAddress(), 32)]), o.interface.encodeFunctionData('setPeer', [30102, zeroPadValue(await a.getAddress(), 32)])];
  await assert.rejects(admin.connect(outsider).executeBatch(targets, payloads));
  await assert.rejects(a.setPeer(30417, zeroPadValue(await o.getAddress(), 32)));
  await (await admin.executeBatch(targets, payloads)).wait();
  assert.equal(await a.peers(30417), zeroPadValue(await o.getAddress(), 32));
  assert.equal(await o.peers(30102), zeroPadValue(await a.getAddress(), 32));
  assert.equal(await a.depositsPaused(), true);
  assert.equal(await a.receivesPaused(), true);
  assert.equal(await o.sendsPaused(), true);
  assert.equal(await o.receivesPaused(), true);
  await assert.rejects(admin.executeBatch([await a.getAddress(), await a.getAddress()], [a.interface.encodeFunctionData('setPauses', [false, false]), '0xdeadbeef']));
  assert.equal(await a.depositsPaused(), true);
});
