'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { fork } = require('node:child_process');

const { createModelExecutionEnvelope } = require('../services/modelExecutionEnvelopeAuthority');

const workerPath = path.join(__dirname, '..', 'services', 'modelExecutionWorker.js');

function envelope(endpoint, overrides = {}) {
  return createModelExecutionEnvelope({
    executionId: overrides.executionId || 'worker-envelope',
    correlationId: overrides.correlationId || 'worker-correlation',
    task: 'translation',
    executionSpec: {
      provider: 'cloud', endpoint, modelName: 'fixture-model', modelId: 'fixture-model',
      credential: { apiKey: 'worker-fixture-key' }
    },
    policySnapshot: { schemaVersion: 1, emergencyStop: false },
    routeReceipt: { schemaVersion: 1, selectedModelId: 'fixture-model' },
    qualificationReceipt: { schemaVersion: 1, modelId: 'fixture-model', pass: true },
    messages: [{ role: 'user', content: 'hello' }],
    options: { timeoutMs: 3000 },
    deadlineAt: overrides.deadlineAt || new Date(Date.now() + 30000).toISOString()
  });
}

function runWorker(message, executionId = 'worker-envelope') {
  return new Promise((resolve, reject) => {
    const messages = [];
    const child = fork(workerPath, [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        YANCE_PROCESS_ROLE: 'model-execution-worker',
        YANCE_SQLITE_ACCESS: 'forbidden',
        YANCE_MODEL_EXECUTION_ID: executionId
      }
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('message', value => messages.push(value));
    child.once('error', reject);
    child.once('spawn', () => child.send(message));
    child.once('exit', (code, signal) => resolve({ code, signal, messages, stderr }));
  });
}

test('malformed envelope is rejected before provider invocation', async () => {
  const result = await runWorker({ type: 'execute', envelope: {} });
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.messages.some(message => message.type === 'started'), false);
  assert.equal(result.messages.at(-1)?.error?.code, 'MODEL_EXECUTION_ENVELOPE_INVALID');
});

test('tampered envelope is rejected before provider invocation', async () => {
  const valid = envelope('http://127.0.0.1:1');
  const tampered = JSON.parse(JSON.stringify(valid));
  tampered.messages[0].content = 'tampered';
  const result = await runWorker({ type: 'execute', envelope: tampered });
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.messages.some(message => message.type === 'started'), false);
  assert.equal(result.messages.at(-1)?.error?.code, 'MODEL_EXECUTION_ENVELOPE_INVALID');
});

test('expired envelope is rejected with a deadline error before provider invocation', async () => {
  const expired = envelope('http://127.0.0.1:1', {
    deadlineAt: new Date(Date.now() - 1000).toISOString()
  });
  const result = await runWorker({ type: 'execute', envelope: expired });
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.messages.some(message => message.type === 'started'), false);
  assert.equal(result.messages.at(-1)?.error?.code, 'MODEL_EXECUTION_DEADLINE_EXCEEDED');
});

test('valid envelope starts before provider invocation and preserves correlation/request ids', async t => {
  let providerCalls = 0;
  const server = http.createServer((_request, response) => {
    providerCalls += 1;
    response.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'req-header' });
    response.end(JSON.stringify({
      id: 'req-body-123', model: 'fixture-model',
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  const valid = envelope(`http://127.0.0.1:${address.port}`);
  const result = await runWorker({ type: 'execute', envelope: valid });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(providerCalls, 1);
  assert.deepEqual(result.messages.map(message => message.type), ['started', 'provider-request', 'result']);
  assert.equal(result.messages.every(message => message.correlationId === 'worker-correlation'), true);
  assert.equal(result.messages.at(-1).providerRequestId, 'req-body-123');
});
