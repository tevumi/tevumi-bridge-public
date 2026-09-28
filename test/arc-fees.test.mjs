import assert from 'node:assert/strict';
import {test} from 'node:test';
import {arcFeeParams} from '../web/immediate-deploy/arc-fees.js';

test('Arc zero priority-fee quote reaches wallet with valid EIP-1559 fields', () => {
  assert.deepEqual(arcFeeParams('0x4a817c800', '0x4a817c800', '0x0'), {
    maximumPrice: 40_000_000_001n,
    maxPriorityFeePerGas: '0x1',
    maxFeePerGas: '0x9502f9001',
  });
});

test('Arc still rejects an insufficient maximum-fee quote', () => {
  assert.throws(() => arcFeeParams(50_000_000_000n, 20_000_000_000n, 0n), /Arc 费率报价异常/);
});
