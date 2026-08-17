'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const AGENTS_PATH = path.join(REPO_ROOT, 'AGENTS.md');

function protocol() {
  return fs.readFileSync(AGENTS_PATH, 'utf8');
}

test('repository agent protocol makes batch causal closure the mandatory fast-landing default', () => {
  const source = protocol();
  assert.match(source, /## Fast Landing Execution Mode \(mandatory\)/u);
  assert.match(source, /FAST_LANDING_DEFAULT=batch_causal_closure/u);
  assert.match(source, /MICRO_SCOPE_SERIALIZATION=forbidden_by_default/u);
  assert.match(source, /FULL_GATE_CADENCE=stable_batch_only/u);
  assert.match(source, /INDEPENDENT_BUCKETS=parallel_by_default/u);
  assert.match(source, /FINAL_CLOSURE_PREP=parallel_by_default/u);
});

test('fast-landing protocol preserves failure-first and authorization boundaries', () => {
  const source = protocol();
  assert.match(source, /same-root source graph/u);
  assert.match(source, /same-head causal RED/u);
  assert.match(source, /unknownBlockers = 0/u);
  assert.match(source, /authorization boundary/u);
  assert.match(source, /never means skipping failure-first, scope authorization, independent review, or final full gates/u);
});
