'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const COORDINATOR_PATH = path.join(
  REPO_ROOT,
  'backend',
  'services',
  'authorityTransactionCoordinator.js'
);

function coordinatorModule() {
  assert.equal(fs.existsSync(COORDINATOR_PATH), true, COORDINATOR_PATH);
  delete require.cache[require.resolve(COORDINATOR_PATH)];
  return require(COORDINATOR_PATH);
}

test('authority coordinator exports a fail-closed transaction I/O guard', () => {
  const { createTransactionIoGuard } = coordinatorModule();
  assert.equal(
    typeof createTransactionIoGuard,
    'function',
    'WP_B_CREATE_TRANSACTION_IO_GUARD_MISSING'
  );
  const guard = createTransactionIoGuard();
  for (const capability of [
    'network', 'providerSdk', 'platformSdk', 'filesystemTransfer',
    'sleep', 'remoteTimer', 'userWait'
  ]) {
    assert.throws(
      () => guard.assertAllowed(capability),
      error => error?.code === 'AUTHORITY_TRANSACTION_EXTERNAL_IO_FORBIDDEN'
    );
  }
});

test('projector context exposes no external I/O capability', () => {
  const source = fs.readFileSync(COORDINATOR_PATH, 'utf8');
  assert.match(source, /createTransactionIoGuard/u);
  assert.doesNotMatch(source, /projector\.apply\([\s\S]*?\bfetch\b/iu);
  assert.doesNotMatch(source, /projector\.apply\([\s\S]*?providerSdk/iu);
  assert.doesNotMatch(source, /projector\.apply\([\s\S]*?platformSdk/iu);
});

test('a Promise returned from a transaction projector remains forbidden', () => {
  const source = fs.readFileSync(COORDINATOR_PATH, 'utf8');
  assert.match(source, /AUTHORITY_TRANSACTION_ASYNC_CALLBACK_FORBIDDEN/u);
});
