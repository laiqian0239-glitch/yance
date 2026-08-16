'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ROUTES, classifyWp0Route } = require('../../tools/layered-ci/wp0-routing');

const ROOT = path.resolve(__dirname, '..', '..');
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/wp0-routing-policy.json'), 'utf8'));

const PRESENCE_BOOTSTRAP_PATHS = Object.freeze([
  'config/upstreams/v21-presence-avatar-p0.json',
  'integration/element-module/src/PresenceWorkspace.css',
  'integration/element-module/src/PresenceWorkspace.tsx',
  'integration/element-module/src/presenceLiveKit.ts',
  'runtime/presence-avatar/cyberverse/avatar_models/flash_head.yaml',
  'runtime/presence-avatar/cyberverse/cyberverse.yaml',
  'third_party/licenses/cyberverse-GPL-3.0.txt',
  'third_party/licenses/livekit-Apache-2.0.txt',
  'third_party/licenses/livekit-client-Apache-2.0.txt',
  'third_party/licenses/soulx-flashhead-Apache-2.0.txt',
  'upstream-patches/cyberverse/0001-yance-external-audio-ingress.patch',
  'upstream-patches/element-web/0010-yance-presence-livekit-client.patch'
]);

function canonicalPathSetSha256(paths) {
  return crypto.createHash('sha256').update([...new Set(paths)].sort().join('\n') + '\n', 'utf8').digest('hex');
}

test('Presence Avatar future bootstrap path set is frozen exactly', () => {
  assert.equal(PRESENCE_BOOTSTRAP_PATHS.length, 12);
  assert.equal(new Set(PRESENCE_BOOTSTRAP_PATHS).size, 12);
  assert.equal(
    canonicalPathSetSha256(PRESENCE_BOOTSTRAP_PATHS),
    '13ab2ef63e882402c27fad390ba185396ae2c52b809cefceb55bf926a7638d90'
  );
});

test('Presence Avatar future bootstrap paths are causal RED until exact PRODUCT_WP0 registration lands', () => {
  const failures = [];
  for (const file of PRESENCE_BOOTSTRAP_PATHS) {
    const result = classifyWp0Route(policy, [file]);
    if (result.pass !== true || result.route !== ROUTES.PRODUCT || result.productChangesPresent !== true || !policy.productExactPaths.includes(file)) {
      failures.push({ file, result, registered: policy.productExactPaths.includes(file) });
    }
  }
  assert.deepEqual(failures, [], `Presence exact routes not registered: ${JSON.stringify(failures)}`);

  const aggregate = classifyWp0Route(policy, PRESENCE_BOOTSTRAP_PATHS);
  assert.equal(aggregate.pass, true, JSON.stringify(aggregate));
  assert.equal(aggregate.route, ROUTES.PRODUCT);
  assert.equal(aggregate.productChangesPresent, true);
});

test('Presence route bootstrap never authorizes broad prefixes or adjacent lookalikes', () => {
  for (const prefix of ['config/', 'integration/', 'runtime/', 'third_party/', 'upstream-patches/']) {
    assert.equal(policy.productPrefixes.includes(prefix), false, prefix);
  }

  for (const file of [
    'config/upstreams/v21-presence-avatar-p1.json',
    'integration/element-module/src/PresenceWorkspaceUnapproved.tsx',
    'runtime/presence-avatar/unapproved/cyberverse.yaml',
    'third_party/licenses/livekit-enterprise-unapproved.txt',
    'upstream-patches/cyberverse/9999-unapproved.patch'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, false, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH', file);
    assert.equal(result.route, null, file);
  }

  const malformed = classifyWp0Route(policy, ['../runtime/presence-avatar/cyberverse/cyberverse.yaml']);
  assert.equal(malformed.pass, false, JSON.stringify(malformed));
  assert.equal(malformed.reasonCode, 'WP0_ROUTE_PATH_INVALID');
});

test('Presence route bootstrap preserves governance and product-documentation precedence', () => {
  const governance = classifyWp0Route(policy, ['governance/layered-ci/risk-policy.json']);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.route, ROUTES.GOVERNANCE);

  const documentation = classifyWp0Route(policy, ['docs/superpowers/plans/2026-08-09-presence-avatar-route-bootstrap.md']);
  assert.equal(documentation.pass, true, JSON.stringify(documentation));
  assert.equal(documentation.route, ROUTES.PRODUCT_DOCUMENTATION);

  const mixed = classifyWp0Route(policy, [PRESENCE_BOOTSTRAP_PATHS[0], 'governance/layered-ci/risk-policy.json']);
  assert.equal(mixed.pass, true, JSON.stringify(mixed));
  assert.equal(mixed.route, ROUTES.PRODUCT);
});
