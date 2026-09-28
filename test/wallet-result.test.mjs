import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classifyWalletSendError} from '../web/immediate-deploy/wallet-result.js';

test('BNB approval and send reject explicit wallet errors without an unknown broadcast', () => {
  assert.equal(classifyWalletSendError({code: -32603, data: {originalError: {code: 4001}}}), 'rejected');
  assert.equal(classifyWalletSendError({code: -32602, message: 'Invalid params'}), 'not_submitted');
  assert.equal(classifyWalletSendError({code: -32603, data: {message: 'insufficient funds for gas * price + value'}}), 'not_submitted');
});

test('both directions retain the replay guard when broadcast status is genuinely unknown', () => {
  assert.equal(classifyWalletSendError({code: -32603, message: 'Internal JSON-RPC error'}), 'unknown');
  assert.equal(classifyWalletSendError({code: -32000, message: 'already known'}), 'unknown');
});
