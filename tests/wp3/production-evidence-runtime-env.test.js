'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('WP3 production evidence starts from runtime authority and never injects retired YANCE_SAFE_MODE', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../tools/wp3/production-api-v2-runtime.js'), 'utf8');
  assert.equal(source.includes('YANCE_SAFE_MODE'), false);
  assert.match(source, /YANCE_DATA_DIR:\s*dataRoot/);
  assert.match(source, /YANCE_WP2_PRODUCTION_RUNTIME_PROBE:\s*'1'/);
  assert.match(source, /credentialFrameRequired:\s*true/, 'real production probe must send the mandatory FD5 hydration frame');
});
