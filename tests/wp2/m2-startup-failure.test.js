'use strict';

const test = require('node:test');
const assert = require('node:assert');
const sf = require('../../electron/m2/startupFailure');

test('createStartupFailure: 强制字段齐全', () => {
  const f = sf.createStartupFailure({
    errorCode: 'M2_BACKEND_STARTUP_FAILED',
    phase: 'LAUNCH',
    severity: 'fatal',
    recoverable: false,
    userMessageKey: 'startup.failed.launch',
    developerMessage: 'backend spawn failed',
    logPath: 'C:/Users/x/logs/app.log',
    startupAttemptId: 'att-1',
    backendPid: 0,
    source: 'M2_LAUNCH'
  });
  for (const field of sf.REQUIRED_FIELDS) {
    assert.ok(field in f, `missing field: ${field}`);
  }
  assert.strictEqual(f.moduleOwner, 'M2');
  assert.strictEqual(f.schemaVersion, 1);
});

test('createStartupFailure: errorCode 缺失抛错', () => {
  assert.throws(() => sf.createStartupFailure({ phase: 'LAUNCH' }), /errorCode required/);
});

test('createStartupFailure: reasonCode 必须 == errorCode', () => {
  assert.throws(
    () => sf.createStartupFailure({ errorCode: 'A', reasonCode: 'B' }),
    /reasonCode.*must equal errorCode/
  );
  const f = sf.createStartupFailure({ errorCode: 'A', reasonCode: 'A' });
  assert.strictEqual(f.reasonCode, 'A');
});

test('脱敏：敏感字段被 [REDACTED]', () => {
  const f = sf.createStartupFailure({
    errorCode: 'M2_BACKEND_STARTUP_FAILED',
    phase: 'LAUNCH',
    severity: 'fatal',
    credential: 'super-secret',
    apiSessionToken: 'tok-123',
    developerMessage: 'ok'
  });
  f.nested = { password: 'pw', safe: 'x' };
  const safe = sf.redactSensitive(f);
  assert.strictEqual(safe.credential, '[REDACTED]');
  assert.strictEqual(safe.apiSessionToken, '[REDACTED]');
  assert.strictEqual(safe.nested.password, '[REDACTED]');
  assert.strictEqual(safe.nested.safe, 'x');
});

test('serializeForRenderer 不含敏感字段', () => {
  const f = sf.createStartupFailure({
    errorCode: 'M2_BACKEND_STARTUP_FAILED',
    phase: 'LAUNCH',
    severity: 'fatal',
    credential: 'secret'
  });
  const out = sf.serializeForRenderer(f);
  assert.strictEqual(out.errorCode, 'M2_BACKEND_STARTUP_FAILED');
  assert.strictEqual(out.credential, undefined);
});

test('5 个出口适配器返回各自 errorCode', () => {
  assert.strictEqual(sf.preChildFailure({}).errorCode, 'M2_BACKEND_LAUNCH_PRE_CHILD_FAILED');
  assert.strictEqual(sf.launchFailure({}).errorCode, 'M2_BACKEND_STARTUP_FAILED');
  assert.strictEqual(sf.trustedReadyTimeoutFailure({}).errorCode, 'M2_TRUSTED_READY_TIMEOUT');
  assert.strictEqual(sf.packagedPathResolutionFailure({}).errorCode, 'M2_PACKAGED_LAUNCH_PATH_UNRESOLVED');
  assert.strictEqual(sf.backendExitedWhileReadyFailure({}).errorCode, 'M2_BACKEND_EXITED_WHILE_READY');
});

test('trustedReadyTimeout / backendExited 为可恢复', () => {
  assert.strictEqual(sf.trustedReadyTimeoutFailure({}).recoverable, true);
  assert.strictEqual(sf.backendExitedWhileReadyFailure({}).recoverable, true);
  assert.strictEqual(sf.launchFailure({}).recoverable, false);
});
