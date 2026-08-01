'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6j-host-fork-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.WORKBUDDY_DATA_DIR = dataRoot;
process.env.YANCE_LEGACY_DATA_DIR = path.join(dataRoot, 'legacy');

const { startModelExecution } = require('../services/modelExecutionHost');
const { verifyModelExecutionEnvelope } = require('../services/modelExecutionEnvelopeAuthority');

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

function fakeChildFactory(observe) {
  return (_workerPath, _args, forkOptions) => {
    observe.forkCount += 1;
    observe.forkOptions = forkOptions;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 4242;
    child.connected = true;
    child.send = message => {
      observe.messages.push(message);
      if (message.type === 'execute') {
        queueMicrotask(() => {
          child.emit('message', {
            type: 'result',
            executionId: message.envelope?.executionId,
            result: { ok: true }
          });
          child.connected = false;
          child.emit('exit', 0, null);
        });
      }
    };
    child.kill = () => true;
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
}

test('missing credential fails before fork and before evidence persistence', () => {
  const observe = { forkCount: 0, evidenceWrites: 0, messages: [] };
  let thrown;
  try {
    startModelExecution({
      model: { id: 'cloud-missing', provider: 'cloud', name: 'gpt', credentialRef: 'private-ref' },
      task: 'translation',
      messages: [],
      childProcessFactory: fakeChildFactory(observe),
      evidenceWriter: async () => { observe.evidenceWrites += 1; },
      resolveExecutionSpec() {
        throw Object.assign(new Error('Cloud model credential is unavailable'), {
          code: 'MODEL_CREDENTIAL_MISSING', status: 400
        });
      }
    });
  } catch (error) {
    thrown = error;
  }

  assert.equal(thrown?.code, 'MODEL_CREDENTIAL_MISSING');
  assert.equal(observe.forkCount, 0);
  assert.equal(observe.evidenceWrites, 0);
  assert.equal(JSON.stringify(thrown).includes('private-ref'), false);
});

test('valid input creates and verifies exactly one envelope before fork', async () => {
  const observe = { forkCount: 0, evidenceWrites: 0, messages: [] };
  const qualificationReceipt = {
    schemaVersion: 1, authority: 'AIRoleQualificationReceiptAuthority',
    receiptId: 'role-fixture', modelId: 'cloud-valid', task: 'translation', pass: true
  };
  const routeReceipt = {
    schemaVersion: 1, authority: 'AIQualityRouteAuthority',
    selectedModelId: 'cloud-valid', task: 'translation', receiptHash: 'route-fixture'
  };
  const handle = startModelExecution({
    executionId: 'exec-task4',
    correlationId: 'corr-task4',
    task: 'translation',
    model: {
      id: 'cloud-valid', provider: 'cloud', name: 'gpt',
      roleQualificationReceipts: { translation: qualificationReceipt }
    },
    messages: [{ role: 'user', content: 'hello' }],
    options: { timeoutMs: 5000, routeReceipt },
    childProcessFactory: fakeChildFactory(observe),
    evidenceWriter: async () => { observe.evidenceWrites += 1; },
    readSystemPolicy: () => ({
      emergencyStop: false, privacyMode: false,
      operatingModeAuthority: 'test', sourceVersion: 7
    }),
    now: () => new Date('2026-08-01T05:00:00.000Z'),
    resolveExecutionSpec: () => ({
      provider: 'cloud', endpoint: 'https://provider.invalid/v1',
      modelName: 'gpt', modelId: 'cloud-valid', credential: { apiKey: 'task4-secret' }
    })
  });

  assert.equal(observe.forkCount, 1);
  await handle.spawned;
  assert.equal(observe.messages.length, 1);
  assert.deepEqual(Object.keys(observe.messages[0]).sort(), ['envelope', 'type']);
  assert.equal(observe.messages[0].type, 'execute');
  const envelope = verifyModelExecutionEnvelope(observe.messages[0].envelope);
  assert.equal(envelope.executionId, 'exec-task4');
  assert.deepEqual(envelope.routeReceipt, routeReceipt);
  assert.deepEqual(envelope.qualificationReceipt, qualificationReceipt);
  assert.equal(observe.forkOptions.env.YANCE_PROCESS_ROLE, 'model-execution-worker');
  assert.equal(observe.forkOptions.env.YANCE_SQLITE_ACCESS, 'forbidden');
  assert.equal(observe.forkOptions.env.YANCE_MODEL_EXECUTION_ID, 'exec-task4');
  assert.deepEqual(await handle.result, { ok: true });
  await handle.exit;
  assert.equal(observe.evidenceWrites, 1);
});
