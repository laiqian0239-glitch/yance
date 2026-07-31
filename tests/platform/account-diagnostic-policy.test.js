'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluateAccountDiagnostic } = require('../../backend/services/accountDiagnosticPolicy');

function row(id, pass = true) { return { id, name: id, pass, detail: pass ? 'ok' : 'failed' }; }

test('diagnostic cannot be healthy when a platform-critical receive capability fails', () => {
  const tests = ['metadata','credentials','service','session','receive','send','sync','notifications','route'].map(id => row(id, id !== 'receive'));
  const result = evaluateAccountDiagnostic('whatsapp', tests);
  assert.equal(result.ok, false);
  assert.equal(result.criticalReady, false);
  assert.equal(result.health, '需要处理');
  assert.deepEqual(result.criticalFailures.map(item => item.id), ['receive']);
});

test('facebook permissions and webhook subscription are critical', () => {
  const tests = ['metadata','credentials','service','session','permissions','subscription','receive','send','sync','notifications','route'].map(id => row(id, id !== 'subscription'));
  const result = evaluateAccountDiagnostic('facebook', tests);
  assert.equal(result.ok, false);
  assert.equal(result.criticalReady, false);
  assert.deepEqual(result.criticalFailures.map(item => item.id), ['subscription']);
});

test('non-critical notification preference produces basic usable rather than healthy', () => {
  const tests = ['metadata','credentials','service','session','receive','send','sync','notifications','route'].map(id => row(id, id !== 'notifications'));
  const result = evaluateAccountDiagnostic('telegram', tests);
  assert.equal(result.ok, false);
  assert.equal(result.criticalReady, true);
  assert.equal(result.health, '基本可用');
});
