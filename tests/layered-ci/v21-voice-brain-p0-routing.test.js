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
const routeBootstrapV2Authorization = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/v21-voice-brain-p0-route-bootstrap-v2-authorization.json'), 'utf8'));
const routeBootstrapV4Authorization = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/v21-voice-brain-p0-route-bootstrap-v4-authorization.json'), 'utf8'));

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
const VOICE_DIGEST = '34360957294d3b9b178f533212bcf3e98b870cdd10c86961b812d899c241326a';
const VOICE_WORKSPACE_PATHS = Object.freeze([
  'integration/element-module/src/VoiceWorkspace.css',
  'integration/element-module/src/VoiceWorkspace.tsx'
]);
const VOICE_WORKSPACE_DIGEST = '736314fa2512aa0dfec9dc8fbec0ac9951a2565d8ad2539e15938d52442ba6b2';

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function digest(paths) { return crypto.createHash('sha256').update([...new Set(paths)].sort().join('\n') + '\n').digest('hex'); }
function v2BasePolicy() {
  const value = clone(policy);
  value.productExactPaths = value.productExactPaths.filter(file => !VOICE_PATHS.includes(file));
  return value;
}
function v2Candidate(base = v2BasePolicy()) {
  const value = clone(base);
  value.productExactPaths = [...new Set([...value.productExactPaths, ...VOICE_PATHS])].sort();
  return value;
}
function v4Candidate(base = clone(policy)) {
  const value = clone(base);
  value.productExactPaths = [...new Set([...value.productExactPaths, ...VOICE_WORKSPACE_PATHS])].sort();
  return value;
}

test('Voice route bootstrap V2 path set remains frozen', () => {
  assert.equal(VOICE_PATHS.length, 12);
  assert.equal(new Set(VOICE_PATHS).size, 12);
  assert.equal(digest(VOICE_PATHS), VOICE_DIGEST);
  assert.deepEqual(routeBootstrapV2Authorization.bootstrapPaths, VOICE_PATHS);
  assert.equal(routeBootstrapV2Authorization.bootstrapPathCount, 12);
  assert.equal(routeBootstrapV2Authorization.bootstrapPathSetSha256, VOICE_DIGEST);
});

test('Voice V2 exact routes remain registered as PRODUCT', () => {
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

test('Voice workspace route bootstrap V4 path set is frozen', () => {
  assert.equal(VOICE_WORKSPACE_PATHS.length, 2);
  assert.equal(new Set(VOICE_WORKSPACE_PATHS).size, 2);
  assert.equal(digest(VOICE_WORKSPACE_PATHS), VOICE_WORKSPACE_DIGEST);
  assert.deepEqual(routeBootstrapV4Authorization.bootstrapPaths, VOICE_WORKSPACE_PATHS);
  assert.equal(routeBootstrapV4Authorization.bootstrapPathCount, 2);
  assert.equal(routeBootstrapV4Authorization.bootstrapPathSetSha256, VOICE_WORKSPACE_DIGEST);
});

test('Voice workspace exact routes are causal RED before registration', () => {
  const failures = VOICE_WORKSPACE_PATHS.filter(file => {
    const result = classifyWp0Route(policy, [file]);
    return result.pass !== true
      || result.route !== ROUTES.PRODUCT
      || result.productChangesPresent !== true
      || !policy.productExactPaths.includes(file);
  });
  assert.deepEqual(failures, []);

  const aggregate = classifyWp0Route(policy, VOICE_WORKSPACE_PATHS);
  assert.equal(aggregate.pass, true, JSON.stringify(aggregate));
  assert.equal(aggregate.route, ROUTES.PRODUCT);
  assert.equal(aggregate.productChangesPresent, true);
});

test('Voice adjacent paths remain fail closed without broad prefixes', () => {
  for (const prefix of ['config/', 'runtime/', 'third_party/', 'integration/']) {
    assert.equal(policy.productPrefixes.includes(prefix), false, prefix);
  }

  for (const file of [
    'config/upstreams/v21-voice-brain-p1.json',
    'runtime/voice-brain/cosyvoice/unapproved.py',
    'runtime/voice-brain/sensevoice/unapproved.json',
    'third_party/licenses/voice-unapproved.txt',
    'integration/element-module/src/VoiceWorkspace.unapproved.tsx'
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

test('Voice V2 consumes the trusted route mutation guard unchanged', () => {
  assert.equal(typeof validateDelegatedRoutePolicyMutation, 'function');
  assert.equal(routeBootstrapV2Authorization.implementation.genericRouteMutationGuardRequired, true);
  const base = v2BasePolicy();
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization: routeBootstrapV2Authorization, basePolicy: base, candidatePolicy: v2Candidate(base) }).pass, true);

  const broad = v2Candidate(base);
  broad.productPrefixes = [...broad.productPrefixes, 'runtime/'];
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization: routeBootstrapV2Authorization, basePolicy: base, candidatePolicy: broad }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const extra = v2Candidate(base);
  extra.productExactPaths.push('runtime/voice-brain/extra.json');
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization: routeBootstrapV2Authorization, basePolicy: base, candidatePolicy: extra }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const removed = v2Candidate(base);
  removed.productExactPaths = removed.productExactPaths.filter(file => file !== base.productExactPaths[0]);
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization: routeBootstrapV2Authorization, basePolicy: base, candidatePolicy: removed }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const weakened = v2Candidate(base);
  weakened.unknownPathFailsClosed = false;
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization: routeBootstrapV2Authorization, basePolicy: base, candidatePolicy: weakened }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const governanceDrift = v2Candidate(base);
  governanceDrift.governancePrefixes = [...governanceDrift.governancePrefixes, 'runtime/'];
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization: routeBootstrapV2Authorization, basePolicy: base, candidatePolicy: governanceDrift }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const documentationDrift = v2Candidate(base);
  documentationDrift.productDocumentationExactPaths = [...(documentationDrift.productDocumentationExactPaths || []), 'runtime/voice-brain/README.md'];
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization: routeBootstrapV2Authorization, basePolicy: base, candidatePolicy: documentationDrift }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');
});

test('Voice V4 consumes the trusted route mutation guard for only the frozen workspace paths', () => {
  assert.equal(typeof validateDelegatedRoutePolicyMutation, 'function');
  assert.equal(routeBootstrapV4Authorization.implementation.genericRouteMutationGuardRequired, true);
  const base = clone(policy);
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization: routeBootstrapV4Authorization, basePolicy: base, candidatePolicy: v4Candidate(base) }).pass, true);

  const broad = v4Candidate(base);
  broad.productPrefixes = [...broad.productPrefixes, 'integration/'];
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization: routeBootstrapV4Authorization, basePolicy: base, candidatePolicy: broad }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const extra = v4Candidate(base);
  extra.productExactPaths.push('integration/element-module/src/VoiceWorkspace.unapproved.tsx');
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization: routeBootstrapV4Authorization, basePolicy: base, candidatePolicy: extra }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const removed = v4Candidate(base);
  removed.productExactPaths = removed.productExactPaths.filter(file => file !== base.productExactPaths[0]);
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization: routeBootstrapV4Authorization, basePolicy: base, candidatePolicy: removed }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const weakened = v4Candidate(base);
  weakened.unknownPathFailsClosed = false;
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization: routeBootstrapV4Authorization, basePolicy: base, candidatePolicy: weakened }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const governanceDrift = v4Candidate(base);
  governanceDrift.governancePrefixes = [...governanceDrift.governancePrefixes, 'integration/'];
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization: routeBootstrapV4Authorization, basePolicy: base, candidatePolicy: governanceDrift }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const documentationDrift = v4Candidate(base);
  documentationDrift.productDocumentationExactPaths = [...(documentationDrift.productDocumentationExactPaths || []), 'integration/element-module/src/VoiceWorkspace.md'];
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization: routeBootstrapV4Authorization, basePolicy: base, candidatePolicy: documentationDrift }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');
});
