'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REPO_ROOT,
  checkForbiddenHotfixEntrypoints,
  checkProtectedCommandPolicy,
  checkRepositoryScope
} = require('../../tools/wp0/lib');

test('forbidden-hotfix-entrypoints.test', () => {
  const result = checkForbiddenHotfixEntrypoints();
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.details.enumerationMethod, 'git ls-files -z');
});

test('local build package and release commands are guarded by executable WP0 gate', () => {
  const policy = checkProtectedCommandPolicy();
  assert.equal(policy.pass, true, JSON.stringify(policy));
  for (const command of ['build', 'package', 'release']) {
    const stdout = execFileSync(process.execPath, ['tools/wp0/run-protected-command.js', command, '--gate-only'], {
      cwd: REPO_ROOT,
      encoding: 'utf8'
    });
    const result = JSON.parse(stdout);
    assert.equal(result.status, 'PASS', JSON.stringify(result));
    assert.equal(result.gateStatus, 'PASS');
  }
});

test('repository scope is explicit and does not claim unavailable original release source', () => {
  const scope = checkRepositoryScope();
  assert.equal(scope.pass, true, JSON.stringify(scope));
  assert.equal(scope.sourceOrigin, 'EXTRACTED_29_2_4_INSTALLER_SOURCE_BASELINE');
  assert.equal(scope.runtimeSourceForExtractedArtifactPresent, true);
  assert.equal(scope.completeOriginalDevelopmentAndReleaseSourceProven, false);
  assert.equal(scope.fullOriginalRepositoryClaimAllowed, false);
  assert.equal(scope.untrackedReleaseCandidateCount, 0);
});

test('hotfix entrypoint scanner rejects forbidden fixture filename', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp0-hotfix-'));
  fs.mkdirSync(path.join(root, 'release-scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'release-scripts', 'START_UPDATE.cmd'), '@echo off\n');
  const result = checkForbiddenHotfixEntrypoints(root);
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'WP0_FORBIDDEN_HOTFIX_ENTRYPOINT');
});
