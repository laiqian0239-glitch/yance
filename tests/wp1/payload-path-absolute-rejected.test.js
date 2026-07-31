'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalizeRelativePayloadPath } = require('../../tools/wp1/lib');

test('absolute, drive-letter, and UNC payload paths are rejected', () => {
  for (const candidate of ['/etc/passwd', 'C:\\temp\\app.js', '\\\\server\\share\\app.js']) {
    assert.throws(() => canonicalizeRelativePayloadPath(candidate), error => error.reasonCode === 'WP1_PAYLOAD_ABSOLUTE_PATH_REJECTED');
  }
});
