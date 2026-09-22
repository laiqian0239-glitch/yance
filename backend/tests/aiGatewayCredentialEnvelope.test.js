'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { credentialEnvelope } = require('../services/aiGateway');

test('credential envelope uses the gateway credential authority instead of an unbound this', () => {
  const credentials = new Map([
    ['model:openrouter:default', { apiKey: 'test-key', endpoint: 'https://openrouter.ai/api/v1' }]
  ]);
  const authority = { credentials };
  const rows = credentialEnvelope([{
    id: 'cloud-openrouter-test',
    name: 'openai/gpt-test',
    modelName: 'openai/gpt-test',
    endpoint: 'https://openrouter.ai/api/v1',
    credentialRef: 'model:openrouter:default'
  }], authority);
  assert.deepEqual(rows, {
    'model:openrouter:default': {
      apiKey: 'test-key',
      endpoint: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-test'
    }
  });
});