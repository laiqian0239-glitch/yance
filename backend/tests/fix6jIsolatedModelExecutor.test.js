'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { executeIsolatedModel } = require('../services/isolatedModelExecutor');

test('cloud execution uses only explicit snapshot values', async () => {
  const calls = [];
  const result = await executeIsolatedModel(
    { provider: 'cloud', endpoint: 'https://api.example/v1', modelName: 'provider-model', modelId: 'cloud-1', credential: { apiKey: 'canary' } },
    [{ role: 'user', content: 'hello' }], { timeoutMs: 1234 }, null,
    { cloud: { async chat(input) { calls.push(input); return { text: 'ok' }; } }, ollama: { async streamChat() { throw new Error('wrong client'); } } }
  );
  assert.deepEqual(result, { text: 'ok' });
  assert.deepEqual(calls, [{ endpoint: 'https://api.example/v1', apiKey: 'canary', model: 'provider-model', messages: [{ role: 'user', content: 'hello' }], options: { timeoutMs: 1234 }, signal: null }]);
});

test('ollama execution never needs a credential object', async () => {
  const result = await executeIsolatedModel(
    { provider: 'ollama', endpoint: 'http://127.0.0.1:11434', modelName: 'qwen', modelId: 'local-1' }, [], {}, null,
    { cloud: { async chat() { throw new Error('wrong client'); } }, ollama: { async streamChat(input) { assert.equal('credential' in input, false); return { text: 'local' }; } } }
  );
  assert.deepEqual(result, { text: 'local' });
});

test('unsupported provider is rejected without invoking either client', async () => {
  let calls = 0;
  const clients = { cloud: { async chat() { calls += 1; } }, ollama: { async streamChat() { calls += 1; } } };
  await assert.rejects(executeIsolatedModel({ provider: 'sqlite-provider' }, [], {}, null, clients), error => error.code === 'UNSUPPORTED_MODEL_PROVIDER');
  assert.equal(calls, 0);
});
