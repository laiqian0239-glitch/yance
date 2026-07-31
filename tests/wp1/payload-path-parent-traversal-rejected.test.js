'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalizeRelativePayloadPath } = require('../../tools/wp1/lib');

test('parent-directory traversal payload paths are rejected', () => {
  assert.throws(() => canonicalizeRelativePayloadPath('backend/../secret.txt'), error => error.reasonCode === 'WP1_PAYLOAD_PARENT_TRAVERSAL_REJECTED');
});
