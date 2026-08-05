'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/generate-oss1a-v11-uat-diagnostics-runtime-fix.yml');
const GENERATOR_PATH = path.join(ROOT, 'tools/generator/oss1a-v11-uat-diagnostics-runtime-fix.js');

const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');
const generator = fs.readFileSync(GENERATOR_PATH, 'utf8');

test('v11 candidate publication consumes an exact controlled seed and only fast-forwards runtime changes', () => {
  assert.match(workflow, /CANDIDATE_SEED_HEAD:\s+[0-9a-f]{40}/u);
  assert.match(workflow, /CANDIDATE_BRANCH:\s+candidate\/oss1a-v11-uat-diagnostics-green-v2/u);
  assert.match(workflow, /node --test --test-concurrency=1 tests\/oss1a\/v11CandidatePublicationContract\.test\.js/u);
  assert.match(workflow, /git fetch --no-tags origin "refs\/heads\/\$\{CANDIDATE_BRANCH\}:refs\/remotes\/origin\/\$\{CANDIDATE_BRANCH\}"/u);
  assert.match(workflow, /test "\$\{remote_candidate_head\}" = "\$\{CANDIDATE_SEED_HEAD\}"/u);
  assert.match(workflow, /git checkout --detach "\$\{CANDIDATE_SEED_HEAD\}"/u);
  assert.match(workflow, /node \/tmp\/oss1a-v11-uat-diagnostics-runtime-fix\.js --scope runtime/u);
  assert.doesNotMatch(workflow, /git merge --no-ff "\$\{GOVERNANCE_HEAD\}"/u);
  assert.match(workflow, /git push --verbose origin "HEAD:refs\/heads\/\$\{CANDIDATE_BRANCH\}"/u);
  assert.match(workflow, /test "\$\{published_head\}" = "\$\{candidate_head\}"/u);
  assert.doesNotMatch(workflow, /--force(?:-with-lease)?/u);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/u);
});

test('v11 generator separates workflow seeding from runtime candidate construction', () => {
  assert.match(generator, /const WORKFLOW_PATH = '\.github\/workflows\/oss1a-whatsapp-lifecycle\.yml';/u);
  assert.match(generator, /const RUNTIME_PATHS = Object\.freeze\(\[/u);
  assert.match(generator, /function applyWorkflowFix\(\)/u);
  assert.match(generator, /function applyRuntimeFix\(\)/u);
  assert.match(generator, /--scope/u);
  assert.match(generator, /scope === 'workflow'/u);
  assert.match(generator, /scope === 'runtime'/u);
});
