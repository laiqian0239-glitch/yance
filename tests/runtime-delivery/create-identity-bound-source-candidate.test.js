'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');

const { createSourceCandidate } = require('../../tools/runtime-delivery/create-identity-bound-source-candidate');
const { readZipTextEntry } = require('../../tools/runtime-delivery/identity-bound-source-archive');

function git(repo, args) {
  return String(execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })).trim();
}

function fixtureRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-source-candidate-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'fix6c-identity-repair', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Source Candidate Test']);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'source-candidate@test.invalid']);
  fs.writeFileSync(path.join(repo, 'app.txt'), 'base\n');
  fs.writeFileSync(path.join(repo, 'YANCE_SOURCE_CHECKPOINT.json'), '{"commit":"stale-batch37"}\n');
  fs.writeFileSync(path.join(repo, 'YANCE_ARTIFACT_DESCRIPTOR.json'), '{"artifactId":"stale-batch37"}\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'base']);
  fs.writeFileSync(path.join(repo, 'app.txt'), 'fix6c\n');
  execFileSync('git', ['-C', repo, 'add', 'app.txt']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'fix6c']);
  return { root, repo };
}

test('source candidate is generated only from clean HEAD and binds both identity documents to that HEAD', () => {
  const { root, repo } = fixtureRepository();
  const outputPath = path.join(root, 'Yance_FIX6C_Source.zip');
  const result = createSourceCandidate({
    repoRoot: repo,
    outputPath,
    artifactClass: 'FIX6C_WINDOWS_UI_SOURCE_CANDIDATE',
    artifactId: 'yance-batch40-fix6c-ui-repair',
  });

  assert.equal(result.identity.commit, git(repo, ['rev-parse', 'HEAD']));
  assert.equal(result.identity.tree, git(repo, ['rev-parse', 'HEAD^{tree}']));
  assert.equal(result.identity.parent, git(repo, ['rev-parse', 'HEAD^']));
  assert.equal(result.sha256.length, 64);
  const checkpoint = JSON.parse(readZipTextEntry(outputPath, 'YANCE_SOURCE_CHECKPOINT.json'));
  const descriptor = JSON.parse(readZipTextEntry(outputPath, 'YANCE_ARTIFACT_DESCRIPTOR.json'));
  assert.equal(checkpoint.commit, result.identity.commit);
  assert.equal(checkpoint.tree, result.identity.tree);
  assert.equal(descriptor.sourceIdentity.commit, result.identity.commit);
  assert.equal(descriptor.sourceIdentity.tree, result.identity.tree);
  assert.equal(descriptor.artifactId, 'yance-batch40-fix6c-ui-repair');
  assert.equal(descriptor.governance.windowsUiUat, false);

  const fullOutputPath = path.join(root, 'Yance_FIX6C_Full_Acceptance_Source.zip');
  const script = path.resolve(__dirname, '../../tools/runtime-delivery/create-identity-bound-source-candidate.js');
  execFileSync(process.execPath, [
    script,
    repo,
    fullOutputPath,
    'FIX6C_WINDOWS_FULL_ACCEPTANCE_SOURCE_CANDIDATE_R2',
    'yance-batch40-fix6c-full-acceptance-r2',
    'WINDOWS_FULL_ACCEPTANCE_SOURCE_CANDIDATE',
  ]);
  const fullDescriptor = JSON.parse(readZipTextEntry(fullOutputPath, 'YANCE_ARTIFACT_DESCRIPTOR.json'));
  assert.equal(fullDescriptor.artifactType, 'WINDOWS_FULL_ACCEPTANCE_SOURCE_CANDIDATE');
  assert.equal(fullDescriptor.artifactClass, 'FIX6C_WINDOWS_FULL_ACCEPTANCE_SOURCE_CANDIDATE_R2');
});

test('source candidate generation rejects a dirty working tree instead of packaging uncommitted content', () => {
  const { root, repo } = fixtureRepository();
  fs.writeFileSync(path.join(repo, 'uncommitted.txt'), 'dirty\n');
  assert.throws(
    () => createSourceCandidate({
      repoRoot: repo,
      outputPath: path.join(root, 'dirty.zip'),
      artifactClass: 'FIX6C_WINDOWS_UI_SOURCE_CANDIDATE',
      artifactId: 'dirty-candidate',
    }),
    /working tree must be clean/u,
  );
});
