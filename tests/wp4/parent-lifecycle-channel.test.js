'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BOOT_FAILURE_REASON_MESSAGES,
  SERVER_STARTUP_FAILURE_REASON_MESSAGES,
  buildBootFailureLifecycleMessage,
  buildServerStartupFailureLifecycleMessage,
  sanitizeParentLifecycleMessage,
  sendParentLifecycleMessage
} = require('../../backend/bootstrap/parentLifecycleChannel');

const HASH = 'a'.repeat(64);

function hydrated(overrides = {}) {
  return {
    type: 'backend:credential-hydrated',
    pid: 42,
    startupNonce: 'startup-nonce',
    vaultEpoch: 'vault-epoch',
    generation: 7,
    authorityEventId: 'authority-event',
    authorityHeadDigest: HASH,
    vaultReferenceCount: 2,
    decryptedEntryCount: 2,
    frameEntryCount: 2,
    entryCount: 2,
    payloadBytes: 128,
    restoredReferenceCount: 2,
    ...overrides
  };
}

function failed(overrides = {}) {
  return {
    type: 'backend:startup-failed',
    reasonCode: 'NODE_SQLITE_UNAVAILABLE',
    code: 'NODE_SQLITE_UNAVAILABLE',
    phase: 'early-boot',
    message: BOOT_FAILURE_REASON_MESSAGES.NODE_SQLITE_UNAVAILABLE,
    stackHash: HASH,
    causeCodeHash: HASH,
    runtimeSubphase: 'runtime_boot',
    pid: 42,
    ...overrides
  };
}

function serverFailed(overrides = {}) {
  return {
    type: 'backend:startup-failed',
    reasonCode: 'STORE_MANAGER_STARTUP_FAILED',
    code: 'STORE_MANAGER_STARTUP_FAILED',
    phase: 'server-startup',
    message: SERVER_STARTUP_FAILURE_REASON_MESSAGES.STORE_MANAGER_STARTUP_FAILED,
    stackHash: HASH,
    causeCodeHash: HASH,
    runtimeSubphase: 'server_startup',
    pid: 42,
    ...overrides
  };
}

test('parent lifecycle channel emits only the exact approved credential-hydrated projection', () => {
  let observed = null;
  assert.equal(sendParentLifecycleMessage(hydrated(), { sender(message) { observed = message; return true; } }), true);
  assert.deepEqual(observed, hydrated());
  assert.equal(Object.isFrozen(observed), true);
});

test('parent lifecycle channel accepts the bounded early-boot failure diagnostic', () => {
  assert.deepEqual(sanitizeParentLifecycleMessage(failed()), failed());
});

test('parent lifecycle channel accepts the bounded server-startup failure diagnostic', () => {
  assert.deepEqual(sanitizeParentLifecycleMessage(serverFailed()), serverFailed());
});

test('parent lifecycle channel rejects unknown message types and every extra field', () => {
  assert.throws(
    () => sanitizeParentLifecycleMessage({ type: 'backend:arbitrary', pid: 42 }),
    error => error?.reasonCode === 'PARENT_LIFECYCLE_MESSAGE_TYPE_DENIED'
  );
  for (const field of ['secret', 'token', 'credential', 'password', 'entries']) {
    assert.throws(
      () => sanitizeParentLifecycleMessage(hydrated({ [field]: 'forbidden' })),
      error => error?.reasonCode === 'PARENT_LIFECYCLE_MESSAGE_FIELD_DENIED'
    );
  }
});


test('boot-failure builder never exposes Error.message, raw stack, credentials, tokens, session keys, or database content', () => {
  const secret = 'credential=alpha password=bravo token=charlie sessionKey=delta databaseRow=echo';
  const error = new Error(secret);
  error.reasonCode = 'NODE_SQLITE_UNAVAILABLE';
  error.stack = `Error: ${secret}\n    at privateDatabaseRow (${secret})`;
  error.secret = secret;
  error.rawDatabaseRow = { value: secret };

  const message = buildBootFailureLifecycleMessage(error, { pid: 321 });
  assert.deepEqual(Object.keys(message), ['type', 'reasonCode', 'code', 'phase', 'message', 'stackHash', 'causeCodeHash', 'runtimeSubphase', 'pid']);
  assert.equal(message.message, BOOT_FAILURE_REASON_MESSAGES.NODE_SQLITE_UNAVAILABLE);
  assert.equal(message.pid, 321);
  assert.match(message.stackHash, /^[0-9a-f]{64}$/);
  const serialized = JSON.stringify(message);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes(error.stack), false);
  assert.equal(serialized.includes('password=bravo'), false);
  assert.equal(Object.isFrozen(message), true);
});

test('boot-failure causeCodeHash follows the deepest nested reason without exposing raw cause data', () => {
  const deepest = Object.assign(new Error('database row secret'), { reasonCode: 'RUNTIME_PATH_PHYSICAL_IDENTITY_UNAVAILABLE' });
  const middle = Object.assign(new Error('ownership wrapper secret'), { reasonCode: 'BOOT_RUNTIME_OWNERSHIP_FAILED', cause: deepest });
  const outer = Object.assign(new Error('runtime wrapper secret'), {
    reasonCode: 'BOOT_RUNTIME_INITIALIZATION_FAILED',
    failedPhase: 'ownership_acquire',
    cause: middle
  });
  const message = buildBootFailureLifecycleMessage(outer, { pid: 77 });
  const expected = require('node:crypto').createHash('sha256')
    .update('RUNTIME_PATH_PHYSICAL_IDENTITY_UNAVAILABLE', 'utf8').digest('hex');
  assert.equal(message.reasonCode, 'BOOT_RUNTIME_INITIALIZATION_FAILED');
  assert.equal(message.runtimeSubphase, 'ownership_acquire');
  assert.equal(message.causeCodeHash, expected);
  const serialized = JSON.stringify(message);
  assert.equal(serialized.includes('database row secret'), false);
  assert.equal(serialized.includes('ownership wrapper secret'), false);
});

test('boot-failure builder fail-closes unknown reason codes and validates PID as a safe non-negative integer', () => {
  const error = new Error('secret-bearing dynamic message');
  error.reasonCode = 'ATTACKER_CONTROLLED_REASON';
  const message = buildBootFailureLifecycleMessage(error, { pid: 7 });
  assert.equal(message.reasonCode, 'BOOT_DESKTOP_STARTUP_FAILED');
  assert.equal(message.code, 'BOOT_DESKTOP_STARTUP_FAILED');
  assert.equal(message.message, BOOT_FAILURE_REASON_MESSAGES.BOOT_DESKTOP_STARTUP_FAILED);
  for (const pid of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1, '42', null]) {
    assert.throws(
      () => buildBootFailureLifecycleMessage(error, { pid }),
      cause => cause?.reasonCode === 'PARENT_LIFECYCLE_MESSAGE_INVALID'
    );
  }
});

test('server-startup failure builder fail-closes dynamic diagnostics and fixed-fallback reason selection', () => {
  const secret = 'credential=alpha token=bravo sessionKey=charlie databaseRow=delta';
  const error = new Error(secret);
  error.code = 'EADDRINUSE';
  error.stack = `Error: ${secret}\n    at openPrivateDatabase (${secret})`;
  const message = buildServerStartupFailureLifecycleMessage(error, {
    pid: 515,
    reasonCode: 'SERVER_LISTEN_FAILED'
  });
  assert.deepEqual(message, {
    type: 'backend:startup-failed',
    reasonCode: 'SERVER_LISTEN_FAILED',
    code: 'SERVER_LISTEN_FAILED',
    phase: 'server-startup',
    message: SERVER_STARTUP_FAILURE_REASON_MESSAGES.SERVER_LISTEN_FAILED,
    stackHash: require('node:crypto').createHash('sha256').update(error.stack, 'utf8').digest('hex'),
    causeCodeHash: require('node:crypto').createHash('sha256').update('EADDRINUSE', 'utf8').digest('hex'),
    runtimeSubphase: 'server_startup',
    pid: 515
  });
  assert.equal(JSON.stringify(message).includes(secret), false);
  assert.equal(Object.isFrozen(message), true);

  error.reasonCode = 'WP2_PRODUCTION_PATH_PROBE_INCOMPLETE';
  const specific = buildServerStartupFailureLifecycleMessage(error, {
    pid: 516,
    reasonCode: 'WP2_PRODUCTION_PATH_PROBE_FAILED'
  });
  assert.equal(specific.reasonCode, 'WP2_PRODUCTION_PATH_PROBE_INCOMPLETE');
  assert.equal(specific.message, SERVER_STARTUP_FAILURE_REASON_MESSAGES.WP2_PRODUCTION_PATH_PROBE_INCOMPLETE);

  for (const pid of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1, '515', null]) {
    assert.throws(
      () => buildServerStartupFailureLifecycleMessage(error, { pid, reasonCode: 'BACKEND_STARTUP_FAILED' }),
      cause => cause?.reasonCode === 'PARENT_LIFECYCLE_MESSAGE_INVALID'
    );
  }
});

test('startup-failed sanitizer rejects dynamic diagnostics even when field names are otherwise approved', () => {
  const valid = failed();
  const invalid = [
    { ...valid, message: 'password=secret' },
    { ...valid, code: 'BOOT_DESKTOP_STARTUP_FAILED' },
    { ...valid, phase: 'runtime' },
    { ...valid, reasonCode: 'ATTACKER_CONTROLLED_REASON', code: 'ATTACKER_CONTROLLED_REASON' },
    { ...valid, rawError: new Error('secret') },
    { ...valid, secret: 'secret' },
    { ...valid, stackHash: 'raw stack' }
  ];
  for (const payload of invalid) {
    assert.throws(
      () => sanitizeParentLifecycleMessage(payload),
      cause => ['PARENT_LIFECYCLE_MESSAGE_INVALID', 'PARENT_LIFECYCLE_MESSAGE_FIELD_DENIED'].includes(cause?.reasonCode)
    );
  }

  const serverInvalid = [
    { ...serverFailed(), message: 'password=secret' },
    { ...serverFailed(), reasonCode: 'NODE_SQLITE_UNAVAILABLE', code: 'NODE_SQLITE_UNAVAILABLE' },
    { ...serverFailed(), phase: 'early-boot' },
    { ...serverFailed(), startupNonce: 'secret-context' }
  ];
  for (const payload of serverInvalid) {
    assert.throws(
      () => sanitizeParentLifecycleMessage(payload),
      cause => ['PARENT_LIFECYCLE_MESSAGE_INVALID', 'PARENT_LIFECYCLE_MESSAGE_FIELD_DENIED'].includes(cause?.reasonCode)
    );
  }
});

test('production desktop entry cannot bypass the audited parent lifecycle channel', () => {
  const root = path.resolve(__dirname, '../..');
  const entry = fs.readFileSync(path.join(root, 'backend', 'desktopHostedEntry.js'), 'utf8');
  const channel = fs.readFileSync(path.join(root, 'backend', 'bootstrap', 'parentLifecycleChannel.js'), 'utf8');
  assert.equal(/\bprocess\.send\s*\(/.test(entry), false);
  assert.equal((channel.match(/\bprocess\.send\s*\(/g) || []).length, 1);
  assert.match(entry, /sendParentLifecycleMessage/);
});
