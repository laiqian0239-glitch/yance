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
  assert.equal(digest(VOICE_PATHS), DIGEST);
  assert.deepEqual(authorization.bootstrapPaths, VOICE_PATHS);
  assert.equal(authorization.bootstrapPathSetSha256, DIGEST);
});

test('Voice exact routes are causal RED before registration', () => {
  const failures = VOICE_PATHS.filter(file => {
    const result = classifyWp0Route(policy, [file]);
    return result.pass !== true || result.route !== ROUTES.PRODUCT || !policy.productExactPaths.includes(file);
  });
  assert.deepEqual(failures, []);
});

test('Voice adjacent paths remain fail closed', () => {
  for (const file of [
    'config/upstreams/v21-voice-brain-p1.json',
    'runtime/voice-brain/cosyvoice/unapproved.py',
    'runtime/voice-brain/sensevoice/unapproved.json',
    'third_party/licenses/voice-unapproved.txt'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, false, file);
    assert.equal(result.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH', file);
  }
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

  const weakened = candidate(base);
  weakened.unknownPathFailsClosed = false;
  assert.equal(validateDelegatedRoutePolicyMutation({ authorization, basePolicy: base, candidatePolicy: weakened }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');
});
