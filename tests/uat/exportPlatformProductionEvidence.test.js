'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { exportPlatformEvidence, sanitizeReadiness, sanitizeEvidence, collectIdentityGovernance, collectLearningGovernance, collectRuntimeEvidence } = require('../../tools/uat/exportPlatformProductionEvidence');

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
function close(server) { return new Promise(resolve => server.close(resolve)); }

test('platform production evidence hashes account identity and removes credential-shaped fields', () => {
  const safe = sanitizeReadiness({
    schemaVersion: 1,
    platforms: {
      facebook: {
        platform: 'facebook', status: 'ready-for-real-uat', counts: { total: 1 }, accounts: [{
          accountId: 'fa-private', displayName: 'Private Name', platform: 'facebook', state: 'connected', status: 'ready-for-real-uat', counts: {},
          checks: [{ id: 'receive', label: 'Receive', status: 'pass', detail: 'ok', evidence: { accessToken: 'secret', peerId: '12345', relayState: 'connected' } }]
        }]
      }
    },
    summary: { configuredPlatforms: 1 }
  });
  const account = safe.platforms.facebook.accounts[0];
  assert.equal(typeof account.accountIdHashSha256, 'string');
  assert.equal(account.accountId, undefined);
  assert.equal(account.displayName, undefined);
  assert.equal(account.checks[0].evidence.accessToken, undefined);
  assert.equal(typeof account.checks[0].evidence.peerIdHashSha256, 'string');
  assert.equal(account.checks[0].evidence.relayState, 'connected');
});


test('already-hashed architecture identifiers remain stable instead of being double-hashed', () => {
  const hashValue = 'b'.repeat(64);
  const safe = sanitizeEvidence({ accountIdHashSha256: hashValue, contactIdHashSha256: 'C'.repeat(64), accountId: 'private-account' });
  assert.equal(safe.accountIdHashSha256, hashValue);
  assert.equal(safe.contactIdHashSha256, 'c'.repeat(64));
  assert.equal(typeof safe.accountIdHashSha256HashSha256, 'undefined');
  assert.equal(safe.accountId, undefined);
});

test('exporter reads live health and platform readiness and writes a secret-free manifest', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/r32/system/health') return res.end(JSON.stringify({ ok: true, product: { name: '言策', buildId: 'build-1', sourceCommit: '1'.repeat(40), sourceTree: '2'.repeat(40), artifactClass: 'ROUND12_13_COMPREHENSIVE_WINDOWS_UAT_CANDIDATE', releaseManifestSha256: 'a'.repeat(64), port: 27632 }, pid: 9, uptimeSeconds: 12 }));
    if (req.url === '/api/r32/system/platform-readiness') return res.end(JSON.stringify({ ok: true, readiness: {
      schemaVersion: 1,
      platforms: {
        facebook: { platform: 'facebook', status: 'ready-for-real-uat', counts: { total: 1 }, realUatCompleted: false, accounts: [{ accountId: 'private', displayName: 'Name', platform: 'facebook', state: 'connected', status: 'ready-for-real-uat', counts: {}, checks: [] }] },
        whatsapp: { platform: 'whatsapp', status: 'not-configured', counts: { total: 0 }, realUatCompleted: false, accounts: [] },
        telegram: { platform: 'telegram', status: 'not-configured', counts: { total: 0 }, realUatCompleted: false, accounts: [] }
      },
      summary: { configuredPlatforms: 1, readyForRealUatPlatforms: 1, realUatCompleted: false }
    }}));
    if (req.url === '/api/r32/system/architecture/round12') return res.end(JSON.stringify({ ok: true, architecture: { authority: 'Round12ArchitectureStatusAuthority', completionSemantics: { windowsVerified: false } } }));
    if (req.url === '/api/r32/system/architecture/release-gate') return res.end(JSON.stringify({ ok: true, ready: true, health: { releaseBlocked: false } }));
    if (req.url.startsWith('/api/r32/system/architecture/runtime-evidence?')) return res.end(JSON.stringify({ ok: true, evidence: { authority: 'ArchitectureRuntimeEvidenceAuthority', counts: { queue: 1, outbox: 1, routeReceipts: 1, queueTotal: 1, outboxTotal: 1 }, qualityRouteSummary: { highCapability: 1, fallback: 0, emergency: 0, learningIneligible: 0 }, pagination: { limit: 500, offset: 0, queueTotal: 1, outboxTotal: 1, queueHasMore: false, outboxHasMore: false }, queue: [{ queueId: 'q1', accountIdHashSha256: 'b'.repeat(64), commandSha256: 'c'.repeat(64), sendPolicySha256: 'd'.repeat(64), route: { modelId: 'model-x', provider: 'provider-x', highCapabilityPath: true, fallbackUsed: true, learningEligible: true, receiptHash: 'f'.repeat(64), receiptSignature: 'sig', attempts: [{ modelId: 'model-x', contextReduced: true }] } }], outbox: [{ outboxId: 'o1', contactIdHashSha256: 'e'.repeat(64), route: { modelId: 'model-x', provider: 'provider-x', highCapabilityPath: true, fallbackUsed: true, learningEligible: true, receiptHash: 'f'.repeat(64), receiptSignature: 'sig', attempts: [{ modelId: 'model-x', contextReduced: true }] } }] } }));
    if (req.url === '/api/r32/system/platform-capabilities') return res.end(JSON.stringify({ ok: true, capabilities: { authority: 'PlatformCapabilityAuthority', global: { availability: 'ready' } } }));
    if (req.url.startsWith('/api/r32/store/event-projection/governance?')) return res.end(JSON.stringify({ ok: true, status: { converged: true, convergence: { blocking: 0, converged: true } }, totalBlocking: 0, items: [], hasMore: false }));
    if (req.url.startsWith('/api/r32/store/learning-governance/automatic-synthesis/overview?')) return res.end(JSON.stringify({ ok: true, status: { started: true, lastRun: { ok: true } }, proposals: [], activeProfiles: [], recentAudits: [], pagination: { proposalHasMore: false, profileHasMore: false, auditHasMore: false } }));
    if (req.url.startsWith('/api/r32/store/identity-governance?')) return res.end(JSON.stringify({ ok: true, governance: { items: [], pagination: { hasMore: false } } }));
    res.statusCode = 404; res.end(JSON.stringify({ ok: false }));
  });
  const port = await listen(server);
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-platform-evidence-'));
  try {
    const result = await exportPlatformEvidence({ baseUrl: `http://127.0.0.1:${port}`, outputRoot });
    assert.equal(result.report.runtimeBuildId, 'build-1');
    assert.equal(result.report.runtimeSourceCommit, '1'.repeat(40));
    assert.equal(result.report.runtimeSourceTree, '2'.repeat(40));
    assert.equal(result.report.runtimeArtifactClass, 'ROUND12_13_COMPREHENSIVE_WINDOWS_UAT_CANDIDATE');
    assert.deepEqual(result.report.readyForRealUatPlatforms, ['facebook']);
    assert.equal(result.report.realUatCompleted, false);
    const text = fs.readFileSync(path.join(outputRoot, 'platform-production-readiness.json'), 'utf8');
    assert.equal(text.includes('private'), false);
    assert.equal(fs.existsSync(path.join(outputRoot, 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(outputRoot, 'ai-route-outbox-runtime-evidence.json')), true);
    assert.equal(result.report.aiQualityRouteReceiptsExported, 2);
    assert.equal(result.report.outboxCommandsExported, 1);
    assert.equal(result.report.governanceEvidenceComplete, true);
    assert.equal(result.report.evidencePromotionAllowed, true);
    const runtimeEvidence = JSON.parse(fs.readFileSync(path.join(outputRoot, 'ai-route-outbox-runtime-evidence.json'), 'utf8'));
    assert.equal(runtimeEvidence.queue[0].accountIdHashSha256, 'b'.repeat(64));
    assert.equal(runtimeEvidence.queue[0].route.modelId, 'model-x');
    assert.equal(runtimeEvidence.queue[0].route.fallbackUsed, true);
    assert.equal(runtimeEvidence.queue[0].route.attempts[0].contextReduced, true);
  } finally {
    await close(server);
    fs.rmSync(outputRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});


test('identity evidence pagination marks an endless result as truncated instead of claiming completeness', async () => {
  let requests = 0;
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    requests += 1;
    res.end(JSON.stringify({ ok: true, governance: { items: [{ person: { personId: `person-${requests}` }, audits: [] }], pagination: { hasMore: true } } }));
  });
  const port = await listen(server);
  try {
    const result = await collectIdentityGovernance(`http://127.0.0.1:${port}`, 15000);
    assert.equal(result.governance.pagination.truncated, true);
    assert.equal(result.governance.pagination.allPagesExported, false);
    assert.equal(result.governance.items.length, 100);
  } finally { await close(server); }
});


test('learning governance pagination advances unfinished streams without duplicating completed proposal or audit pages', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    const url = new URL(req.url, 'http://127.0.0.1');
    requests.push(Object.fromEntries(url.searchParams));
    const profileOffset = Number(url.searchParams.get('profileOffset') || 0);
    res.end(JSON.stringify({
      ok: true,
      status: { started: true },
      proposals: [{ proposalId: 'proposal-1' }],
      activeProfiles: profileOffset === 0 ? [{ profileId: 'profile-1' }] : [{ profileId: 'profile-2' }],
      recentAudits: [{ auditId: 'audit-1' }],
      pagination: { proposalHasMore: false, profileHasMore: profileOffset === 0, auditHasMore: false }
    }));
  });
  const port = await listen(server);
  try {
    const result = await collectLearningGovernance(`http://127.0.0.1:${port}`, 15000);
    assert.deepEqual(result.proposals.map(row => row.proposalId), ['proposal-1']);
    assert.deepEqual(result.activeProfiles.map(row => row.profileId), ['profile-1','profile-2']);
    assert.deepEqual(result.recentAudits.map(row => row.auditId), ['audit-1']);
    assert.equal(result.pagination.allPagesExported, true);
    assert.equal(requests.length, 2);
    assert.equal(Number(requests[1].offset), 0);
    assert.equal(Number(requests[1].profileOffset), 1);
    assert.equal(Number(requests[1].auditOffset), 0);
  } finally { await close(server); }
});


test('runtime evidence pagination recomputes integrity across every page instead of trusting the first page summary', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    const url = new URL(req.url, 'http://127.0.0.1');
    const offset = Number(url.searchParams.get('offset') || 0);
    const bad = offset > 0;
    res.end(JSON.stringify({ ok: true, evidence: {
      authority: 'ArchitectureRuntimeEvidenceAuthority',
      counts: { queue: 1, outbox: 0, queueTotal: 2, outboxTotal: 0 },
      integritySummary: bad ? { commandFailures: 1, routeFailures: 0, releaseBlocking: 1 } : { commandFailures: 0, routeFailures: 0, releaseBlocking: 0 },
      pagination: { limit: 500, offset, queueTotal: 2, outboxTotal: 0, queueHasMore: offset === 0, outboxHasMore: false },
      queue: [{ queueId: bad ? 'q-bad' : 'q-good', state: 'pending', integrity: { command: { verified: !bad }, route: { present: false, verified: null } }, route: {} }],
      outbox: []
    } }));
  });
  const port = await listen(server);
  try {
    const result = await collectRuntimeEvidence(`http://127.0.0.1:${port}`, 15000);
    assert.equal(result.queue.length, 2);
    assert.equal(result.pagination.allPagesExported, true);
    assert.deepEqual(result.integritySummary, { commandFailures: 1, routeFailures: 0, releaseBlocking: 1 });
  } finally { await close(server); }
});


test('sanitization preserves every paginated evidence row instead of silently truncating at one hundred', () => {
  const rows = Array.from({ length: 150 }, (_, index) => ({
    messageId: `message-${index}`,
    accountId: `account-${index}`,
    state: 'verified'
  }));
  const sanitized = sanitizeEvidence({ rows, pagination: { allPagesExported: true, truncated: false, hasMore: false } });
  assert.equal(sanitized.rows.length, 150);
  assert.equal(sanitized.rows[149].state, 'verified');
  assert.match(sanitized.rows[149].messageIdHashSha256, /^[a-f0-9]{64}$/);
  assert.equal(sanitized.pagination.allPagesExported, true);
  assert.equal(sanitized.pagination.truncated, false);
});
