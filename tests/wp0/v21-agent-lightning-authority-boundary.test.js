'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const AUTH_PATH = 'governance/layered-ci/v21-deep-training-p1-agent-lightning-product-v1-authorization.json';
const ADAPTER_PATH = 'backend/services/agentLightningTrainingAdapter.js';

function readText(relativePath) {
  const file = path.join(ROOT, ...relativePath.split('/'));
  assert.equal(fs.existsSync(file), true, `missing ${relativePath}`);
  return fs.readFileSync(file, 'utf8');
}

function pathDigest(paths) {
  const canonical = [...new Set(paths)].sort().join('\n') + '\n';
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

test('Agent Lightning P1 authorization freezes the fresh 19-path scope and seven-test causal RED', () => {
  const authorization = JSON.parse(readText(AUTH_PATH));
  assert.equal(authorization.workPackage, 'V21-DEEP-TRAINING-P1-AGENT-LIGHTNING-PRODUCT-V1');
  assert.equal(authorization.implementation.branch, 'product/v21-deep-training-p1-agent-lightning');
  assert.equal(authorization.implementation.approvedChangedFileCount, 19);
  assert.equal(pathDigest(authorization.implementation.allowedChangedPaths), authorization.implementation.approvedChangedFileSetSha256);
  assert.equal(authorization.implementation.failureFirstCommit.freshCausalRedRequired, true);
  assert.equal(authorization.implementation.failureFirstCommit.approvedChangedFileCount, 7);
  assert.equal(pathDigest(authorization.implementation.failureFirstCommit.allowedChangedPaths), authorization.implementation.failureFirstCommit.approvedChangedFileSetSha256);
});

test('Agent Lightning adapter preserves Learning and Model Brain as the only semantic/provider authorities', () => {
  const source = readText(ADAPTER_PATH);
  assert.match(source, /projectRelationship|projectGlobal/u);
  assert.match(source, /bindExperimentEvidence/u);
  assert.match(source, /executeModel/u);
  assert.match(source, /CANDIDATE_ONLY/u);
  assert.doesNotMatch(source, /process\.env\.(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|AZURE_OPENAI_API_KEY|OPENROUTER_API_KEY)/u);
  assert.doesNotMatch(source, /\bLLMProxy\b|litellm\.proxy/u);
  assert.doesNotMatch(source, /directProvider|providerFallback/u);
});
