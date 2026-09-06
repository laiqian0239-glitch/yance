'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizedEnvironment } = require('../../electron/desktopHost/BackendProcessHost');
const { BOOT_FAILURE_REASON_MESSAGES, buildBootFailureLifecycleMessage, sanitizeParentLifecycleMessage } = require('../../backend/bootstrap/parentLifecycleChannel');

test('backend child environment removes retired YANCE_SAFE_MODE but preserves unrelated threshold controls', () => {
  const sanitized = sanitizedEnvironment({ PATH: 'example', YANCE_SAFE_MODE: '0', YANCE_SAFE_MODE_FINAL_FAILURE_THRESHOLD: '12', YANCE_DATA_DIR: '/tmp/example' });
  assert.equal(Object.hasOwn(sanitized, 'YANCE_SAFE_MODE'), false);
  assert.equal(sanitized.YANCE_SAFE_MODE_FINAL_FAILURE_THRESHOLD, '12');
  assert.equal(sanitized.YANCE_DATA_DIR, '/tmp/example');
});

test('early boot phases expose only fixed safe reason codes and stack hashes', () => {
  for (const reasonCode of ['BOOT_PHASE_0_RESTORE_FAILED', 'BOOT_SQLITE_BROKER_FAILED', 'BOOT_RUNTIME_INITIALIZATION_FAILED', 'BOOT_SERVER_IMPORT_FAILED']) {
    const error = Object.assign(new Error('private internal failure text'), { reasonCode, failedPhase: 'critical_workers_start' });
    const message = sanitizeParentLifecycleMessage(buildBootFailureLifecycleMessage(error, { pid: 123 }));
    assert.equal(message.reasonCode, reasonCode);
    assert.equal(message.message, BOOT_FAILURE_REASON_MESSAGES[reasonCode]);
    assert.equal(message.runtimeSubphase, 'critical_workers_start');
    assert.match(message.stackHash, /^[0-9a-f]{64}$/);
    assert.match(message.causeCodeHash, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(message).includes('private internal failure text'), false);
  }
});

test('desktop hosted backend delegates physical process exclusion to the canonical AuthorityWriteHost', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../backend/desktopHostedEntry.js'),
    'utf8'
  );

  const boot = fs.readFileSync(
    path.resolve(__dirname, '../../backend/runtime/BootCoordinator.js'),
    'utf8'
  );

  const ownership = fs.readFileSync(
    path.resolve(__dirname, '../../backend/runtime/RuntimeOwnership.js'),
    'utf8'
  );

  const authority =
    source.indexOf('acquireAuthorityWriteHost');

  const broker =
    source.indexOf('createSqliteConnectionBroker');

  const runtime =
    source.indexOf('initializeAppRuntime');

  assert.ok(
    authority >= 0 &&
    broker > authority &&
    runtime > broker,
    'AuthorityWriteHost must be the physical exclusion authority before broker/runtime composition'
  );

  assert.doesNotMatch(
    source,
    /new NamedRuntimeMutex|runtimeMutex\.acquire\s*\(/u
  );

  assert.doesNotMatch(
    source,
    /mutex:\s*runtimeMutex/u
  );

  assert.match(
    source,
    /initializeAppRuntime\(\{[\s\S]*?sqliteBroker/u
  );

  assert.match(
    boot,
    /authorityWriteHostCapability:\s*[\s\S]*this\.sqliteBroker\?\.authorityWriteHostCapability/u
  );

  assert.match(
    boot,
    /mutex:\s*this\.sqliteBroker\s*\?\s*undefined\s*:\s*this\.options\.mutex/u
  );

  assert.match(
    ownership,
    /requireAuthorityWriteHostCapability/u
  );

  assert.match(
    ownership,
    /this\.authorityWriteHostCapability[\s\S]*\?\s*null[\s\S]*new NamedRuntimeMutex/u
  );

  assert.match(
    ownership,
    /RUNTIME_PROCESS_EXCLUSION_AUTHORITY_CONFLICT/u
  );
});

test('desktop hosted runtime wrapper preserves the bounded runtime subphase for parent diagnostics', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../backend/desktopHostedEntry.js'), 'utf8');
  assert.match(source, /wrapped\.failedPhase = String\(error\?\.failedPhase/);
  assert.match(source, /BOOT_SERVER_IMPORT_FAILED[^\n]+server_startup/);
});
