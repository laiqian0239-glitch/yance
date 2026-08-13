'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const json = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

function dep(pkg, name) {
  return pkg.dependencies?.[name] || pkg.devDependencies?.[name] || null;
}

test('Learning P0 pins the approved Node OSS dependencies exactly', () => {
  const root = json('package.json');
  assert.equal(dep(root, '@langfuse/client'), '5.10.0');
  assert.equal(dep(root, '@langfuse/tracing'), '5.10.0');
  assert.equal(dep(root, '@langfuse/otel'), '5.10.0');
  assert.equal(dep(root, '@openfeature/server-sdk'), '1.23.0');
  assert.equal(dep(root, '@openfeature/flagd-provider'), '0.16.0');
  assert.equal(dep(root, '@openfeature/flagd-core'), '4.0.0');
});

test('Learning P0 pins the approved Python and Promptfoo runtimes', () => {
  const pyprojectPath = path.join(ROOT, 'runtime/learning-growth/python/pyproject.toml');
  assert.equal(fs.existsSync(pyprojectPath), true, 'sealed Learning Python pyproject.toml must exist');
  const pyproject = fs.readFileSync(pyprojectPath, 'utf8');
  for (const token of ['dspy', 'gepa', 'apscheduler', 'presidio-analyzer', 'presidio-anonymizer', 'opentelemetry']) {
    assert.match(pyproject.toLowerCase(), new RegExp(token));
  }
  const promptfoo = json('runtime/learning-growth/promptfoo/package.json');
  assert.equal(dep(promptfoo, 'promptfoo'), '0.122.0');
});
