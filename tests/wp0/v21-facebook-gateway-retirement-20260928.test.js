'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('legacy Facebook gateway service is retired behind Chatwoot and mautrix-meta authorities', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'services/facebook-gateway')), false);
  const registry = read('backend/services/platformDriverRegistry.js');
  assert.match(registry, /'facebook-page-official'[\s\S]*adapter:\s*facebookChatwoot/u);
  assert.match(registry, /'facebook-personal-messenger-mautrix-meta'[\s\S]*protocolAuthority:\s*'mautrix-meta'/u);
  assert.doesNotMatch(registry, /facebook-gateway/u);
});
