'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6j-host-evidence-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.WORKBUDDY_DATA_DIR = dataRoot;
process.env.YANCE_LEGACY_DATA_DIR = path.join(dataRoot, 'legacy');

const { startModelExecution } = require('../services/modelExecutionHost');

test.after(async () => {
  try { require('../lib/r32StoreSingleton').closeR32Store(); } catch (_) {}
  let lastError = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(dataRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  throw lastError;
});

function childFactory(script) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 6006;
    child.connected = true;
    child.send = message => script(child, message);
    child.kill = signal => {
      queueMicrotask(() => child.emit('exit', null, signal));
      return true;
    };
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
}

function hostInput(overrides = {}) {
  const credentialRef = 'credential-ref-private';
  return {
    executionId: overrides.executionId || 'evidence-exec',
    correlationId: overrides.correlationId || 'evidence-correlation',
    task: 'translation',
    model: { id: 'evidence-model', provider: 'cloud', name: 'fixture', credentialRef },
    messages: [],
    options: { timeoutMs: 5000 },
    readSystemPolicy: () => ({ emergencyStop: false, privacyMode: false, sourceVersion: 9 }),
    resolveExecutionSpec: () => ({
      provider: 'cloud', endpoint: 'https://provider.invalid/v1', modelName: 'fixture',
      modelId: 'evidence-model', credential: { apiKey: 'api-key-private' }
    }),
    ...overrides
  };
}

test('worker dependency closure never imports the host evidence store', () => {
  const workerSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'modelExecutionWorker.js'), 'utf8');
  assert.equal(workerSource.includes('modelExecutionEvidenceStore'), false);
});

test('repeated provider/result messages produce one privacy-safe host receipt with envelope metadata', async () => {
  const receipts = [];
  const factory = childFactory((child, message) => {
    if (message.type !== 'execute') return;
    const executionId = message.envelope.executionId;
    child.emit('message', { type: 'started', executionId });
    child.emit('message', { type: 'provider-request', executionId, providerRequestId: 'provider-1' });
    child.emit('message', { type: 'provider-request', executionId, providerRequestId: 'provider-1' });
    child.emit('message', { type: 'result', executionId, providerRequestId: 'provider-1', result: { text: 'ok' } });
    child.emit('message', { type: 'result', executionId, providerRequestId: 'provider-1', result: { text: 'duplicate' } });
    child.stdout.emit('data', 'Authorization: Bearer api-key-private');
    child.stderr.emit('data', 'credential-ref-private api-key-private');
    queueMicrotask(() => child.emit('exit', 0, null));
  });
  const handle = startModelExecution(hostInput({
    childProcessFactory: factory,
    evidenceWriter: receipt => { receipts.push(receipt); }
  }));
  await handle.result;
  const receipt = await handle.exit;

  assert.equal(receipts.length, 1);
  assert.equal(receipt.envelopeSchemaVersion, 1);
  assert.match(receipt.envelopeDigest, /^[a-f0-9]{64}$/u);
  assert.equal(receipt.policySnapshotVersion, 9);
  const persistedShape = require('../services/modelExecutionEvidenceStore').sanitize(receipt);
  assert.equal(persistedShape.envelopeSchemaVersion, 1);
  assert.equal(persistedShape.envelopeDigest, receipt.envelopeDigest);
  assert.equal(persistedShape.policySnapshotVersion, 9);
  const serialized = JSON.stringify(receipt);
  for (const secret of ['api-key-private', 'credential-ref-private', 'Authorization', 'Bearer']) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test('caller cancellation and deadline timeout retain distinct host reason codes', async () => {
  const hanging = childFactory((child, message) => {
    if (message.type === 'execute') child.emit('message', { type: 'started', executionId: message.envelope.executionId });
    if (message.type === 'terminate') queueMicrotask(() => child.emit('exit', null, 'SIGTERM'));
  });
  const cancelled = startModelExecution(hostInput({
    executionId: 'cancelled-exec', childProcessFactory: hanging, terminationGraceMs: 10,
    evidenceWriter: () => {}
  }));
  await cancelled.started;
  cancelled.requestTermination({ code: 'MODEL_CANCELLED', abortSource: 'caller' });
  cancelled.result.catch(() => {});
  const cancelledReceipt = await cancelled.exit;

  const timedOut = startModelExecution(hostInput({
    executionId: 'timeout-exec', childProcessFactory: hanging, terminationGraceMs: 10,
    evidenceWriter: () => {}
  }));
  await timedOut.started;
  timedOut.requestTermination({ code: 'AI_EXECUTION_TIMEOUT', abortSource: 'deadline' });
  timedOut.result.catch(() => {});
  const timeoutReceipt = await timedOut.exit;

  assert.equal(cancelledReceipt.terminationClass, 'caller-abort');
  assert.equal(cancelledReceipt.terminationReason, 'MODEL_CANCELLED');
  assert.equal(timeoutReceipt.terminationClass, 'timeout');
  assert.equal(timeoutReceipt.terminationReason, 'AI_EXECUTION_TIMEOUT');
});

test('worker error and receipt serialization redact credential material', async () => {
  const receipts = [];
  const factory = childFactory((child, message) => {
    if (message.type !== 'execute') return;
    const executionId = message.envelope.executionId;
    child.emit('message', { type: 'started', executionId });
    child.emit('message', {
      type: 'error', executionId,
      error: {
        code: 'PROVIDER_ERROR',
        message: 'Bearer api-key-private',
        details: { authorization: 'Bearer api-key-private', credentialRef: 'credential-ref-private' }
      }
    });
    queueMicrotask(() => child.emit('exit', 1, null));
  });
  const handle = startModelExecution(hostInput({
    childProcessFactory: factory,
    evidenceWriter: receipt => { receipts.push(receipt); }
  }));
  let error;
  try { await handle.result; } catch (caught) { error = caught; }
  await handle.exit;
  const serialized = JSON.stringify({ error, receipts });
  for (const secret of ['api-key-private', 'credential-ref-private', 'Authorization', 'Bearer']) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});
