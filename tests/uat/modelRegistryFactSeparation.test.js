'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { installAuthoritySqliteTestHost } = require('./helpers/authoritySqliteTestHost');
const authoritySqliteTestHost = installAuthoritySqliteTestHost('model-registry-fact-separation');

const registry = require('../../backend/services/modelRegistry');

const modelId = 'cloud-authority-test';

test.after(() => authoritySqliteTestHost.close());

test('qualification and business invocation facts remain independent in real SQLite registry', async () => {
  await registry.write({
    schemaVersion: 1,
    models: [{
      id: modelId,
      name: 'authority-test',
      provider: 'openai-compatible',
      configured: true,
      available: true,
      endpoint: 'https://example.invalid/v1',
      credentialRef: 'model:authority-test',
      qualification: 'verified',
      allowedTasks: ['quick_reply'],
      lastSuccessfulInvocation: { at: '2026-07-22T01:00:00.000Z', returnedModel: 'authority-test' },
      lastInvocationStatus: 'success'
    }],
    routes: { quick_reply: { primary: modelId, fallback: '', enabled: true } },
    history: []
  });

  await registry.recordInvocationFailure(modelId, Object.assign(new Error('Rate limit reached'), { code: 'rate_limit_exceeded', status: 429 }));
  let model = registry.read().models.find(row => row.id === modelId);
  assert.equal(model.lastInvocationStatus, 'failed');
  assert.equal(model.lastInvocationErrorCode, 'rate_limit_exceeded');
  assert.equal(model.lastSuccessfulInvocation.returnedModel, 'authority-test');
  assert.notEqual(model.connectivityStatus, 'failed', 'business invocation failure must not rewrite qualification connectivity');

  await registry.recordTest(modelId, {
    qualification: 'verified',
    allowedTasks: ['quick_reply'],
    testedAt: '2026-07-22T01:05:00.000Z',
    connectivity: { pass: true, status: 200 }
  });
  model = registry.read().models.find(row => row.id === modelId);
  assert.equal(model.lastQualificationAttemptStatus, 'success');
  assert.equal(model.connectivityStatus, 'passed');
  assert.equal(model.lastInvocationStatus, 'failed', 'qualification success must not erase the latest business invocation failure');
  assert.equal(model.lastInvocationErrorCode, 'rate_limit_exceeded');
  assert.equal(model.lastSuccessfulInvocation.returnedModel, 'authority-test');

  await registry.recordInvocation(modelId, { returnedModel: 'authority-test', totalMs: 120, totalTokens: 32 });
  model = registry.read().models.find(row => row.id === modelId);
  assert.equal(model.lastInvocationStatus, 'success');
  assert.equal(model.lastInvocationError, '');
  assert.equal(model.lastQualificationAttemptStatus, 'success');
  assert.equal(model.connectivityStatus, 'passed');
  assert.equal(model.callCount, 1);
});
