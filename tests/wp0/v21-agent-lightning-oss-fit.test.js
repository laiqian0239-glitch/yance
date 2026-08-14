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

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
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
});

test('Python dependency controls pin Agent Lightning APO and license/notice evidence is present', () => {
  const pyproject = readText('runtime/deep-training/agent-lightning/pyproject.toml');
  const lock = readText('runtime/deep-training/agent-lightning/uv.lock');
  const license = readText('third_party/licenses/agent-lightning-MIT.txt');
  const notices = readText('THIRD_PARTY_NOTICES.md');
  assert.match(pyproject, /agentlightning/u);
  assert.match(pyproject, /0\.3\.0/u);
  assert.match(lock, /agentlightning/u);
  assert.match(lock, /0\.3\.0/u);
  assert.match(license, /MIT License/u);
  assert.match(notices, /Agent Lightning|agent-lightning/u);
});
