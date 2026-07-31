'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCredentialForStartup, resetConsumedTokensForTests } = require('../../backend/bootstrap/credentialHydrationPipe');
const { frameFor, startup } = require('./helpers');
test('credential one-time token is accepted once and replay is denied', () => {
  process.env.YANCE_TEST_ONLY_CREDENTIAL_RESET = '1';
  resetConsumedTokensForTests();
  const context = startup();
  const frame = frameFor(context);
  assert.equal(validateCredentialForStartup(frame, context), frame);
  assert.throws(() => validateCredentialForStartup(frame, context), error => error.reasonCode === 'CREDENTIAL_TOKEN_REPLAY_DENIED');
  resetConsumedTokensForTests();
});
