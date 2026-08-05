'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const workflowPath = path.resolve(__dirname, '..', '..', '.github', 'workflows', 'oss1a-baileys-lifecycle.yml');
const GOVERNANCE_BRANCHES = Object.freeze([
  'governance/oss-1a-detached-evidence-baseline-v3',
  'governance/oss-1a-pre-ready-fd6-authorization',
  'governance/oss-1a-event-batch-authorization',
  'governance/oss-1a-lifecycle-milestone-authorization',
  'governance/oss-1a-async-store-capability-authorization',
  'governance/oss-1a-canonical-projection-checkpoint-authorization',
  'governance/oss-1a-test-fixture-authorization',
  'governance/oss-1a-runtime-delivery-contract-authorization'
]);

function workflowText() {
  assert.equal(fs.existsSync(workflowPath), true, 'OSS-1A runtime workflow must exist');
  return fs.readFileSync(workflowPath, 'utf8');
}

test('OSS-1A workflow uses exact branch roles and never pull_request_target', () => {
  const workflow = workflowText();
  assert.match(workflow, /^name: OSS-1A Baileys Lifecycle$/mu);
  assert.match(workflow, /^on:\s*$/mu);
  assert.match(workflow, /^  pull_request:\s*$/mu);
  assert.doesNotMatch(workflow, /pull_request_target/u);
  assert.match(workflow, /governance\/oss-1a-implementation-authorization/u);
  assert.match(workflow, /governance\/oss-1a-runtime-ci-authorization/u);
  for (const branch of GOVERNANCE_BRANCHES) {
    assert.match(workflow, new RegExp(branch.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    assert.match(workflow, new RegExp(`refs/heads/${branch.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u'));
  }
  assert.match(workflow, /refs\/heads\/oss\/1a-baileys-lifecycle/u);
  assert.doesNotMatch(workflow, /oss\/\*/u);
  assert.doesNotMatch(workflow, /governance\/oss-1a-\*/u);
  assert.doesNotMatch(workflow, /continue-on-error/u);
});

test('runtime role executes the exact Schema 23 RED/GREEN command on the reviewed head', () => {
  const workflow = workflowText();
  assert.match(workflow, /name: oss1a-runtime-tests/u);
  assert.match(workflow, /github\.head_ref == 'oss\/1a-baileys-lifecycle'/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/oss\/1a-baileys-lifecycle'/u);
  assert.match(workflow, /ref: \$\{\{ env\.REVIEWED_HEAD_SHA \}\}/u);
  assert.match(workflow, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/u);
  assert.match(workflow, /actions\/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e/u);
  assert.match(workflow, /node-version: '22'/u);
  assert.match(workflow, /npm ci --ignore-scripts --no-audit --no-fund/u);
  assert.match(workflow, /node --test --test-concurrency=1 backend\/tests\/oss1aWhatsappAuthSchema\.test\.js/u);
});

test('governance roles validate the workflow contract without executing runtime tests', () => {
  const workflow = workflowText();
  assert.match(workflow, /name: oss1a-governance-contract/u);
  for (const branch of GOVERNANCE_BRANCHES) {
    assert.match(workflow, new RegExp(`github\\.head_ref == '${branch.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}'`, 'u'));
    assert.match(workflow, new RegExp(`github\\.ref == 'refs/heads/${branch.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}'`, 'u'));
  }
  assert.match(workflow, /node --test --test-concurrency=1 tests\/wp0\/oss1a-runtime-workflow\.test\.js/u);
});

test('aggregate job fails closed unless exactly the selected role succeeds', () => {
  const workflow = workflowText();
  assert.match(workflow, /name: oss1a-gates/u);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/u);
  assert.match(workflow, /RUNTIME_RESULT/u);
  assert.match(workflow, /GOVERNANCE_RESULT/u);
  assert.match(workflow, /unknown OSS-1A workflow branch role/u);
});
