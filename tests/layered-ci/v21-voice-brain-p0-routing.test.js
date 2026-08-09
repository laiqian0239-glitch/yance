'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ROUTES, classifyWp0Route } = require('../../tools/layered-ci/wp0-routing');
const { validateDelegatedRoutePolicyMutation } = require('../../shared/release/implementationBranchPolicy');

const ROOT = path.resolve(__dirname, '..', '..');
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/wp0-routing-policy.json'), 'utf8'));
const authorization = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/v21-voice-brain-p0-route-bootstrap-v2-authorization.json'), 'utf8'));

const VOICE_PATHS = Object.freeze([
  'config/upstreams/v21-voice-brain-p0.json',
  'runtime/voice-brain/cosyvoice/generate_runtime_sbom.py',
  'runtime/voice-brain/cosyvoice/pyproject.toml',
  'runtime/voice-brain/cosyvoice/uv.lock',
  'runtime/voice-brain/cosyvoice/yance_cosyvoice_entrypoint.py',
  'runtime/voice-brain/sensevoice/runtime-manifest.json',
  'third_party/licenses/cosyvoice-Apache-2.0.txt',
  'third_party/licenses/cosyvoice3-model-Apache-2.0.txt',
  'third_party/licenses/funasr-model-license.txt',
  'third_party/licenses/onnxruntime-MIT.txt',
  'third_party/licenses/pytorch-BSD-3-Clause.txt',
  'third_party/licenses/sensevoice-MIT.txt'
]);
const DIGEST = '34360957294d3b9b178f533212bcf3e98b870cdd10c86961b812d899c241326a';

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function digest(paths) { return crypto.createHash('sha256').update([...new Set(paths)].sort().join('\n') + '\n').digest('hex'); }
function basePolicy() {
  const value = clone(policy);
  value.productExactPaths = value.productExactPaths.filter(file => !VOICE_PATHS.includes(file));
  return value;
}
function candidate(base = basePolicy()) {
  const value = clone(base);
  value.productExactPaths = [...new Set([...value.productExactPaths, ...VOICE_PATHS])].sort();
  return value;
}

test('Voice route bootstrap path set is frozen', () => {
  assert.equal(VOICE_PATHS.length, 12);
  assert.equal(new Set(VOICE_PATHS).size, 12);
  assert.equal(digest(VOICE_PATHS), DIGEST);
  assert.deepEqual(authorization.bootstrapPaths, VOICE_PATHS);
  assert.equal(authorization.bootstrapPathCount, 12);
  assert.equal(authorization.bootstrapPathSetSha256, DIGEST);
});

test('Voice exact routes are causal RED before registration', () => {
  const failures = VOICE_PATHS.filter(file => {
    const result = classifyWp0Route(policy, [file]);
    return result.pass !== true
      || result.route !== ROUTES.PRODUCT
      || result.productChangesPresent !== true
      || !policy.productExactPaths.includes(file);
  });
  assert.deepEqual(failures, []);

  const aggregate = classifyWp0Route(policy, VOICE_PATHS);
  assert.equal(aggregate.pass, true, JSON.stringify(aggregate));
  assert.equal(aggregate.route, ROUTES.PRODUCT);
  assert.equal(aggregate.productChangesPresent, true);
});

test('Voice adjacent paths remain fail closed without broad prefixes', () => {
  for (const prefix of ['config/', 'runtime/', 'third_party/']) {
    assert.equal(policy.productPrefixes.includes(prefix), false, prefix);
  }

  for (const file of [
    'config/upstreams/v21-voice-brain-p1.json',
    'runtime/voice-brain/cosyvoice/unapproved.py',
    'runtime/voice-brain/sensevoice/unapproved.json',
    'third_party/licenses/voice-unapproved.txt'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, false, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH', file);
    assert.equal(result.route, null, file);
  }

  const malformed = classifyWp0Route(policy, ['../runtime/voice-brain/sensevoice/runtime-manifest.json']);
  assert.equal(malformed.pass, false, JSON.stringify(malformed));
  assert.equal(malformed.reasonCode, 'WP0_ROUTE_PATH_INVALID');
});

test('Voice route bootstrap preserves governance and product-documentation precedence', () => {
  const governance = classifyWp0Route(policy, ['governance/layered-ci/risk-policy.json']);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.route, ROUTES.GOVERNANCE);

  const documentation = classifyWp0Route(policy, ['docs/superpowers/plans/2026-08-09-voice-route-bootstrap.md']);
  assert.equal(documentation.pass, true, JSON.stringify(documentation));
  assert.equal(documentation.route, ROUTES.PRODUCT_DOCUMENTATION);

  const mixed = classifyWp0Route(policy, [VOICE_PATHS[0], 'governance/layered-ci/risk-policy.json']);
  assert.equal(mixed.pass, true, JSON.stringify(mixed));
  assert.equal(mixed.route, ROUTES.PRODUCT);
});

test('Voice consumes the trusted route mutation guard', () => {
  assert.equal(typeof validateDelegatedRoutePolicyMutation, 'function');
  assert.equal(authorization.implementation.genericRouteMutationGuardRequired, true);
  const base = basePolicy();
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization, basePolicy: base, candidatePolicy: candidate(base) }).pass, true);

  const broad = candidate(base);
  broad.productPrefixes = [...broad.productPrefixes, 'runtime/'];
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization, basePolicy: base, candidatePolicy: broad }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const extra = candidate(base);
  extra.productExactPaths.push('runtime/voice-brain/extra.json');
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization, basePolicy: base, candidatePolicy: extra }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const removed = candidate(base);
  removed.productExactPaths = removed.productExactPaths.filter(file => file !== base.productExactPaths[0]);
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization, basePolicy: base, candidatePolicy: removed }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const weakened = candidate(base);
  weakened.unknownPathFailsClosed = false;
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization, basePolicy: base, candidatePolicy: weakened }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const governanceDrift = candidate(base);
  governanceDrift.governancePrefixes = [...governanceDrift.governancePrefixes, 'runtime/'];
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization, basePolicy: base, candidatePolicy: governanceDrift }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const documentationDrift = candidate(base);
  documentationDrift.productDocumentationExactPaths = [...(documentationDrift.productDocumentationExactPaths || []), 'runtime/voice-brain/README.md'];
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization, basePolicy: base, candidatePolicy: documentationDrift }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');
});
