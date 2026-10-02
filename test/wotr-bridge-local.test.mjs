import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {network} from 'hardhat';
import {BrowserProvider, ContractFactory, parseUnits, zeroPadValue} from 'ethers';
import {compile} from '../scripts/compile.mjs';

const connections = [];
let build;
before(() => { build = compile(); });
after(async () => { await Promise.all(connections.map(connection => connection.close())); });

test('WOTR roles stay separate and repeated full-supply round trips have no practical bridge quota', async () => {
  const sides = [];
  for (const eid of [30102, 30417]) {
    const local = await network.create('local');
    connections.push(local);
    const provider = new BrowserProvider(local.provider, undefined, {cacheTimeout: -1});
    const bridgeAdmin = await provider.getSigner(0);
    const community = await provider.getSigner(1);
    const tester = await provider.getSigner(2);
    const deploy = async (name, args) => {
      const artifact = Object.values(build).find(source => source[name])?.[name];
      assert.ok(artifact, `missing ${name} artifact`);
      const contract = await new ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, bridgeAdmin).deploy(...args);
      await contract.waitForDeployment();
      return contract;
    };
    sides.push({provider, bridgeAdmin, community, tester, deploy, endpoint: await deploy('MockEndpoint', [eid])});
  }

  const [bnb, arc] = sides;
  const adminAddress = await bnb.bridgeAdmin.getAddress();
  const communityAddress = await bnb.community.getAddress();
  const testerAddress = await bnb.tester.getAddress();
  const token = await bnb.deploy('CommunityDemoToken', [communityAddress]);
  const tokenAddress = await token.getAddress();
  // Single operation equals the complete fixed supply; bucket ceilings exceed it many times.
  const limit = [1_000_000_000_000n, 18_446_744_073_709_551_614n, 18_446_744_073_709_551_615n];
  const adapter = await bnb.deploy('ProductionAdapterHarness', [
    tokenAddress, await bnb.endpoint.getAddress(), adminAddress, parseUnits('1000000', 18),
    limit, limit,
  ]);
  const oft = await arc.deploy('ProductionOFTHarness', [
    'Wobble Otter', 'WOTR', tokenAddress, await arc.endpoint.getAddress(), adminAddress,
    limit, limit,
  ]);
  const adapterAddress = await adapter.getAddress();
  const oftAddress = await oft.getAddress();
  const purchasedAmount = parseUnits('997.492218107793489136', 18);
  const bridgeAmount = parseUnits('900', 18);

  assert.equal(await token.totalSupply(), parseUnits('1000000', 18));
  assert.equal(await token.balanceOf(communityAddress), await token.totalSupply());
  assert.equal(await token.balanceOf(adminAddress), 0n);
  assert.equal(await token.allowance(communityAddress, adapterAddress), 0n);
  assert.equal(await adapter.owner(), adminAddress);
  assert.equal(await oft.owner(), adminAddress);
  assert.equal(await oft.totalSupply(), 0n);
  assert.equal(await oft.sourceToken(), tokenAddress);
  assert.equal(token.interface.fragments.some(fragment => fragment.type === 'function' && fragment.name === 'mint'), false);
  assert.equal(oft.interface.fragments.some(fragment => fragment.type === 'function' && fragment.name === 'mint'), false);
  await assert.rejects(token.connect(bnb.bridgeAdmin).transferFrom(communityAddress, adminAddress, 1n));

  // Reproduce the already-verified purchase amount on isolated chains; no mainnet funds move.
  await (await token.connect(bnb.community).transfer(testerAddress, purchasedAmount)).wait();
  const communityBalance = await token.balanceOf(communityAddress);
  await (await adapter.setPeer(30417, zeroPadValue(oftAddress, 32))).wait();
  await (await oft.setPeer(30102, zeroPadValue(adapterAddress, 32))).wait();
  await (await adapter.setPauses(false, false)).wait();
  await (await oft.setPauses(false, false)).wait();
  await (await token.connect(bnb.tester).approve(adapterAddress, bridgeAmount)).wait();

  const sendParam = (eid, amount) => [eid, zeroPadValue(testerAddress, 32), amount, amount, '0x', '0x', '0x'];
  const packetFrom = (receipt, endpoint) => receipt.logs
    .map(log => { try { return endpoint.interface.parseLog(log); } catch { return null; } })
    .find(event => event?.name === 'Packet')?.args;
  const outward = packetFrom(await (await adapter.connect(bnb.tester)
    .send(sendParam(30417, bridgeAmount), [0, 0], testerAddress)).wait(), bnb.endpoint);
  assert.ok(outward);
  assert.equal(await token.balanceOf(testerAddress), purchasedAmount - bridgeAmount);
  assert.equal(await token.balanceOf(adapterAddress), bridgeAmount);
  assert.equal(await adapter.principalLD(), bridgeAmount);
  assert.equal(await token.allowance(testerAddress, adapterAddress), 0n);
  assert.equal(await token.balanceOf(communityAddress), communityBalance);
  assert.equal(await oft.totalSupply(), 0n);

  await (await arc.endpoint.deliver(oftAddress, [30102, zeroPadValue(adapterAddress, 32), outward.nonce], outward.guid, outward.message)).wait();
  assert.equal(await oft.balanceOf(testerAddress), bridgeAmount);
  assert.equal(await oft.totalSupply(), bridgeAmount);
  assert.equal(await adapter.principalLD(), await oft.totalSupply());
  await assert.rejects(oft.connect(arc.tester).setPauses(true, true));

  const returning = packetFrom(await (await oft.connect(arc.tester)
    .send(sendParam(30102, bridgeAmount), [0, 0], testerAddress)).wait(), arc.endpoint);
  assert.ok(returning);
  assert.equal(await oft.totalSupply(), 0n);
  await (await adapter.setPauses(true, false)).wait();
  await (await bnb.endpoint.deliver(adapterAddress, [30417, zeroPadValue(oftAddress, 32), returning.nonce], returning.guid, returning.message)).wait();
  assert.equal(await token.balanceOf(testerAddress), purchasedAmount);
  assert.equal(await token.balanceOf(communityAddress), communityBalance);
  assert.equal(await token.balanceOf(adapterAddress), 0n);
  assert.equal(await adapter.principalLD(), 0n);
  assert.equal(await oft.totalSupply(), 0n);
  await assert.rejects(bnb.endpoint.deliver(adapterAddress, [30417, zeroPadValue(oftAddress, 32), returning.nonce], returning.guid, returning.message));

  // Entire immutable supply can move twice without an artificial single or frequency ceiling.
  await (await token.connect(bnb.community).transfer(testerAddress, communityBalance)).wait();
  const wholeSupply = await token.totalSupply();
  assert.equal(await token.balanceOf(testerAddress), wholeSupply);
  await (await adapter.setPauses(false, false)).wait();
  for (let round = 0; round < 2; round++) {
    await (await token.connect(bnb.tester).approve(adapterAddress, wholeSupply)).wait();
    const sent = packetFrom(await (await adapter.connect(bnb.tester)
      .send(sendParam(30417, wholeSupply), [0, 0], testerAddress)).wait(), bnb.endpoint);
    await (await arc.endpoint.deliver(oftAddress, [30102, zeroPadValue(adapterAddress, 32), sent.nonce], sent.guid, sent.message)).wait();
    assert.equal(await adapter.principalLD(), wholeSupply);
    assert.equal(await oft.totalSupply(), wholeSupply);
    const back = packetFrom(await (await oft.connect(arc.tester)
      .send(sendParam(30102, wholeSupply), [0, 0], testerAddress)).wait(), arc.endpoint);
    await (await bnb.endpoint.deliver(adapterAddress, [30417, zeroPadValue(oftAddress, 32), back.nonce], back.guid, back.message)).wait();
    assert.equal(await token.balanceOf(testerAddress), wholeSupply);
    assert.equal(await adapter.principalLD(), 0n);
    assert.equal(await oft.totalSupply(), 0n);
  }
});
