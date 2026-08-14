'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function resolvePath(relativePath) {
  return path.join(ROOT, ...relativePath.split('/'));
}

function readText(relativePath) {
  const file = resolvePath(relativePath);
  assert.equal(fs.existsSync(file), true, `missing ${relativePath}`);
  return fs.readFileSync(file, 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function gitBlobSha1(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(header).update(bytes).digest('hex');
}

test('Agent Lightning v0.3.0 is adopted as the sealed source-module rather than reimplemented by Yance', () => {
  const upstream = readJson('config/upstreams/v21-agent-lightning-p1.json');
  assert.equal(upstream.schemaVersion, 1);
  assert.equal(upstream.repository, 'microsoft/agent-lightning');
  assert.equal(upstream.release, 'v0.3.0');
  assert.equal(upstream.commit, '3b5d733861cf313fc09821a23240bbdf3cb2ee5b');
  assert.equal(upstream.license, 'MIT');
  assert.equal(upstream.adoptionMode, 'source-module');
  assert.equal(upstream.initialAlgorithm, 'APO');
  assert.equal(upstream.candidateStatus, 'CANDIDATE_ONLY');
  assert.deepEqual(upstream.selectedApiSurface, [
    'APO',
    'Trainer',
    'TraceToMessages',
    'PromptTemplate',
    'prompt_rollout',
    'emit_reward',
    'find_final_reward',
    'get_active_tracer',
    'OtelTracer'
  ]);
});

test('Python dependency controls pin the exact Agent Lightning APO declaration, upstream lock bytes, and license evidence', () => {
  const pyproject = readText('runtime/deep-training/agent-lightning/pyproject.toml');
  const lockPath = resolvePath('runtime/deep-training/agent-lightning/uv.lock');
  const lockBytes = fs.readFileSync(lockPath);
  const license = readText('third_party/licenses/agent-lightning-MIT.txt');
  const notices = readText('THIRD_PARTY_NOTICES.md');

  assert.match(pyproject, /"agentlightning\[apo\]==0\.3\.0"/u);
  assert.equal(lockBytes.length, 12_891_147);
  assert.equal(gitBlobSha1(lockBytes), '5a98a2ac121b050b0a82f6ac8dc207577ce3af4e');
  assert.match(license, /MIT License/u);
  assert.match(notices, /Agent Lightning|agent-lightning/u);
});
