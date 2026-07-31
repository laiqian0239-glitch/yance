'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const releaseSource = require('../../release/release-source.json');

test('WhatsApp browser identity is derived from release identity instead of a stale hard-coded version', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../backend/services/whatsappAdapter.js'), 'utf8');
  assert.doesNotMatch(source, /29\.2\.2/);
  assert.match(source, /browser:\s*whatsappBrowserIdentity\(\)/);
  assert.match(source, /releaseSource\.publicVersion/);
  assert.match(source, /identity\.publicProductName/);
  assert.equal(releaseSource.productVersion, '29.2.7');
  assert.equal(releaseSource.publicProductName, '言策');
  assert.equal(releaseSource.publicVersion, '1.0.0');
});
