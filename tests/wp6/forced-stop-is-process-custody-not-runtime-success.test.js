'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('./helpers');

test('forced process custody is never reported as successful runtime stop', () => {
  const main = read('electron/main.js');
  assert.match(main, /forcedProcessCustody:\s*runtimeStop\.confirmed\s*!==\s*true/);
  assert.match(main, /runtimeSuccessReported:\s*runtimeStop\.confirmed\s*===\s*true/);
  assert.match(main, /WP6_RUNTIME_STOP_UNCONFIRMED/);
});
