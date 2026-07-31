'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCredentialForStartup } = require('../../backend/bootstrap/credentialHydrationPipe');
const { frameFor, sha, startup } = require('./helpers');
test('credential frame for a different release manifest is denied', () => {
  const context = startup();
  assert.throws(() => validateCredentialForStartup(frameFor(context, { manifestSha256: sha('wrong') }), context), error => error.reasonCode === 'CREDENTIAL_WRONG_MANIFEST');
});
