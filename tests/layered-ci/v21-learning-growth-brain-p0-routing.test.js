'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ROUTES, classifyWp0Route } = require('../../tools/layered-ci/wp0-routing');

const ROOT = path.resolve(__dirname, '..', '..');
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/wp0-routing-policy.json'), 'utf8'));

const V21_LEARNING_GROWTH_BRAIN_P0_BOOTSTRAP_PATHS = Object.freeze([
  'config/upstreams/v21-learning-growth-brain-p0.json',
  'runtime/learning-growth/promptfoo/generate_runtime_sbom.js',
  'runtime/learning-growth/promptfoo/package-lock.json',
  'runtime/learning-growth/promptfoo/package.json',
  'runtime/learning-growth/promptfoo/precomputed-provider.cjs',
  'runtime/learning-growth/promptfoo/promptfooconfig.yaml',
  'runtime/learning-growth/python/generate_runtime_sbom.py',
  'runtime/learning-growth/python/learning_entrypoint.py',
  'runtime/learning-growth/python/pyproject.toml',
  'runtime/learning-growth/python/uv.lock',
  'third_party/licenses/apscheduler-MIT.txt',
  'third_party/licenses/assistant-ui-MIT.txt',
  'third_party/licenses/assistant-ui-tool-ui-MIT.txt',
  'third_party/licenses/dspy-MIT.txt',
  'third_party/licenses/gepa-MIT.txt',
  'third_party/licenses/langfuse-MIT.txt',
  'third_party/licenses/langfuse-js-MIT.txt',
  'third_party/licenses/lucide-ISC-MIT.txt',
  'third_party/licenses/node-LICENSE.txt',
  'third_party/licenses/opentelemetry-js-Apache-2.0.txt',
  'third_party/licenses/opentelemetry-python-Apache-2.0.txt',
  'third_party/licenses/promptfoo-MIT.txt',
  'third_party/licenses/zod-MIT.txt',
  'upstream-patches/element-web/0002-yance-learning-assistant-ui-deps.patch'
]);

function canonicalPathSetSha256(paths) {
  const canonical = [...new Set(paths)].sort().join('\n') + '\n';
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

test('V2.1 Learning Growth Brain P0 bootstrap set is frozen exactly', () => {
  assert.equal(V21_LEARNING_GROWTH_BRAIN_P0_BOOTSTRAP_PATHS.length, 24);
  assert.equal(new Set(V21_LEARNING_GROWTH_BRAIN_P0_BOOTSTRAP_PATHS).size, 24);
  assert.equal(
    canonicalPathSetSha256(V21_LEARNING_GROWTH_BRAIN_P0_BOOTSTRAP_PATHS),
    'c8e7f2f77332eea0e264bcbf750d67aa8df67929ae0911638cf76dd5e93318e3'
  );
});

test('V2.1 Learning Growth Brain P0 bootstrap paths are exact PRODUCT_WP0 routes', () => {
  for (const file of V21_LEARNING_GROWTH_BRAIN_P0_BOOTSTRAP_PATHS) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, true, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.route, ROUTES.PRODUCT, file);
    assert.equal(result.productChangesPresent, true, file);
    assert.equal(policy.productExactPaths.includes(file), true, file);
  }

  const aggregate = classifyWp0Route(policy, V21_LEARNING_GROWTH_BRAIN_P0_BOOTSTRAP_PATHS);
  assert.equal(aggregate.pass, true, JSON.stringify(aggregate));
  assert.equal(aggregate.route, ROUTES.PRODUCT);
  assert.equal(aggregate.productChangesPresent, true);
});

test('V2.1 Learning Growth Brain route bootstrap does not authorize broad product prefixes', () => {
  for (const prefix of ['config/', 'runtime/', 'third_party/', 'upstream-patches/']) {
    assert.equal(policy.productPrefixes.includes(prefix), false, prefix);
  }
});

test('adjacent unregistered Learning OSS-like paths remain fail closed', () => {
  for (const file of [
    'config/upstreams/v21-learning-growth-brain-unapproved.json',
    'runtime/learning-growth/python/unapproved_engine.py',
    'runtime/learning-growth/promptfoo/unapproved-provider.cjs',
    'runtime/langfuse/unapproved_server.js',
    'third_party/licenses/langfuse-enterprise-unapproved.txt',
    'upstream-patches/element-web/9999-unapproved-learning.patch'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, false, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH', file);
    assert.equal(result.route, null, file);
  }

  const malformed = classifyWp0Route(policy, ['../runtime/learning-growth/python/learning_entrypoint.py']);
  assert.equal(malformed.pass, false, JSON.stringify(malformed));
  assert.equal(malformed.reasonCode, 'WP0_ROUTE_PATH_INVALID');
});

test('V2.1 Learning Growth Brain route bootstrap preserves governance and product-documentation precedence', () => {
  const learning = V21_LEARNING_GROWTH_BRAIN_P0_BOOTSTRAP_PATHS[0];
  const governancePath = 'governance/layered-ci/risk-policy.json';
  const documentationPath = 'docs/superpowers/plans/2026-08-09-learning-growth-brain-route-bootstrap.md';

  const governance = classifyWp0Route(policy, [governancePath]);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.route, ROUTES.GOVERNANCE);

  const documentation = classifyWp0Route(policy, [documentationPath]);
  assert.equal(documentation.pass, true, JSON.stringify(documentation));
  assert.equal(documentation.route, ROUTES.PRODUCT_DOCUMENTATION);

  for (const files of [
    [learning, governancePath],
    [learning, documentationPath],
    [governancePath, documentationPath]
  ]) {
    const mixed = classifyWp0Route(policy, files);
    assert.equal(mixed.pass, true, JSON.stringify(files));
    assert.equal(mixed.route, ROUTES.PRODUCT, JSON.stringify(files));
    assert.equal(mixed.productChangesPresent, true, JSON.stringify(files));
  }
});
