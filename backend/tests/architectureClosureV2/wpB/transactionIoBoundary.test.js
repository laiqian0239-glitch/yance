'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function coordinatorModule() {
  return require('../../../services/authorityTransactionCoordinator');
}

test('authority coordinator exports a fail-closed transaction I/O guard', () => {
  const { createTransactionIoGuard } = coordinatorModule();
  assert.equal(typeof createTransactionIoGuard, 'function');
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
  const source = require('node:fs').readFileSync(
    require.resolve('../../../services/authorityTransactionCoordinator'),
    'utf8'
  );
  assert.match(source, /createTransactionIoGuard/u);
  assert.doesNotMatch(source, /projector\.apply\([\s\S]*?\bfetch\b/iu);
  assert.doesNotMatch(source, /projector\.apply\([\s\S]*?providerSdk/iu);
  assert.doesNotMatch(source, /projector\.apply\([\s\S]*?platformSdk/iu);
});

test('a Promise returned from a transaction projector remains forbidden', () => {
  const source = require('node:fs').readFileSync(
    require.resolve('../../../services/authorityTransactionCoordinator'),
    'utf8'
  );
  assert.match(source, /AUTHORITY_TRANSACTION_ASYNC_CALLBACK_FORBIDDEN/u);
});
