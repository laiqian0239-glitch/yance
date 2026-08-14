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

test('runtime SBOM generator is deterministic/offline-oriented and startup code does not install dependencies', () => {
  const sbom = readText('runtime/deep-training/agent-lightning/generate_runtime_sbom.py');
  assert.match(sbom, /CycloneDX|cyclonedx|bomFormat/u);
  assert.match(sbom, /1\.7/u);
  assert.doesNotMatch(sbom, /requests\.|urllib\.request|subprocess.*(?:pip|uv)/u);
});
