'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { scanText } = require('../../scripts/security/scan-staged-secrets');

test('ordinary task names containing sk- are not OpenAI key hits', () => {
  const result = scanText('backend/services/contextAwareReplyBrain.js', "logger.warn('reply-task-cancel-persist-failed')");
  assert.equal(result.critical.length, 0);
});

test('contract names containing PASSWORD are not secret assignments', () => {
  const result = scanText('shared/core/contracts.js', "ACCOUNT_TELEGRAM_PASSWORD: 'account.telegram.password'");
  assert.equal(result.critical.length, 0);
  assert.equal(result.advisory.length, 0);
});

test('provider-shaped OpenAI key literals fail in every path', () => {
  const providerPrefix = ['s', 'k'].join('');
  const providerToken = `${providerPrefix}-abcdefghijklmnopqrstuvwxyz123456`;
  const result = scanText('tests/example.test.js', `const key = '${providerToken}'`);
  assert.equal(result.critical.length, 1);
  assert.equal(result.critical[0].type, 'OPENAI_KEY');
});

test('obvious test credentials are advisory instead of hard failures', () => {
  const result = scanText('backend/tests/example.test.js', "const request = { apiKey: 'test-openrouter-key' }");
  assert.equal(result.critical.length, 0);
  assert.equal(result.advisory.length, 1);
});

test('quoted credentials in production source fail closed', () => {
  const result = scanText('backend/services/provider.js', "const request = { apiKey: 'not-persisted' }");
  assert.equal(result.critical.length, 1);
  assert.equal(result.critical[0].type, 'SECRET_ASSIGNMENT');
});

test('private key headers always fail', () => {
  const header = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
  const result = scanText('tests/example.test.js', header);
  assert.equal(result.critical.length, 1);
  assert.equal(result.critical[0].type, 'PRIVATE_KEY');
});
