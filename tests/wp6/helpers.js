'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createAuthorityHarness } = require('../wp5/helpers');
const { AppRuntime } = require('../../backend/runtime/AppRuntime');
const { LifecycleStateMachine } = require('../../backend/runtime/LifecycleStateMachine');
const { ApiV2RuntimeClient } = require('../../electron/desktopHost/ApiV2RuntimeClient');
const { RuntimeProjectionCoordinator } = require('../../electron/desktopHost/RuntimeProjectionCoordinator');

function uuid(seed = '') {
  const hex = crypto.createHash('sha256').update(String(seed || Math.random())).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

function runtimeSnapshot(overrides = {}) {
  const stateVersion = Number(overrides.stateVersion || 5);
  const operatingModeRevision = Number(overrides.operatingModeRevision || Math.min(3, stateVersion));
  const lastEventSequence = Number(overrides.lastEventSequence ?? 7);
  return {
    contractVersion: 2,
    buildId: overrides.buildId || 'wp6-test-build',
    stateVersion,
    lastEventSequence,
    generatedAtUtc: '2026-07-05T00:00:00.000Z',
    runtime: {
      lifecycleState: overrides.lifecycleState || 'running',
      operatingMode: overrides.operatingMode || 'normal',
      operatingModeRevision,
      ownerInstanceId: overrides.ownerInstanceId || 'owner-1',
      fencingToken: Number(overrides.fencingToken || 1),
      localReady: overrides.localReady !== false
    },
    capabilities: { network: 'online' },
    diagnosticsSummary: {},
    credentialHydration: null,
    localCriticalWorkers: {},
    externalWorkers: {}
  };
}

function backendBinding(overrides = {}) {
  return {
    running: overrides.running !== false,
    apiSessionEstablished: overrides.apiSessionEstablished !== false,
    ownerTrusted: overrides.ownerTrusted === true,
    backendPid: Number(overrides.backendPid || 1100),
    startupNonce: overrides.startupNonce || 'nonce-1',
    backendSessionId: overrides.backendSessionId || 'backend-session-1',
    fd6PipeInstanceId: overrides.fd6PipeInstanceId || 'fd6-1',
    ownerSessionId: overrides.ownerSessionId || 'owner-session-1',
    apiSessionToken: overrides.apiSessionToken || 'token-secret-1'
  };
}

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

function createClientHarness(options = {}) {
  let binding = backendBinding(options.binding || {});
  const calls = [];
  const snapshots = Array.isArray(options.snapshots) ? [...options.snapshots] : [runtimeSnapshot(options.snapshot || {})];
  const eventBatches = Array.isArray(options.eventBatches) ? [...options.eventBatches] : [];
  const defaultFetch = async (url, init = {}) => {
    if (url.includes('/snapshot')) return jsonResponse(snapshots.length > 1 ? snapshots.shift() : snapshots[0]);
    if (url.includes('/events')) return jsonResponse(eventBatches.length ? eventBatches.shift() : {
      contractVersion: 2, buildId: 'wp6-test-build', fromSequenceExclusive: Number(new URL(url).searchParams.get('afterSequence') || 0), lastAvailableSequence: Number(new URL(url).searchParams.get('afterSequence') || 0), events: []
    });
    if (url.includes('/commands')) {
      const body = JSON.parse(init.body || '{}');
      return jsonResponse({ contractVersion: 2, commandId: body.commandId, accepted: true, duplicate: false, stateVersion: body.expectedStateVersion + 1, resultingEventSequence: 8, reasonCode: null, result: {} });
    }
    return jsonResponse({ ok: false, reasonCode: 'NOT_FOUND' }, 404);
  };
  const implementationFetch = options.fetch || defaultFetch;
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    return implementationFetch(url, init);
  };
  const sessionProvider = () => ({ ...binding });
  const client = new ApiV2RuntimeClient({ baseURL: 'http://127.0.0.1:3000', fetch, sessionProvider, expectedBuildId: 'wp6-test-build', timeoutMs: 1000, randomUUID: () => uuid(`call-${calls.length}`), clock: () => '2026-07-05T00:00:00.000Z' });
  return { client, calls, get binding() { return binding; }, setBinding(next) { binding = { ...binding, ...next }; } };
}

function createProjectionHarness(options = {}) {
  const clientHarness = options.clientHarness || createClientHarness(options);
  let backend = { ...clientHarness.binding };
  delete backend.apiSessionToken;
  const coordinator = new RuntimeProjectionCoordinator({
    client: clientHarness.client,
    backendSnapshot: () => ({ ...backend }),
    expectedBuildId: 'wp6-test-build',
    pollIntervalMs: 50,
    clock: () => '2026-07-05T00:00:00.000Z'
  });
  return {
    ...clientHarness,
    coordinator,
    get backend() { return backend; },
    setBackend(next) { backend = { ...backend, ...next }; clientHarness.setBinding(next); }
  };
}

async function createRuntimeHarness(options = {}) {
  const authority = await createAuthorityHarness({ buildId: 'wp6-test-build' });
  const lifecycle = new LifecycleStateMachine({ store: authority.store, ownership: authority.ownership, buildId: 'wp6-test-build' });
  lifecycle.state = 'local_ready';
  const runtime = new AppRuntime({ ownership: authority.ownership, store: authority.store, lifecycle, buildId: 'wp6-test-build', onStopRequested: options.onStopRequested || (() => {}) });
  const sideEffects = [];
  runtime.composition = {
    accountContext: {
      online: async () => sideEffects.push('online'),
      offline: async () => sideEffects.push('offline'),
      pause: async () => sideEffects.push('pause'),
      resume: async () => sideEffects.push('resume'),
      enterSafeMode: async () => sideEffects.push('enterSafeMode'),
      exitSafeMode: async () => sideEffects.push('exitSafeMode'),
      execute: async () => ({ ok: true })
    },
    eventBus: { publish: () => true },
    productionDiagnostics: { beginOperation: () => '', completeOperation: () => true, failOperation: () => true },
    participants: [],
    logger: { warn() {}, info() {}, error() {} }
  };
  runtime.productionServicesStarted = true;
  return { authority, lifecycle, runtime, sideEffects, async close() { await authority.close(); } };
}

function read(relative) { return fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8'); }
function tempRoot(prefix = 'yance-wp6-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

module.exports = { backendBinding, createClientHarness, createProjectionHarness, createRuntimeHarness, jsonResponse, read, runtimeSnapshot, tempRoot, uuid };
