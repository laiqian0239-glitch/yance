'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertNoRollback } = require('../../shared/runtimeApiV2Contract');
const { runtimeSnapshot } = require('./helpers');

test('same-owner snapshot cannot roll back state mode revision or fencing', () => {
  const previous = runtimeSnapshot({ stateVersion:9, operatingModeRevision:5, lastEventSequence:12, fencingToken:3 });
  assert.throws(() => assertNoRollback(previous, runtimeSnapshot({ stateVersion:8, operatingModeRevision:5, lastEventSequence:12, fencingToken:3 })), e => e.reasonCode === 'WP6_SNAPSHOT_STATE_ROLLBACK');
  assert.throws(() => assertNoRollback(previous, runtimeSnapshot({ stateVersion:9, operatingModeRevision:4, lastEventSequence:12, fencingToken:3 })), e => e.reasonCode === 'WP6_MODE_REVISION_ROLLBACK');
  assert.throws(() => assertNoRollback(previous, runtimeSnapshot({ stateVersion:9, operatingModeRevision:5, lastEventSequence:12, fencingToken:2 })), e => e.reasonCode === 'WP6_SNAPSHOT_FENCING_INVALID');
});
