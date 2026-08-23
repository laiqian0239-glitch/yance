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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

test('steady-state reconciliation remains entirely on entitled Runtime API v2', () => {
  const source = read('electron/desktopHost/RuntimeProjectionCoordinator.js');
  const refetchStart = source.indexOf('async _refetchAfterGap(');
  const pollStart = source.indexOf('async pollOnce(', refetchStart);
  const commandStart = source.indexOf('async _command(', pollStart);
  const setterStart = source.indexOf('\n  setOperatingMode(', commandStart);
  assert.ok(refetchStart >= 0 && pollStart > refetchStart && commandStart > pollStart && setterStart > commandStart);

  assert.match(source.slice(refetchStart, pollStart), /this\.client\.getSnapshot\(/u,
    'event-gap recovery must use the entitled product snapshot');
  assert.match(source.slice(pollStart, commandStart), /this\.client\.getEvents\(/u,
    'steady-state polling must use entitled product events');
  assert.match(source.slice(pollStart, commandStart), /this\.client\.getSnapshot\(/u,
    'event reconciliation must use the entitled product snapshot');
  assert.match(source.slice(commandStart, setterStart), /this\.client\.getSnapshot\(/u,
    'post-command reconciliation must use the entitled product snapshot');

  const clientSource = read('electron/desktopHost/ApiV2RuntimeClient.js');
  assert.match(clientSource, /\/api\/app\/v2\/snapshot/u);
  assert.match(clientSource, /\/api\/app\/v2\/events/u);
  assert.match(clientSource, /\/api\/app\/v2\/commands/u);
});

test('pre-entitlement event polling retains the trusted owner baseline and backs off instead of creating a retry storm', async () => {
  const backend = {
    running: true,
    apiSessionEstablished: true,
    ownerTrusted: false,
    backendPid: 4201,
    startupNonce: 'bootstrap-nonce-1',
    backendSessionId: 'bootstrap-session-1'
  };
  const snapshot = runtimeSnapshot();
  let eventCalls = 0;
  let failureCallbacks = 0;
  const client = {
    currentBinding() { return activeBinding(); },
    async getSnapshot() { return snapshot; },
    async getEvents() {
      eventCalls += 1;
      const error = new Error('Product entitlement is not available yet');
      error.reasonCode = 'INSTALLATION_UNREGISTERED';
      throw error;
    },
    abortAll() {}
  };
  const coordinator = new RuntimeProjectionCoordinator({
    client,
    backendSnapshot: () => ({ ...backend }),
    expectedBuildId: 'wp6-test-build',
    pollIntervalMs: 50,
    entitlementPollBackoffMs: 1000,
    clock: () => '2026-08-23T00:00:00.000Z',
    onFailure: () => { failureCallbacks += 1; }
  });

  const candidate = await coordinator.validateCandidateProjection({ ready: { backend: { backendPid: 4201 } } });
  backend.ownerTrusted = true;
  await coordinator.bindTrustedOwnerBaseline(candidate);
  coordinator.startPolling();
  await delay(240);
  coordinator.stopPolling();

  const projection = coordinator.snapshot();
  assert.equal(projection.trustedOwnerBound, true,
    'human entitlement denial must never discard the trusted backend owner baseline');
  assert.equal(projection.state, 'WAITING_FOR_PRODUCT_ENTITLEMENT',
    'projection must distinguish product-entitlement wait from API-session or owner failure');
  assert.equal(projection.lastFailure?.reasonCode, 'INSTALLATION_UNREGISTERED');
  assert.ok(eventCalls <= 1,
    `pre-entitlement polling must be backed off instead of hammering /api/app/v2/events; calls=${eventCalls}`);
  assert.ok(failureCallbacks <= 1,
    `pre-entitlement denial must not create repeated failure-log callbacks; callbacks=${failureCallbacks}`);
});

test('all backend-generation acceptance and recovery paths preserve fail-closed owner validation before acceptance', () => {
  const source = read('electron/desktopHost/DesktopCredentialApplicationCoordinator.js');
  const normalValidation = source.indexOf('runtimeProjection = this._assertRuntimeProjection(await this.validateRuntimeProjection({ result, ready');
  const normalAccept = source.indexOf('ownerAcceptance = this.desktopHost.acceptBackendOwner?.', normalValidation);
  assert.ok(normalValidation >= 0 && normalAccept > normalValidation,
    'normal new-owner path must validate runtime projection before accepting the backend owner');

  const alreadyReady = source.indexOf('alreadyReady: true');
  const alreadyReadyAccept = source.indexOf('this.desktopHost.acceptBackendOwner?.', alreadyReady);
  assert.ok(alreadyReady >= 0 && alreadyReadyAccept > alreadyReady,
    'already-ready recovery must funnel through the same runtime projection validation before owner acceptance');

  const staleExit = source.indexOf('staleExit: true');
  assert.ok(staleExit >= 0,
    'stale-exit recovery must revalidate the surviving/new backend owner rather than bypassing runtime projection validation');
  assert.match(source.slice(Math.max(0, staleExit - 500), staleExit + 250), /validateRuntimeProjection/u);
  assert.match(source, /_cleanupRejectedNewOwner\(token, cause, options\)/u,
    'real validation failures must continue to enter rejected-owner containment');
});

test('main activation and post-install PASS remain independent from human entitlement after trusted bootstrap', () => {
  const mainSource = read('electron/main.js');
  assert.doesNotMatch(mainSource, /\/api\/app\/v2/u,
    'Electron main activation must not directly consume human-entitlement product API v2 routes');
  assert.match(mainSource, /apiRequest\('\/api\/desktop\/credential-authority-state'\)/u,
    'owner validation may use the existing DesktopHost local-control authority projection');
  assert.match(mainSource, /runtimeProjectionCoordinator\.validateCandidateProjection\(context\)/u);

  const bindIndex = mainSource.indexOf('await runtimeProjectionCoordinator.bindTrustedOwnerBaseline(');
  const pollIndex = mainSource.indexOf('runtimeProjectionCoordinator.startPolling()', bindIndex);
  const readyIndex = mainSource.indexOf('backendReady = true', bindIndex);
  assert.ok(bindIndex >= 0 && pollIndex > bindIndex && readyIndex > pollIndex,
    'backend activation must bind trusted owner baseline before polling and publishing Desktop READY');
  assert.match(mainSource, /apiRequest\('\/api\/ready'\)/u,
    'activation readiness must stay on the local ready endpoint');
  assert.match(mainSource, /YANCE_POST_INSTALL_LAUNCH_RECEIPT/u);
  assert.match(mainSource, /status:\s*'PASS'/u,
    'post-install receipt remains a desktop activation verdict, not a personal-entitlement bypass');
});

test('fresh TESTER permission UI remains reachable while Product children stay blocked', () => {
  const workspaceSource = read('integration/element-module/src/YanceWorkspace.tsx');
  const accessSource = read('integration/element-module/src/product-experience/PersonalAccessSurface.tsx');
  const guardSource = read('backend/middleware/personalAccessGuard.js');

  assert.match(workspaceSource, /<PersonalAccessSurface>[\s\S]*<ProductExperienceShell/u,
    'personal-access surface must remain outside ProductExperienceShell');
  assert.match(accessSource, /case "INSTALLATION_UNREGISTERED"/u);
  assert.match(accessSource, /if \(!usable\) return/u,
    'unregistered TESTER must see the permission surface without mounting Product children');
  assert.match(guardSource, /pathname\.startsWith\('\/api\/desktop\/'\)/u,
    'DesktopHost local-control endpoints must remain outside human product entitlement');
  assert.match(guardSource, /pathname\.startsWith\('\/api\/'\)/u,
    'all remaining product API routes must remain fail-closed behind personal access');
});
