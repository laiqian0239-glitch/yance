'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAvailability, buildTopology } = require('../../backend/services/systemHealthProjection');

test('recent core failures prevent a false 100 percent availability state', () => {
  const result = buildAvailability({ pass: 10, fail: 0, warning: 0, skipped: 0, executed: 10, tests: new Array(10) }, [{ code: 'ERR_SQLITE_ERROR' }]);
  assert.equal(result.online, false);
  assert.equal(result.level, 'degraded');
  assert.equal(result.blockingFailures, 1);
  assert.ok(result.score < 100);
});

test('AI topology is online only when at least one model is routing eligible', () => {
  const report = { tests: [{ id: 'event-bus', pass: true, detail: '' }, { id: 'message-store', pass: true, detail: '' }] };
  const common = [{ total: 0, connected: 0, abnormal: 0 }, { latest: null }, { enabled: true, paused: false }, { emergencyStop: false }];
  const topology = buildTopology(report, common[0], { online: true, count: 2, verified: 2, routingEligible: 0 }, common[1], common[2], common[3]);
  const ai = topology.nodes.find(row => row.id === 'ai');
  assert.equal(ai.state, 'warning');
  assert.match(ai.detail, /不可路由/);
});
