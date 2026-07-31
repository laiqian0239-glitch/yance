'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runScenarios } = require('./helpers/fix6dComputedStyleProbe');

let cached;
function metrics() {
  if (!cached) {
    cached = runScenarios([
      { route: 'system', width: 1680, height: 900, notificationCount: 0 },
      { route: 'system', width: 1680, height: 900, notificationCount: 4 },
      { route: 'system', width: 1680, height: 900, notificationCount: 5 }
    ]);
  }
  return cached;
}

test('FIX6D notification overlay stays below titlebar and outside Windows controls', () => {
  const [base, notices] = metrics();
  assert.equal(notices.notificationStyle.position, 'fixed');
  assert.ok(notices.notification.y >= notices.titlebar.bottom + 6, `${notices.notification.y} vs ${notices.titlebar.bottom}`);
  assert.ok(notices.notification.right <= notices.viewport.width - 142, `${notices.notification.right}`);
  assert.ok(Math.abs(base.app.height - notices.app.height) <= 1);
  assert.ok(Math.abs(base.workspace.height - notices.workspace.height) <= 1);
});

test('FIX6D notification authority exposes two live notices plus one overflow summary', () => {
  const notices = metrics()[2];
  assert.equal(notices.notificationItems, 2);
  assert.equal(notices.notificationSummaryCount, 3);
  assert.equal(notices.notificationChildren, 3);
});
