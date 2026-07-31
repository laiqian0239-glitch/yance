'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { AppRuntimeFactory } = require('../../backend/runtime/AppRuntimeFactory');
const { BootCoordinator } = require('../../backend/runtime/BootCoordinator');
const { command, temporaryRoot } = require('./helpers');

function coordinator(root) {
  return new BootCoordinator({ context: { buildId: 'WP3-SINGLETON-TEST' }, buildId: 'WP3-SINGLETON-TEST', dataRoot: root });
}

test('failed duplicate coordinator cannot clear or stop the successful AppRuntime singleton', async () => {
  const roots = [temporaryRoot('yance-first-'), temporaryRoot('yance-second-'), temporaryRoot('yance-third-')];
  const first = coordinator(roots[0]);
  const firstRuntime = await first.start();
  const second = coordinator(roots[1]);
  await assert.rejects(second.start(), error => error.reasonCode === 'APP_RUNTIME_ALREADY_EXISTS');
  assert.strictEqual(AppRuntimeFactory.current(), firstRuntime);
  await second.stop('failed-coordinator-cleanup');
  assert.strictEqual(AppRuntimeFactory.current(), firstRuntime);
  const third = coordinator(roots[2]);
  await assert.rejects(third.start(), error => error.reasonCode === 'APP_RUNTIME_ALREADY_EXISTS');
  assert.strictEqual(AppRuntimeFactory.current(), firstRuntime);
  const before = firstRuntime.snapshot();
  const result = firstRuntime.executeCommand(command(before, { commandId: '99999999-9999-4999-8999-999999999999' }));
  assert.equal(result.accepted, true);
  assert.equal(first.ownership.mutex.held, true);
  assert.equal(AppRuntimeFactory.clear(null), false);
  assert.equal(AppRuntimeFactory.clear(undefined), false);
  assert.equal(AppRuntimeFactory.clear({}), false);
  assert.strictEqual(AppRuntimeFactory.current(), firstRuntime);
  await first.stop('test-complete');
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('concurrent coordinators create at most one AppRuntime and failed cleanup preserves the winner', async () => {
  const roots = [temporaryRoot('yance-race-a-'), temporaryRoot('yance-race-b-')];
  const coordinators = roots.map(coordinator);
  const settled = await Promise.allSettled(coordinators.map(row => row.start()));
  assert.equal(settled.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(settled.filter(row => row.status === 'rejected' && row.reason?.reasonCode === 'APP_RUNTIME_ALREADY_EXISTS').length, 1);
  const winnerIndex = settled.findIndex(row => row.status === 'fulfilled');
  const loserIndex = winnerIndex === 0 ? 1 : 0;
  const winner = coordinators[winnerIndex];
  const runtime = settled[winnerIndex].value;
  assert.strictEqual(AppRuntimeFactory.current(), runtime);
  await coordinators[loserIndex].stop('loser-cleanup');
  assert.strictEqual(AppRuntimeFactory.current(), runtime);
  assert.equal(winner.ownership.mutex.held, true);
  await winner.stop('winner-cleanup');
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
