'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkUnsignedModePolicy } = require('../../tools/wp0/lib');

test('unsigned-mode-policy.test', () => {
  const result = checkUnsignedModePolicy();
  assert.equal(result.pass, true, JSON.stringify(result));
});
