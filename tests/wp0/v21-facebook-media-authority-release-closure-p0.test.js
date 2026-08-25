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
  assert.match(
    adapter,
    /eventBus\.(?:on|subscribe)\(\s*['"]facebook:webhook-media-delegated['"][\s\S]*?scheduleWebhookMediaTransfer/u,
    'Facebook webhook adapter must own the production delegated-media consumer'
  );
  assert.match(
    adapter,
    /scheduleWebhookMediaTransfer[\s\S]*?mediaPipeline\.prepareMediaTransfer\(/u,
    'delegated Facebook Worker media must enter the existing durable MEDIA_TRANSFER scheduler'
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

test('legacy Facebook URL-only media cannot remain pending or re-enter direct CDN fetch', () => {
  const adapter = readText('backend/services/facebookAdapter.js');
  assert.match(adapter, /workerMediaCount\s*=\s*rawAttachments\.filter[\s\S]*?event_id[\s\S]*?status\s*!==\s*['"]failed['"]/u);
  assert.match(adapter, /workerReady\s*=\s*Boolean\(workerEventId[\s\S]*?status\s*!==\s*['"]failed['"]\)/u);
  assert.match(adapter, /status:\s*workerReady\s*\?\s*['"]pending['"]\s*:\s*['"]unavailable['"]/u);
  assert.match(adapter, /downloadError:\s*workerReady\s*\?\s*['"]['"]\s*:\s*['"]FACEBOOK_LEGACY_MEDIA_FETCH_RETIRED['"]/u);
  assert.match(adapter, /sourceUrl:\s*['"]['"][\s\S]*?url:\s*['"]['"][\s\S]*?mediaUrl:\s*['"]['"]/u);
  assert.match(adapter, /if\s*\(hasWorkerMedia\)\s*\{[\s\S]*?facebook:webhook-media-delegated/u);
  assert.doesNotMatch(
    adapter,
    /if\s*\(hasWorkerMedia\s*\|\|\s*hasLegacyRemoteMedia\)[\s\S]*?facebook:webhook-media-delegated/u,
    'legacy URL-only media must not schedule a durable transfer that has no Worker custody reference'
  );
  assert.match(adapter, /FACEBOOK_LEGACY_MEDIA_FETCH_RETIRED/u);
});

test('MEDIA_TRANSFER physical execution has an implemented account-owned media-transfer ReconcilePort dispatch', () => {
  const composition = readText('backend/runtime/AppRuntimeComposition.js');
  const ports = readText('backend/services/platformAdapterPorts.js');
  const manager = readText('backend/services/accountManagerCore.js');

  assert.match(
    composition,
    /accountId[\s\S]*?operation:\s*['"]media-transfer['"]/u,
    'AppRuntimeComposition must project account-scoped custody into the MEDIA_TRANSFER ReconcilePort call'
  );
  assert.match(
    ports,
    /case\s+['"]media-transfer['"]\s*:\s*return\s+manager\.mediaTransfer/u,
    'generic ReconcilePort must stay a thin dispatch into the account owning layer'
  );
  assert.match(
    manager,
    /async\s+mediaTransfer\([\s\S]*?messageStore\.getExternalMessage[\s\S]*?facebookAdapter\.cacheWebhookAttachments/u,
    'AccountManager must resolve persisted Facebook media and invoke the existing signed Worker materializer'
  );
  assert.match(manager, /expectedSourceScopeReference\s*=\s*`facebook:\$\{id\}:webhook:\$\{externalMessageId\}`/u);
  assert.match(manager, /expectedDestinationScopeReference\s*=\s*`conversation:\$\{conversationId\}:message:\$\{externalMessageId\}`/u);
  assert.match(manager, /expectedMetadataSha256\s*=\s*crypto\.createHash\(['"]sha256['"]\)[\s\S]*?\['facebook', id, conversationId, externalMessageId\]/u);
  assert.match(manager, /FACEBOOK_MEDIA_TRANSFER_SCOPE_MISMATCH/u);
  assert.doesNotMatch(
    ports,
    /function\s+(?:scheduleFacebookWebhookMediaTransfer|materializeFacebookMediaTransfer|facebookMediaTransferCommand)\b/u,
    'generic platform ports must not own Facebook-specific scheduling or materialization'
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
