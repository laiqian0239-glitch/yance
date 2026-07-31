'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertSnapshot } = require('../../shared/runtimeApiV2Contract');
const { runtimeSnapshot } = require('./helpers');

test('snapshot requires stateVersion operatingModeRevision and lastEventSequence', () => {
  for (const mutate of [
    s => { delete s.stateVersion; },
    s => { delete s.runtime.operatingModeRevision; },
    s => { delete s.lastEventSequence; }
  ]) {
    const snapshot = JSON.parse(JSON.stringify(runtimeSnapshot())); mutate(snapshot);
    assert.throws(() => assertSnapshot(snapshot), e => e.reasonCode === 'WP6_SNAPSHOT_SCHEMA_INVALID');
  }
});
