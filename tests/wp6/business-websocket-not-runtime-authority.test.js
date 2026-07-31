'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('./helpers');

test('business WebSocket remains separate from persisted runtime authority events', () => {
  const main = read('electron/main.js');
  const coordinator = read('electron/desktopHost/RuntimeProjectionCoordinator.js');
  assert.match(main, /business/i);
  assert.match(coordinator, /getEvents\(this\.baseline\.lastEventSequence/);
  assert.doesNotMatch(coordinator, /WebSocket|\/events['"]/);
});
