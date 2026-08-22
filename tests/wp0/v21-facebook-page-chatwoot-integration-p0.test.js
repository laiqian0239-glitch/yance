'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const CHATWOOT_COMMIT = '70e284a044f00326725f65f703162745371075ec';
const READINESS_SHA256 = '9808015d8e6a0626ea0a69750f114a237a5ccd371f5d68d8af62769006fb1e7f';

function repositoryPath(relativePath) {
  return path.join(ROOT, ...relativePath.split('/'));
}

function readText(relativePath) {
  const filePath = repositoryPath(relativePath);
  assert.equal(fs.existsSync(filePath), true, `missing Facebook Page Chatwoot integration file: ${relativePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test('Facebook Page pins Chatwoot CE v4.16.2 as a separate external runtime authority without mutating the three existing comms upstream authorities', () => {
  const lock = readJson('config/upstreams/v21-comms-p0.json');
  assert.deepEqual(Object.keys(lock.upstreams).sort(), ['elementWeb', 'mautrixWhatsapp', 'synapse']);
  assert.deepEqual(lock.externalRuntimes?.chatwootFacebookPage, {
    repository: 'https://github.com/chatwoot/chatwoot.git',
    version: 'v4.16.2',
    commit: CHATWOOT_COMMIT,
    license: 'MIT',
    adoptionMode: 'sidecar-service',
    protocolAuthority: 'facebook-page-official'
  });
});

test('Facebook Page integration contract binds Chatwoot runtime, Matrix room state, readiness evidence and unverified real-account status', () => {
  const contract = readJson('services/matrix/chatwoot-facebook-page/contract.json');
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.runtime, 'chatwoot-facebook-page');
  assert.equal(contract.chatwoot.version, 'v4.16.2');
  assert.equal(contract.chatwoot.commit, CHATWOOT_COMMIT);
  assert.equal(contract.chatwoot.license, 'MIT');
  assert.equal(contract.matrix.bindingEventType, 'com.yance.multibridge.binding');
  assert.equal(contract.matrix.bindingStateKey, 'facebook_ads');
  assert.equal(contract.identity.accountInstancePrefix, 'facebook_ads:');
  assert.equal(contract.evidence.readinessArtifactSha256, READINESS_SHA256);
  assert.equal(contract.evidence.staticTests, '73/73 GREEN');
  assert.equal(contract.evidence.validate, 'GREEN');
  assert.equal(contract.evidence.policyScan, 'GREEN');
  assert.equal(contract.evidence.realAccountEvidencePresent, false);
  assert.equal(contract.evidence.sourcePackageIntegrationEligibleFlag, false);
  assert.equal(contract.authority.noSecondConversationDatabase, true);
  assert.equal(contract.authority.noYanceRetryQueue, true);
  assert.equal(contract.authority.noDirectMetaGraphClient, true);
});

test('facebook-page-official and legacy platform-level Facebook messaging resolve to the Chatwoot Matrix bridge, not facebookAdapter', () => {
  const source = readText('backend/services/platformDriverRegistry.js');
  assert.match(source, /require\(['"]\.\/facebookChatwootMatrixBridge['"]\)/u);
  assert.doesNotMatch(source, /require\(['"]\.\/facebookAdapter['"]\)/u);
  assert.match(source, /'facebook-page-official'[\s\S]*adapter:\s*facebookChatwoot/u);
  assert.match(source, /facebook:\s*Object\.freeze\([\s\S]*adapter:\s*facebookChatwoot/u);
  assert.match(source, /facebook-personal-identity-official/u);
  assert.match(source, /facebook-personal-messenger-mautrix-meta/u);
  assert.match(source, /protocolAuthority:\s*'mautrix-meta'/u);
});

test('legacy Worker OAuth fails closed for Page accounts before any Worker contract call while Personal identity OAuth remains reachable', () => {
  const source = readText('backend/services/facebookOAuthService.js');
  assert.match(source, /FACEBOOK_PAGE_OAUTH_OWNED_BY_CHATWOOT/u);
  assert.match(source, /accountKind === 'personal-identity' \? 'identity' : 'page'/u);
  const beginStart = source.indexOf('async function begin');
  const guard = source.indexOf('assertPageOAuthOwnedByChatwoot(mode)', beginStart);
  const worker = source.indexOf('verifyWorkerOAuthContract', beginStart);
  assert.ok(beginStart >= 0 && guard > beginStart, 'Page OAuth ownership guard must run inside begin()');
  assert.ok(worker > guard, 'Page OAuth ownership guard must fail closed before the legacy Worker OAuth contract call');
});

test('Facebook account webhook production route is the Chatwoot signed raw-body boundary instead of the retired Cloudflare Page webhook', () => {
  const source = readText('backend/routes/accounts.js');
  assert.match(source, /facebookChatwootMatrixBridge/u);
  assert.match(source, /x-chatwoot-signature/iu);
  assert.match(source, /x-chatwoot-timestamp/iu);
  assert.match(source, /rawBody/u);
  assert.doesNotMatch(source, /FACEBOOK_WEBHOOK_MOVED_TO_CLOUDFLARE/u);
  assert.doesNotMatch(source, /x-hub-signature-256/iu);
});

test('thin Chatwoot Matrix bridge verifies exact upstream HMAC freshness and keeps Page routing in Matrix room state without direct Meta Graph or local queue/database authority', () => {
  const source = readText('backend/services/facebookChatwootMatrixBridge.js');
  for (const required of [
    'X-Chatwoot-Signature',
    'X-Chatwoot-Timestamp',
    'sha256=',
    'timingSafeEqual',
    '300000',
    'com.yance.multibridge.binding',
    'facebook_ads',
    '/api/v1/accounts/',
    '/conversations/',
    '/messages',
    '/_matrix/client/',
    '/_matrix/media/'
  ]) assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'), `bridge must retain ${required}`);
  assert.doesNotMatch(source, /graph\.facebook\.com|graph\.facebook|fb\.me\//iu);
  assert.doesNotMatch(source, /sqlite|better-sqlite|new\s+Map\s*\(\)[\s\S]*(?:retry|queue)/iu);
});

test('legacy Facebook OAuth regression migrates Page assertions to Chatwoot ownership while retaining Personal Identity Worker coverage', () => {
  const source = readText('backend/tests/facebookOAuthLifecycleRegression.test.js');
  assert.doesNotMatch(source, /test\('Facebook OAuth starts only against sealed Worker URL and registers a public device identity'/u);
  assert.doesNotMatch(source, /test\('Facebook OAuth polling ignores any injected Page Token and exposes only safe Page metadata'/u);
  assert.doesNotMatch(source, /test\('Facebook Page selection (?:completes credential replacement|persists cloud account)/u);
  assert.match(source, /test\('official Facebook personal identity login completes without Page selection and never grants Messenger capability'/u);
});

test('legacy Facebook Worker transport keeps persisted WP-B identity out of URLs and exposes bounded lease renewal', () => {
  const relay = readText('backend/services/facebookRelayClient.js');
  const desktopApi = readText('services/facebook-worker/src/desktopApi.js');
  const workerIndex = readText('services/facebook-worker/src/index.js');

  assert.doesNotMatch(relay, /wpb_execution_id|wpb_attempt_id|wpb_claim_id|wpb_owner_id|wpb_generation|wpb_host_generation|wpb_fencing_token/u);
  assert.match(relay, /x-yance-wpb-execution-id/u);
  assert.match(relay, /x-yance-wpb-attempt-id/u);
  assert.match(relay, /\/api\/desktop\/events\/renew/u);
  assert.match(desktopApi, /export\s+async\s+function\s+renewEvents/u);
  assert.match(workerIndex, /\/api\/desktop\/events\/renew/u);
});
