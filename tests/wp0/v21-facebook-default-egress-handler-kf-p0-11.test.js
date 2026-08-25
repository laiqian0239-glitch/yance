'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const platformAdapterPorts = require('../../backend/services/platformAdapterPorts');

test('KF-P0-11: default Facebook adapter owns an explicit physical egress handler', () => {
  const adapter = platformAdapterPorts.singleton.get('facebook');
  const contract = adapter.contract();

  assert.equal(typeof adapter.egressAuthorizer, 'function', 'persisted Outbox authorization must remain present');
  assert.equal(contract.bindings.egress, true, 'public adapter contract must continue to expose egress capability');
  assert.equal(
    typeof adapter.egressHandler,
    'function',
    'default Facebook egress must be explicitly bound to a physical handler instead of being implied by the authorizer and falling through to the generic fallback'
  );
});

test('KF-P0-11 preserve: Facebook Page official driver remains Chatwoot Matrix', () => {
  const registrySource = fs.readFileSync(
    path.resolve(__dirname, '../../backend/services/platformDriverRegistry.js'),
    'utf8'
  );

  assert.match(registrySource, /'facebook-page-official'\s*:\s*Object\.freeze\(\{/u);
  assert.match(registrySource, /'facebook-page-official'[\s\S]*?adapter:\s*facebookChatwoot/u);
  assert.match(registrySource, /return\s+'facebook-page-official'/u);
});
