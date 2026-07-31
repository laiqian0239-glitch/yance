'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { recentCoreFailures, buildReleaseReadiness } = require('../../backend/services/systemReleaseReadiness');

test('recent SQLite and account lifecycle failures are critical release signals', () => {
  const failures = recentCoreFailures({ productionDiagnostics: { recent: [
    { type: 'operation-failed', command: 'account.connect', code: 'ERR_SQLITE_ERROR', message: 'cannot start a transaction within a transaction' },
    { type: 'operation-failed', command: 'account.logout', code: 'ACCOUNT_LOGOUT_FAILED' }
  ] } });
  assert.equal(failures.length, 2);
  assert.ok(failures.every(row => row.severity === 'critical'));
});


test('a later successful real operation resolves an older failure', () => {
  const failures = recentCoreFailures({ productionDiagnostics: { recent: [
    { type: 'operation-completed', command: 'account.connect', resource: 'wa-1', ok: true },
    { type: 'operation-failed', command: 'account.connect', resource: 'wa-1', code: 'ACCOUNT_CONNECT_FAILED' }
  ] } });
  assert.equal(failures.length, 0);
});

test('a passing SQLite probe resolves an old SQLite log without deleting the log', () => {
  const failures = recentCoreFailures({
    recentErrors: [{ message: 'ERR_SQLITE_ERROR', detail: { error: 'cannot start a transaction within a transaction' } }],
    diagnostics: { tests: [{ id: 'sqlite-store', status: 'pass' }] }
  });
  assert.equal(failures.length, 0);
});

test('release readiness separates source, runtime, platform and Windows final layers', () => {
  const result = buildReleaseReadiness({
    health: { criticalCount: 0, highCount: 0, fail: 0 },
    integrity: { failed: 0 },
    accounts: { rows: [] },
    coreFailures: [],
    sourcePreReviewPassed: true,
    windowsUatAuthorized: true,
    windowsFinalPassed: false
  });
  assert.equal(result.ready, false);
  assert.equal(result.layers.find(row => row.id === 'source-pre-review').status, 'pass');
  assert.equal(result.layers.find(row => row.id === 'platform-verification').status, 'skipped');
  assert.equal(result.layers.find(row => row.id === 'windows-final').status, 'skipped');
});

test('credentialReady false and waiting verification block platform verification', () => {
  const result = buildReleaseReadiness({
    health: { criticalCount: 0, highCount: 0, fail: 0 }, integrity: { failed: 0 }, coreFailures: [],
    sourcePreReviewPassed: true, windowsUatAuthorized: true, windowsFinalPassed: true,
    accounts: { rows: [{ id: 'wa-1', platform: 'whatsapp', state: 'waiting-verification', credentialReady: false }] }
  });
  assert.equal(result.layers.find(row => row.id === 'platform-verification').status, 'fail');
  assert.equal(result.ready, false);
});

test('all verified layers are required before release can be ready', () => {
  const result = buildReleaseReadiness({
    health: { criticalCount: 0, highCount: 0, fail: 0 }, integrity: { failed: 0 }, coreFailures: [],
    sourcePreReviewPassed: true, windowsUatAuthorized: true, windowsFinalPassed: true,
    accounts: { rows: [{ id: 'wa-1', platform: 'whatsapp', state: 'connected', credentialReady: true }] }
  });
  assert.equal(result.ready, true);
  assert.equal(result.blockers.length, 0);
});


test('a core error newer than a successful probe remains blocking', () => {
  const now = Date.now();
  const failures = recentCoreFailures({
    recentErrors: [{ at: new Date(now + 1000).toISOString(), message: 'ERR_SQLITE_ERROR', detail: { error: 'database write failed' } }],
    diagnostics: { tests: [{ id: 'sqlite-store', status: 'pass', checkedAt: now }] }
  });
  assert.equal(failures.length, 1);
});

test('non-core error logs do not manufacture a release blocker', () => {
  const failures = recentCoreFailures({
    recentErrors: [{ message: 'optional thumbnail cache miss', detail: { error: 'cache miss' } }],
    diagnostics: { tests: [] }
  });
  assert.equal(failures.length, 0);
});


test('unresolved WhatsApp QR connection closure remains a critical blocker', () => {
  const failures = recentCoreFailures({
    recentErrors: [{ channel: 'whatsapp', message: 'connection-closed', detail: { message: 'QR refs attempts ended' } }],
    diagnostics: { tests: [] }
  });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].severity, 'critical');
});
