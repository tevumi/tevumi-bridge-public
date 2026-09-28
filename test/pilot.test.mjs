import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { BrowserProvider, ContractFactory, parseEther, zeroPadValue, ZeroHash } from 'ethers';
import { compile } from '../scripts/compile.mjs';

let build;
const connections = [];
before(() => { build = compile(); });
after(async () => { await Promise.all(connections.map(c => c.close())); });
async function fixture(tokenName = 'PilotToken') {
  const connection = await network.create('local');
  connections.push(connection);
  // Automined state changes immediately; disable ethers' short RPC cache.
  const provider = new BrowserProvider(connection.provider, undefined, { cacheTimeout: -1 });
  const admin = await provider.getSigner(0), outsider = await provider.getSigner(1);
  const who = await admin.getAddress();
  const deploy = async (name, args) => {
    const artifact = Object.values(build).find(file => file[name])?.[name];
    const c = await new ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, admin).deploy(...args);
    await c.waitForDeployment();
    return c;
  };
  const bsc = await deploy('MockEndpoint', [30102]);
  const arc = await deploy('MockEndpoint', [30417]);
  const token = await deploy(tokenName, [who]);
  const adapter = await deploy('PilotAdapter', [await token.getAddress(), await bsc.getAddress(), who, who, 30417, parseEther('1'), parseEther('2')]);
  const oft = await deploy('PilotOFT', [await arc.getAddress(), who, who, 30102, parseEther('1'), parseEther('2')]);
  await (await adapter.setPeer(30417, zeroPadValue(await oft.getAddress(), 32))).wait();
  await (await oft.setPeer(30102, zeroPadValue(await adapter.getAddress(), 32))).wait();
  await (await token.approve(await adapter.getAddress(), parseEther('1000'))).wait();
  const params = (amount = parseEther('1'), dst = 30417) => [dst, zeroPadValue(who, 32), amount, amount, '0x', '0x', '0x'];
  const send = async (contract = adapter, p = params()) => {
    const receipt = await (await contract.send(p, [0, 0], who)).wait();
    const endpoint = contract === adapter ? bsc : arc;
    return receipt.logs.map(l => { try { return endpoint.interface.parseLog(l); } catch { return null; } }).find(e => e?.name === 'Packet').args;
  };
  const deliver = async (packet, returning = false) => {
    const ep = returning ? bsc : arc, target = returning ? adapter : oft;
    return (await ep.deliver(await target.getAddress(), [returning ? 30417 : 30102, zeroPadValue(packet.sender, 32), packet.nonce], packet.guid, packet.message)).wait();
  };
  return { provider, admin, outsider, who, deploy, bsc, arc, token, adapter, oft, params, send, deliver };
}

test('round trip preserves collateral and supply; pausing new deposits does not block redemption', async () => {
  const f = await fixture();
  const initial = await f.token.balanceOf(f.who);
  assert.equal(await f.oft.totalSupply(), 0n);
  const outbound = await f.send();
  assert.equal(await f.token.balanceOf(await f.adapter.getAddress()), parseEther('1'));
  assert.equal(await f.oft.totalSupply(), 0n, 'source success is not destination success');
  await f.deliver(outbound);
  assert.equal(await f.oft.balanceOf(f.who), parseEther('1'));
  await (await f.adapter.setDepositsPaused(true)).wait();
  await assert.rejects(f.adapter.send(f.params(), [0, 0], f.who));
  const returning = await f.send(f.oft, f.params(parseEther('1'), 30102));
  assert.equal(await f.oft.totalSupply(), 0n);
  await f.deliver(returning, true);
  assert.equal(await f.token.balanceOf(f.who), initial);
  assert.equal(await f.token.balanceOf(await f.adapter.getAddress()), 0n);
});

test('unauthorized sender/recipient, wrong route, payload, zero and dust are rejected before locking', async () => {
  const f = await fixture();
  await assert.rejects(f.adapter.connect(f.outsider).send(f.params(), [0, 0], f.who));
  for (const p of [
    f.params(0n), f.params(1n), f.params(parseEther('1') + 1n), f.params(parseEther('1'), 999),
    f.params().with(1, zeroPadValue(await f.outsider.getAddress(), 32)),
    f.params().with(5, '0x01'), f.params().with(6, '0x01'),
    f.params().with(3, parseEther('2')),
  ]) await assert.rejects(f.adapter.send(p, [0, 0], f.who));
  assert.equal(await f.adapter.totalSent(), 0n);
  assert.equal(await f.token.balanceOf(await f.adapter.getAddress()), 0n);
});

test('single and cumulative caps cannot be bypassed by repeated sends', async () => {
  const f = await fixture();
  await assert.rejects(f.adapter.send(f.params(parseEther('2')), [0, 0], f.who));
  await f.send(); await f.send();
  await assert.rejects(f.adapter.send(f.params(), [0, 0], f.who));
  assert.equal(await f.adapter.totalSent(), parseEther('2'));
});

test('failed source message submission rolls back token movement and allowance consumption', async () => {
  const f = await fixture();
  const allowance = await f.token.allowance(f.who, await f.adapter.getAddress());
  await (await f.bsc.setFailSend(true)).wait();
  await assert.rejects(f.adapter.send(f.params(), [0, 0], f.who));
  assert.equal(await f.adapter.totalSent(), 0n);
  assert.equal(await f.token.balanceOf(await f.adapter.getAddress()), 0n);
  assert.equal(await f.token.allowance(f.who, await f.adapter.getAddress()), allowance);
});

test('direct receiver calls and wrong peer are rejected; mock delivery can retry without duplicate credit', async () => {
  const f = await fixture();
  const p = await f.send();
  const origin = [30102, zeroPadValue(p.sender, 32), p.nonce];
  await assert.rejects(f.oft.lzReceive(origin, p.guid, p.message, f.who, '0x'));
  await assert.rejects(f.arc.deliver(await f.oft.getAddress(), [30102, ZeroHash, p.nonce], p.guid, p.message));
  assert.equal(await f.arc.delivered(p.guid), false, 'failed delivery is retryable');
  await f.deliver(p);
  await assert.rejects(f.deliver(p));
  assert.equal(await f.oft.totalSupply(), parseEther('1'));
});

test('administrator-only methods reject outsiders; contracts have no public mint or collateral rescue', async () => {
  const f = await fixture();
  await assert.rejects(f.adapter.connect(f.outsider).setDepositsPaused(true));
  await assert.rejects(f.oft.connect(f.outsider).setPeer(30102, ZeroHash));
  await assert.rejects(f.oft.connect(f.outsider).setDelegate(await f.outsider.getAddress()));
  for (const c of [f.token, f.adapter, f.oft]) {
    assert.equal(c.interface.getFunction('mint'), null);
    assert.equal(c.interface.getFunction('rescue'), null);
  }
});

test('fee-on-transfer collateral is rejected without leaving locked balances', async () => {
  const f = await fixture('TaxToken');
  await (await f.token.setTax(true)).wait();
  await assert.rejects(f.adapter.send(f.params(), [0, 0], f.who));
  assert.equal(await f.adapter.totalSent(), 0n);
  assert.equal(await f.token.balanceOf(await f.adapter.getAddress()), 0n);
});

test('a failing taxed redemption can be retried after token behavior is repaired', async () => {
  const f = await fixture('TaxToken');
  await f.deliver(await f.send());
  const returning = await f.send(f.oft, f.params(parseEther('1'), 30102));
  await (await f.token.setTax(true)).wait();
  await assert.rejects(f.deliver(returning, true));
  assert.equal(await f.bsc.delivered(returning.guid), false);
  await (await f.token.setTax(false)).wait();
  await f.deliver(returning, true);
  assert.equal(await f.token.balanceOf(f.who), parseEther('1000'));
});
