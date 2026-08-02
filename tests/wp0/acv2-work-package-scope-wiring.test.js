'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const verifyGatePath = path.join(__dirname, '..', '..', 'tools', 'wp0', 'verify-gate.js');

test('verify:wp0:gate enforces the exact ACV2 work-package changed-file scope', () => {
  const source = fs.readFileSync(verifyGatePath, 'utf8');
  assert.match(source, /evaluateAuthorizedWorkPackageScope/);
  assert.match(source, /loadWorkPackageAuthorization/);
  assert.match(source, /loadWorkPackageScopeAmendment/);
  assert.match(source, /ACV2_WP_A_PARENT_GOVERNANCE_HEAD/);
  assert.match(source, /diff[^\n]*--name-only/);
  assert.match(source, /workPackageScope/);
  assert.match(source, /ACV2_WORK_PACKAGE_SCOPE_/);
});
