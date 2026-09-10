'use strict';
// P0-A / Phase 3a — backend decision()-layer focus gating (OD-003 DI-2=A).
// Verifies that the active-conversation suppression only fires when the
// window is focused, and that `focused` is accepted + persisted by update().
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-p0-notification-focus-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.WORKBUDDY_DATA_DIR = dataRoot;
process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET = '1';

const { acquireAuthorityWriteHost } = require('../../backend/services/authorityWriteHost');
const {
  createSqliteConnectionBroker,
  resetSqliteConnectionBrokerForTests
} = require('../../backend/lib/sqliteConnectionBroker');
const { closeR32Store } = require('../../backend/lib/r32StoreSingleton');

const dbPath = path.join(dataRoot, 'store', 'yance-r32.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const authorityWriteHost = acquireAuthorityWriteHost({
  dbPath,
  instanceId: `p0-notification-focus-${process.pid}`
});

createSqliteConnectionBroker({
  dbPath,
  authorityWriteHostCapability: authorityWriteHost.capability
});

const np = require('../../backend/services/notificationPolicy.js');

function cleanup() {
  try { closeR32Store(); } catch (_) {}
  try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
  try { authorityWriteHost.close(); } catch (_) {}
  try { fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch (_) {}
  delete process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET;
  delete process.env.WORKBUDDY_DATA_DIR;
  delete process.env.YANCE_DATA_DIR;
}

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('  [ok] ' + name);
}

(async () => {
  // Baseline: no active conversation => allowed.
  check('default decision allows when nothing active', () => {
    const r = np.decision({ conversationId: 'X' });
    assert.strictEqual(r.allow, true);
    assert.strictEqual(r.reason, 'allowed');
  });

  // DI-2=A: suppression requires focused === true.
  await np.update({ activeConversationId: 'X', focused: true });
  check('focused + active conversation => suppressed (active-conversation)', () => {
    const r = np.decision({ conversationId: 'X' });
    assert.strictEqual(r.allow, false);
    assert.strictEqual(r.reason, 'active-conversation');
  });

  check('focused + different conversation => allowed', () => {
    const r = np.decision({ conversationId: 'Y' });
    assert.strictEqual(r.allow, true);
  });

  // The core OD-003 divergence fix: NOT focused => do NOT suppress even if active.
  await np.update({ activeConversationId: 'X', focused: false });
  check('NOT focused + active conversation => allowed (DI-2=A)', () => {
    const r = np.decision({ conversationId: 'X' });
    assert.strictEqual(r.allow, true);
    assert.strictEqual(r.reason, 'allowed');
  });

  // update() must accept + persist `focused`.
  check('update() persists focused flag', () => {
    assert.strictEqual(np.read().focused, false);
    assert.strictEqual(np.read().activeConversationId, 'X');
  });

  // focused flips back to true and suppresses again.
  await np.update({ focused: true });
  check('reflip focused=true re-suppresses active conversation', () => {
    const r = np.decision({ conversationId: 'X' });
    assert.strictEqual(r.allow, false);
    assert.strictEqual(r.reason, 'active-conversation');
  });

  // Restore neutral state for any later tests.
  await np.update({ activeConversationId: '', focused: false });

  console.log('\nPhase 3a backend focus-gating: ' + passed + '/' + passed + ' passed');
  cleanup();
  process.exit(0);
})().catch(err => {
  console.error('\nPhase 3a backend focus-gating FAILED:');
  console.error(err && err.stack ? err.stack : err);
  cleanup();
  process.exit(1);
});
