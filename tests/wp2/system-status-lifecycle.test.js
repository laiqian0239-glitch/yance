'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const runtime = require(path.join(ROOT, 'frontend/js/r32-system-status-runtime.js'));
const source = fs.readFileSync(path.join(ROOT, 'frontend/js/r32-system-status-runtime.js'), 'utf8');
const ui = fs.readFileSync(path.join(ROOT, 'frontend/js/r32-ui-runtime.js'), 'utf8');
const capabilities = fs.readFileSync(path.join(ROOT, 'frontend/js/r32-conversation-capabilities.js'), 'utf8');
const persona = fs.readFileSync(path.join(ROOT, 'frontend/js/r32-persona-runtime.js'), 'utf8');

test('transient status durations are bounded by default', () => {
  assert.ok(runtime.defaultDuration('success') > 0);
  assert.ok(runtime.defaultDuration('warning') > runtime.defaultDuration('success'));
  assert.ok(runtime.defaultDuration('error') >= runtime.defaultDuration('warning'));
  assert.ok(runtime.defaultDuration('error') <= 10000);
});

test('status runtime clears transient messages on routed workspace changes', () => {
  assert.match(source, /MutationObserver/);
  assert.match(source, /route-change/);
  for (const route of ['contact-page-open', 'profile-page-open', 'timeline-page-open', 'account-center-open', 'system-center-open', 'theme-workspace-open']) {
    assert.ok(source.includes(route), `missing route clear coverage: ${route}`);
  }
  assert.match(source, /current\.retainAcrossRoutes\s*!==\s*true/);
});

test('feature runtimes delegate status ownership to the central lifecycle', () => {
  assert.match(ui, /YanceSystemStatus\?\.show/);
  assert.match(ui, /YanceSystemStatus\?\.clear/);
  assert.match(capabilities, /YanceSystemStatus\?\.show/);
  assert.match(persona, /YanceSystemStatus\?\.show/);
  assert.doesNotMatch(capabilities, /className\s*=\s*['"`]system-status show/);
  assert.doesNotMatch(persona, /className\s*=\s*['"`]system-status show/);
});
