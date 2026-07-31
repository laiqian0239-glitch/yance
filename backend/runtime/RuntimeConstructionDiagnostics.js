'use strict';

const counts = { AppRuntime: 0, LifecycleStateMachine: 0, CoreRuntime: 0, LegacyLifecycleManager: 0 };

function recordConstruction(kind) {
  if (!Object.prototype.hasOwnProperty.call(counts, kind)) counts[kind] = 0;
  counts[kind] += 1;
  return counts[kind];
}

function snapshotConstructionCounts() { return Object.freeze({ ...counts }); }

function resetConstructionCountsForTests() {
  if (process.env.NODE_ENV !== 'test' && process.env.YANCE_TEST_ONLY_RUNTIME_RESET !== '1') throw new Error('Runtime construction diagnostics reset is test-only');
  for (const key of Object.keys(counts)) counts[key] = 0;
}

module.exports = { recordConstruction, resetConstructionCountsForTests, snapshotConstructionCounts };
