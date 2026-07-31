'use strict';
// P0-A / Phase 3a — backend decision()-layer focus gating (OD-003 DI-2=A).
// Verifies that the active-conversation suppression only fires when the
// window is focused, and that `focused` is accepted + persisted by update().
const assert = require('node:assert');
const np = require('../../backend/services/notificationPolicy.js');

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
  process.exit(0);
})().catch(err => {
  console.error('\nPhase 3a backend focus-gating FAILED:');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
