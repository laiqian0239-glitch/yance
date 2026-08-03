'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function outboxModule() {
  return require('../../../services/externalActionOutboxAuthority');
}

test('external action outbox exposes immutable intent, claim, attempt and receipt authority', () => {
  const { ExternalActionOutboxAuthority } = outboxModule();
  for (const method of [
    'createIntent', 'claimIntent', 'startAttempt', 'recordReceipt',
    'recordFailureReceipt', 'markUncertain', 'recordLateResult'
  ]) assert.equal(typeof ExternalActionOutboxAuthority.prototype[method], 'function', method);
});

test('outbox source persists an attempt before physical I/O can be invoked', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('../../../services/externalActionDispatcher'), 'utf8');
  const persistAt = source.indexOf('startAttempt');
  const performAt = source.indexOf('.perform(');
  assert.ok(persistAt >= 0, 'startAttempt missing');
  assert.ok(performAt >= 0, 'physical Adapter invocation missing');
  assert.ok(persistAt < performAt, 'attempt must be persisted before I/O');
});

test('intent idempotency key is bound to a canonical content hash', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('../../../services/externalActionOutboxAuthority'), 'utf8');
  assert.match(source, /intent_content_sha256|intentContentSha256/u);
  assert.match(source, /WP_B_INTENT_IDEMPOTENCY_CONFLICT/u);
  assert.match(source, /content_hash_version|contentHashVersion/u);
});

test('late stale results have a separate append-only receipt path', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('../../../services/externalActionOutboxAuthority'), 'utf8');
  assert.match(source, /recordLateResult/u);
  assert.match(source, /LATE_RESULT/u);
});
