'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const AUTHORIZATION_PATH = 'governance/layered-ci/v21-facebook-media-authority-release-closure-p0-authorization.json';

function repositoryPath(repoPath) {
  return path.join(ROOT, ...repoPath.split('/'));
}

function readText(repoPath) {
  return fs.readFileSync(repositoryPath(repoPath), 'utf8');
}

function readJson(repoPath) {
  return JSON.parse(readText(repoPath));
}

test('merged authorization binds the Facebook media release causal batch to tests-only failure-first scope', () => {
  const authorization = readJson(AUTHORIZATION_PATH);
  assert.equal(authorization.workPackage, 'V21-FACEBOOK-MEDIA-AUTHORITY-RELEASE-CLOSURE-P0');
  assert.equal(authorization.status, 'AUTHORIZED_AFTER_TRUSTED_MAIN_MERGE');
  assert.equal(authorization.implementation.branch, 'fix/v21-facebook-media-authority-release-closure-p0');
  assert.equal(authorization.implementation.productionScopeAuthorized, false);
  assert.equal(authorization.implementation.failureFirstCommit.freshCausalRedRequired, true);
  assert.deepEqual(authorization.implementation.failureFirstCommit.allowedChangedPaths, [
    'services/facebook-worker/tests/media-r2-retention.test.js',
    'tests/wp0/v21-facebook-media-authority-release-closure-p0.test.js'
  ]);
  assert.equal(
    authorization.implementation.failureFirstCommit.fastClosureV2.requiredClosureTrailer,
    'Yance-Closure-Matrix-Unknown-Blockers: 0'
  );
});

test('facebook webhook media delegation has a production consumer that enters durable MEDIA_TRANSFER authority', () => {
  const adapter = readText('backend/services/facebookAdapter.js');
  assert.match(
    adapter,
    /eventBus\.publish\(\s*['"]facebook:webhook-media-delegated['"]/u,
    'Facebook webhook adapter must retain the post-persistence delegation event'
  );

  const servicesRoot = repositoryPath('backend/services');
  const consumers = fs.readdirSync(servicesRoot)
    .filter(name => name.endsWith('.js'))
    .filter(name => {
      const text = fs.readFileSync(path.join(servicesRoot, name), 'utf8');
      return /eventBus\.(?:on|subscribe)\(\s*['"]facebook:webhook-media-delegated['"]/u.test(text)
        && /MEDIA_TRANSFER/u.test(text);
    });

  assert.ok(
    consumers.length >= 1,
    'facebook:webhook-media-delegated must have a production event consumer that schedules durable MEDIA_TRANSFER work'
  );
});

test('MEDIA_TRANSFER physical execution has an implemented media-transfer ReconcilePort dispatch', () => {
  const composition = readText('backend/runtime/AppRuntimeComposition.js');
  const ports = readText('backend/services/platformAdapterPorts.js');

  assert.match(
    composition,
    /operation:\s*['"]media-transfer['"]/u,
    'AppRuntimeComposition must preserve the MEDIA_TRANSFER -> ReconcilePort physical operation'
  );
  assert.match(
    ports,
    /case\s+['"]media-transfer['"]\s*:/u,
    'default platform reconcile authority must implement the media-transfer operation used by AppRuntimeComposition'
  );
});

test('mandatory WP0 execution binds the Facebook Worker persisted-attempt media retention regression', () => {
  const result = spawnSync(
    process.execPath,
    ['--test', 'services/facebook-worker/tests/media-r2-retention.test.js'],
    { cwd: ROOT, encoding: 'utf8' }
  );

  assert.equal(
    result.status,
    0,
    [
      'Facebook Worker media retention regression must execute successfully under mandatory WP0 Stage coverage.',
      result.stdout || '',
      result.stderr || ''
    ].join('\n')
  );
});
