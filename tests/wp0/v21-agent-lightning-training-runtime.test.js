'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function readText(relativePath) {
  const file = path.join(ROOT, ...relativePath.split('/'));
  assert.equal(fs.existsSync(file), true, `missing ${relativePath}`);
  return fs.readFileSync(file, 'utf8');
}

test('sealed Python entrypoint uses upstream APO/Trainer/TraceToMessages/prompt_rollout/reward APIs', () => {
  const source = readText('runtime/deep-training/agent-lightning/agent_lightning_entrypoint.py');
  for (const symbol of ['APO', 'Trainer', 'TraceToMessages', 'prompt_rollout', 'emit_reward']) {
    assert.match(source, new RegExp(`\\b${symbol}\\b`, 'u'), `missing upstream Agent Lightning API ${symbol}`);
  }
  assert.match(source, /CANDIDATE_ONLY/u);
  assert.doesNotMatch(source, /\bLLMProxy\b|OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENROUTER_API_KEY/u);
  assert.doesNotMatch(source, /pip\s+install|uv\s+sync|git\s+clone/u);
});

test('shared-memory runtime keeps the algorithm on the main thread so upstream completion stops the runner fleet', () => {
  const source = readText('runtime/deep-training/agent-lightning/agent_lightning_entrypoint.py');
  assert.match(source, /strategy=\{\s*"type":\s*"shm",\s*"main_thread":\s*"algorithm"\s*\}/u);
  assert.doesNotMatch(source, /strategy=["']shm["']/u);
});

test('runtime SBOM generator is deterministic/offline-oriented and startup code does not install dependencies', () => {
  const sbom = readText('runtime/deep-training/agent-lightning/generate_runtime_sbom.py');
  assert.match(sbom, /CycloneDX|cyclonedx|bomFormat/u);
  assert.match(sbom, /1\.7/u);
  assert.doesNotMatch(sbom, /requests\.|urllib\.request|subprocess.*(?:pip|uv)/u);
});

test('Linux CI materializes exact upstream APO, runs landed Learning suites, and executes through Yance authority seams', () => {
  const workflow = readText('.github/workflows/v21-agent-lightning-p1-linux.yml');
  assert.match(workflow, /repository:\s*microsoft\/agent-lightning/u);
  assert.match(workflow, /ref:\s*3b5d733861cf313fc09821a23240bbdf3cb2ee5b/u);
  assert.match(workflow, /version:\s*['"]?0\.12\.3/u);
  assert.match(workflow, /uv sync [^\n]*--frozen --no-default-groups --extra apo --group core-stable/u);
  assert.match(workflow, /cmp -s [^\n]*uv\.lock [^\n]*uv\.lock/u);
  assert.match(workflow, /backend\/tests\/learningDeepTrainingContract\.test\.js/u);
  assert.match(workflow, /tests\/wp0\/v21-learning-deep-training-contract-closure\.test\.js/u);
  assert.match(workflow, /createAgentLightningTrainingAdapter/u);
  assert.match(workflow, /AGENT_LIGHTNING_PYTHON/u);
  assert.match(workflow, /modelBrainCompletionCount/u);
  assert.match(workflow, /CANDIDATE_ONLY/u);
});

test('Linux CI pins every external GitHub Action to an immutable commit SHA', () => {
  const workflow = readText('.github/workflows/v21-agent-lightning-p1-linux.yml');
  const actionUses = [...workflow.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#\s*(v\d+))?\s*$/gmu)]
    .map(match => ({ ref: match[1], versionComment: match[2] || null }));

  assert.equal(actionUses.length, 5, 'expected the five reviewed external action uses');
  for (const actionUse of actionUses) {
    assert.match(actionUse.ref, /^[^@\s]+@[0-9a-f]{40}$/u, `mutable GitHub Action reference: ${actionUse.ref}`);
    assert.match(actionUse.versionComment || '', /^v\d+$/u, `missing adjacent release-version comment: ${actionUse.ref}`);
  }
});