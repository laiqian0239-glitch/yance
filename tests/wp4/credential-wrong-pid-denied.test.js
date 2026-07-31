'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCredentialForStartup } = require('../../backend/bootstrap/credentialHydrationPipe');
const { frameFor, startup } = require('./helpers');
test('credential frame bound to another backend PID is denied', () => {
  const context = startup();
  assert.throws(() => validateCredentialForStartup(frameFor(context, { backendPid: context.backendPid + 1 }), context), error => error.reasonCode === 'CREDENTIAL_WRONG_BACKEND_PID');
});
