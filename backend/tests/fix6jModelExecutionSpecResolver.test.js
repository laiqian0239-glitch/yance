'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveModelExecutionSpec } = require('../services/modelExecutionSpecResolver');

test('cloud execution spec contains only the resolved network inputs and is deeply frozen', () => {
  const model = {
    id: 'cloud-1', provider: 'cloud', name: 'gpt-test',
    endpoint: 'https://fallback.invalid/v1', credentialRef: 'cred-1',
    privateRegistryField: 'must-not-cross-ipc'
  };
  const spec = resolveModelExecutionSpec(model, {
    readCredential(ref) {
      assert.equal(ref, 'cred-1');
      return { apiKey: 'fix6j-canary-key', endpoint: 'https://api.example/v1', model: 'provider-model', refreshToken: 'forbidden' };
    }
  });
  assert.deepEqual(spec, {
    provider: 'cloud', endpoint: 'https://api.example/v1',
    modelName: 'provider-model', modelId: 'cloud-1',
    credential: { apiKey: 'fix6j-canary-key' }
  });
  assert.equal(Object.isFrozen(spec), true);
  assert.equal(Object.isFrozen(spec.credential), true);
  assert.equal('credentialRef' in spec, false);
  assert.equal('privateRegistryField' in spec, false);
  assert.equal('refreshToken' in spec.credential, false);
});

test('ollama execution spec does not read or contain credentials', () => {
  let reads = 0;
  const spec = resolveModelExecutionSpec({ id: 'local-1', provider: 'ollama', endpoint: 'http://127.0.0.1:11434', name: 'qwen' }, {
    readCredential() { reads += 1; return { apiKey: 'forbidden' }; }
  });
  assert.deepEqual(spec, { provider: 'ollama', endpoint: 'http://127.0.0.1:11434', modelName: 'qwen', modelId: 'local-1' });
  assert.equal(reads, 0);
});

test('missing cloud credential fails before worker creation can be attempted', () => {
  assert.throws(() => resolveModelExecutionSpec({ id: 'cloud-2', provider: 'cloud', name: 'gpt', credentialRef: 'missing' }, {
    readCredential() { return null; }
  }), error => error.code === 'MODEL_CREDENTIAL_MISSING' && error.status === 400 && !JSON.stringify(error).includes('fix6j-canary-key'));
});
