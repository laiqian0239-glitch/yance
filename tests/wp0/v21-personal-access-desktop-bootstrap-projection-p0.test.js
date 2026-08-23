'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { RuntimeProjectionCoordinator } = require('../../electron/desktopHost/RuntimeProjectionCoordinator');

const REPO_ROOT = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function runtimeSnapshot() {
  return {
    contractVersion: 2,
    buildId: 'wp6-test-build',
    stateVersion: 5,
    lastEventSequence: 7,
    generatedAtUtc: '2026-08-23T00:00:00.000Z',
    runtime: {
      lifecycleState: 'running',
      operatingMode: 'normal',
      operatingModeRevision: 3,
      ownerInstanceId: 'owner-bootstrap-1',
      fencingToken: 1,
      localReady: true
    },
    capabilities: { network: 'online' },
    diagnosticsSummary: {},
    credentialHydration: null,
    localCriticalWorkers: {},
    externalWorkers: {}
  };
}

function activeBinding() {
  return {
    backendPid: 4201,
    startupNonce: 'bootstrap-nonce-1',
    backendSessionId: 'bootstrap-session-1',
    fd6PipeInstanceId: 'fd6-bootstrap-1',
    ownerSessionId: 'owner-session-bootstrap-1',
    sessionFingerprint: 'bootstrap-fingerprint-1'
  };
}

test('Desktop bootstrap runtime projection is local-session protected before human entitlement', () => {
  const source = read('backend/server.js');
  const localSecurityIndex = source.indexOf('app.use(createR32LocalApiSecurity({');
  const bootstrapIndex = source.indexOf("app.get('/api/desktop/runtime-projection-snapshot'");
  const personalGuardIndex = source.indexOf('app.use(createPersonalAccessGuard({ personalAccessService }))');
  const productApiIndex = source.indexOf("app.use('/api/app/v2'");

  assert.ok(bootstrapIndex >= 0, 'backend must expose the read-only DesktopHost bootstrap projection endpoint');
  assert.ok(localSecurityIndex >= 0 && localSecurityIndex < bootstrapIndex,
    'bootstrap projection must remain behind the existing loopback/API-session local security boundary');
  assert.ok(personalGuardIndex > bootstrapIndex,
    'bootstrap projection must be reachable before human personal-access entitlement is available');
  assert.ok(productApiIndex > personalGuardIndex,
    '/api/app/v2 must remain behind the human personal-access guard');

  const bootstrapBlock = source.slice(bootstrapIndex, personalGuardIndex);
  assert.match(bootstrapBlock, /APP_RUNTIME\.snapshot\(\)/u,
    'bootstrap endpoint must reuse the canonical APP_RUNTIME snapshot instead of a duplicate projection');
});

test('ApiV2RuntimeClient separates bootstrap projection transport from entitled product snapshots', () => {
  const source = read('electron/desktopHost/ApiV2RuntimeClient.js');
  const bootstrapStart = source.indexOf('async getBootstrapSnapshot(');
  const productStart = source.indexOf('async getSnapshot(');
  const eventsStart = source.indexOf('async getEvents(');

  assert.ok(bootstrapStart >= 0, 'client must provide an explicit bootstrap-snapshot method');
  assert.ok(productStart >= 0 && eventsStart > productStart, 'existing product snapshot method must remain present');
  assert.match(source.slice(bootstrapStart, productStart), /\/api\/desktop\/runtime-projection-snapshot/u,
    'bootstrap method must use only the DesktopHost local-control endpoint');
  assert.match(source.slice(productStart, eventsStart), /\/api\/app\/v2\/snapshot/u,
    'steady-state product snapshot transport must remain on /api/app/v2');
});

test('candidate validation and trusted-owner baseline use bootstrap projection before entitlement', () => {
  const source = read('electron/desktopHost/RuntimeProjectionCoordinator.js');
  const candidateStart = source.indexOf('async validateCandidateProjection(');
  const bindStart = source.indexOf('async bindTrustedOwnerBaseline(');
  const discardStart = source.indexOf('discardBaseline(');
  assert.ok(candidateStart >= 0 && bindStart > candidateStart && discardStart > bindStart);

  const candidateBlock = source.slice(candidateStart, bindStart);
  const bindBlock = source.slice(bindStart, discardStart);
  assert.match(candidateBlock, /this\.client\.getBootstrapSnapshot\(/u,
    'untrusted candidate validation must not require human product entitlement');
  assert.doesNotMatch(candidateBlock, /this\.client\.getSnapshot\(/u,
    'untrusted candidate validation must not call the entitled product snapshot');
  assert.match(bindBlock, /this\.client\.getBootstrapSnapshot\(/u,
    'trusted-owner baseline establishment must use the bootstrap projection seam');
  assert.doesNotMatch(bindBlock, /this\.client\.getSnapshot\(/u,
    'trusted-owner baseline establishment must not create an entitlement-before-owner-trust cycle');
});

test('fresh unregistered TESTER can establish owner baseline without product entitlement', async () => {
  const backend = {
    running: true,
    apiSessionEstablished: true,
    ownerTrusted: false,
    backendPid: 4201,
    startupNonce: 'bootstrap-nonce-1',
    backendSessionId: 'bootstrap-session-1'
  };
  const calls = { bootstrap: 0, product: 0 };
  const snapshot = runtimeSnapshot();
  const client = {
    currentBinding() { return activeBinding(); },
    async getBootstrapSnapshot() {
      calls.bootstrap += 1;
      return snapshot;
    },
    async getSnapshot() {
      calls.product += 1;
      const error = new Error('Fresh TESTER installation has not yet been registered');
      error.reasonCode = 'INSTALLATION_UNREGISTERED';
      throw error;
    },
    abortAll() {}
  };
  const coordinator = new RuntimeProjectionCoordinator({
    client,
    backendSnapshot: () => ({ ...backend }),
    expectedBuildId: 'wp6-test-build',
    clock: () => '2026-08-23T00:00:00.000Z'
  });

  const candidate = await coordinator.validateCandidateProjection({ ready: { backend: { backendPid: 4201 } } });
  assert.equal(candidate.candidateOnly, true);
  assert.equal(candidate.projectionStatus, 'CANDIDATE_VALIDATED_OWNER_UNTRUSTED');

  backend.ownerTrusted = true;
  const baseline = await coordinator.bindTrustedOwnerBaseline(candidate);
  assert.equal(baseline.state, 'API_V2_SYNCHRONIZED');
  assert.equal(calls.bootstrap, 2, 'both pre-entitlement owner-establishment reads must use bootstrap projection');
  assert.equal(calls.product, 0, 'human-entitlement product snapshot must not be touched during owner bootstrap');
});

test('steady-state reconciliation remains on entitled Runtime API v2 after owner baseline', () => {
  const coordinatorSource = read('electron/desktopHost/RuntimeProjectionCoordinator.js');
  const refetchStart = coordinatorSource.indexOf('async _refetchAfterGap(');
  const commandEnd = coordinatorSource.indexOf('setOperatingMode(', refetchStart);
  assert.ok(refetchStart >= 0 && commandEnd > refetchStart);
  const steadyStateBlock = coordinatorSource.slice(refetchStart, commandEnd);
  const productSnapshotCalls = steadyStateBlock.match(/this\.client\.getSnapshot\(/gu) || [];
  assert.ok(productSnapshotCalls.length >= 3,
    'gap recovery, event reconciliation, and post-command reconciliation must keep using entitled product snapshots');

  const clientSource = read('electron/desktopHost/ApiV2RuntimeClient.js');
  const productStart = clientSource.indexOf('async getSnapshot(');
  const eventsStart = clientSource.indexOf('async getEvents(');
  assert.match(clientSource.slice(productStart, eventsStart), /\/api\/app\/v2\/snapshot/u,
    'steady-state product snapshot endpoint must not be exempted from personal-access enforcement');
});
