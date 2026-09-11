'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { startModelExecution } = require('../services/modelExecutionHost');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6g-telemetry-root-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.WORKBUDDY_DATA_DIR = dataRoot;
process.env.NODE_ENV = 'test';
process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET = '1';
const { acquireAuthorityWriteHost } = require('../services/authorityWriteHost');
const { createSqliteConnectionBroker, resetSqliteConnectionBrokerForTests } = require('../lib/sqliteConnectionBroker');
const brokerDbPath = path.join(dataRoot, 'store', 'yance-r32.db');
fs.mkdirSync(path.dirname(brokerDbPath), { recursive: true });
const authorityWriteHost = acquireAuthorityWriteHost({ dbPath: brokerDbPath, instanceId: `fix6g-telemetry-${process.pid}` });
createSqliteConnectionBroker({ dbPath: brokerDbPath, authorityWriteHostCapability: authorityWriteHost.capability });
const { closeR32Store } = require('../lib/r32StoreSingleton');

test.after(() => {
  try { closeR32Store(); } catch (_) {}
  try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
  try { authorityWriteHost.close(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET;
});

function worker(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6g-worker-'));
  const workerPath = path.join(root, 'worker.js');
  fs.writeFileSync(workerPath, `'use strict';\n${source}\n`, 'utf8');
  return { root, workerPath, childProcessFactory: (_productionPath, args, options) => fork(workerPath, args, options) };
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) freezeDeep(value[key]);
  }
  return value;
}

function startFixtureExecution(fixture, overrides = {}) {
  const executionId = overrides.executionId || 'exec-fix6g-telemetry';
  return startModelExecution({
    task: 'translation',
    model: { id: 'fixture-model', provider: 'ollama', name: 'fixture-model' },
    messages: [],
    persistedAttempt: freezeDeep({
      executionId,
      intentId: overrides.intentId || 'intent-fix6g-telemetry',
      attemptId: overrides.attemptId || 'attempt-fix6g-telemetry',
      idempotencyKey: overrides.idempotencyKey || 'idem-fix6g-telemetry',
      ownerId: 'owner-fix6g-telemetry',
      claimId: 'claim-fix6g-telemetry',
      generation: 1,
      hostGeneration: 1,
      fencingToken: 1,
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
      request: { task: 'translation', modelName: 'fixture-model' }
    }),
    childProcessFactory: fixture.childProcessFactory,
    ...overrides
  });
}

async function settle(handle) {
  let value = null;
  let error = null;
  try { value = await handle.result; } catch (caught) { error = caught; }
  const receipt = await handle.exit;
  return { value, error, receipt };
}

test('successful isolated execution emits a non-terminated receipt with provider request evidence', async () => {
  const fixture = worker(`
process.once('message', message => {
  const executionId = message.envelope.executionId;
  process.send({ type: 'started', executionId });
  process.send({ type: 'provider-request', executionId, providerRequestId: 'gen-request-123' });
  process.send({ type: 'result', executionId, result: { text: 'ok', requestId: 'gen-request-123' } }, () => process.exit(0));
});`);
  try {
    const handle = startFixtureExecution(fixture, { model: { id: 'm1', provider: 'ollama', name: 'm1' }, correlationId: 'corr-success' });
    const { value, error, receipt } = await settle(handle);
    assert.equal(error, null);
    assert.deepEqual(value, { text: 'ok', requestId: 'gen-request-123' });
    assert.equal(receipt.terminated, false);
    assert.equal(receipt.workerStarted, true);
    assert.equal(receipt.lastWorkerMessageType, 'result');
    assert.equal(receipt.providerRequestId, 'gen-request-123');
    assert.equal(receipt.correlationId, 'corr-success');
    assert.equal(receipt.terminationClass, 'completed');
    assert.equal(receipt.terminationReason, 'MODEL_EXECUTION_COMPLETED');
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('started resolves only after the worker emits its execution-ready envelope', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6g-worker-ready-'));
  const readyPath = path.join(root, 'process-ready');
  const releasePath = path.join(root, 'release-started');
  const workerPath = path.join(root, 'worker.js');
  fs.writeFileSync(workerPath, `'use strict';
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(readyPath)}, 'ready');
process.once('message', message => {
  const executionId = message.envelope.executionId;
  const timer = setInterval(() => {
    if (!fs.existsSync(${JSON.stringify(releasePath)})) return;
    clearInterval(timer);
    process.send({ type: 'started', executionId });
    setInterval(() => {}, 1000);
  }, 5);
});
`, 'utf8');
  try {
    const fixture = { childProcessFactory: (_productionPath, args, options) => fork(workerPath, args, options) };
    const handle = startFixtureExecution(fixture, { model: { id: 'm-ready', provider: 'ollama', name: 'm-ready' }, terminationGraceMs: 20 });
    let startedSettled = false;
    handle.started.finally(() => { startedSettled = true; });
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(readyPath) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(fs.existsSync(readyPath), true, 'worker process never reached fixture readiness');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(startedSettled, false, 'started must not resolve at process spawn before worker readiness');
    fs.writeFileSync(releasePath, 'go');
    const startReceipt = await handle.started;
    assert.equal(startReceipt.workerStarted, true);
    await handle.requestTermination(Object.assign(new Error('test complete'), { code: 'MODEL_CANCELLED', abortSource: 'caller' }));
    await assert.rejects(handle.result, error => error.code === 'MODEL_EXECUTION_TERMINATED');
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('non-zero worker exit preserves bounded stderr and exit classification', async () => {
  const fixture = worker(`
process.once('message', message => {
  process.send({ type: 'started', executionId: message.envelope.executionId });
  process.stderr.write('provider transport exploded\\nsecret=should-not-be-special-cased\\n');
  setTimeout(() => process.exit(7), 5);
});`);
  try {
    const handle = startFixtureExecution(fixture, { model: { id: 'm2', provider: 'ollama', name: 'm2' }, correlationId: 'corr-error' });
    const { error, receipt } = await settle(handle);
    assert.equal(error.code, 'MODEL_EXECUTION_TERMINATED');
    assert.equal(error.exitCode, 7);
    assert.equal(receipt.exitCode, 7);
    assert.equal(receipt.terminated, true);
    assert.equal(receipt.terminationClass, 'worker-nonzero-exit');
    assert.equal(receipt.terminationReason, 'WORKER_EXIT_CODE_7');
    assert.match(receipt.stderrTail, /provider transport exploded/u);
    assert.ok(receipt.stderrTail.length <= 4096);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('caller abort is distinguishable from timeout and generic termination', async () => {
  const fixture = worker(`
process.once('message', message => {
  process.send({ type: 'started', executionId: message.envelope.executionId });
  setInterval(() => {}, 1000);
});`);
  const controller = new AbortController();
  try {
    const handle = startFixtureExecution(fixture, { model: { id: 'm3', provider: 'ollama', name: 'm3' }, signal: controller.signal, terminationGraceMs: 20 });
    await handle.started;
    controller.abort(Object.assign(new Error('user cancelled benchmark'), { code: 'MODEL_CANCELLED' }));
    const { error, receipt } = await settle(handle);
    assert.equal(error.code, 'MODEL_EXECUTION_TERMINATED');
    assert.equal(receipt.abortSource, 'caller');
    assert.equal(receipt.terminationClass, 'caller-abort');
    assert.equal(receipt.terminationReason, 'MODEL_CANCELLED');
    assert.equal(receipt.workerStarted, true);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('result envelope loss is reported separately from worker failure', async () => {
  const fixture = worker(`
process.once('message', message => {
  process.send({ type: 'started', executionId: message.envelope.executionId }, () => process.exit(0));
});`);
  try {
    const handle = startFixtureExecution(fixture, { model: { id: 'm4', provider: 'ollama', name: 'm4' } });
    const { error, receipt } = await settle(handle);
    assert.equal(error.code, 'MODEL_EXECUTION_TERMINATED');
    assert.equal(receipt.exitCode, 0);
    assert.equal(receipt.terminationClass, 'result-envelope-lost');
    assert.equal(receipt.terminationReason, 'WORKER_EXITED_WITHOUT_RESULT');
    assert.equal(receipt.lastWorkerMessageType, 'started');
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('explicit timeout termination is classified and records the request source', async () => {
  const fixture = worker(`
process.once('message', message => {
  process.send({ type: 'started', executionId: message.envelope.executionId });
  setInterval(() => {}, 1000);
});`);
  try {
    const handle = startFixtureExecution(fixture, { model: { id: 'm5', provider: 'ollama', name: 'm5' }, terminationGraceMs: 20 });
    await handle.started;
    await handle.requestTermination(Object.assign(new Error('deadline exceeded'), { code: 'AI_EXECUTION_TIMEOUT', abortSource: 'deadline' }));
    const { error, receipt } = await settle(handle);
    assert.equal(error.code, 'MODEL_EXECUTION_TERMINATED');
    assert.equal(receipt.abortSource, 'deadline');
    assert.equal(receipt.terminationClass, 'timeout');
    assert.equal(receipt.terminationReason, 'AI_EXECUTION_TIMEOUT');
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('model execution evidence store records recent privacy-safe failures', () => {
  const { spawnSync } = require('node:child_process');
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6g-diagnostics-'));
  const script = String.raw`
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET = '1';
const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fix6g-evidence-broker-'));
const dbPath = path.join(evidenceRoot, 'store', 'yance-r32.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const { acquireAuthorityWriteHost } = require('./backend/services/authorityWriteHost');
const { createSqliteConnectionBroker } = require('./backend/lib/sqliteConnectionBroker');
const host = acquireAuthorityWriteHost({ dbPath, instanceId: 'fix6g-evidence' });
createSqliteConnectionBroker({ dbPath, authorityWriteHostCapability: host.capability });
const evidence = require('./backend/services/modelExecutionEvidenceStore');
const { closeR32Store } = require('./backend/lib/r32StoreSingleton');
(async () => {
  await evidence.append({
    executionId: 'exec-diagnostics-1', correlationId: 'corr-diagnostics-1', modelId: 'model-x', task: 'quick_reply',
    terminated: true, terminationClass: 'worker-nonzero-exit', terminationReason: 'WORKER_EXIT_CODE_7',
    exitCode: 7, stderrTail: 'apiKey=do-not-export'
  });
  const row = evidence.readRecent(20).find(entry => entry.executionId === 'exec-diagnostics-1');
  if (!row) throw new Error('EVIDENCE_RECORD_MISSING');
  if (row.terminationReason !== 'WORKER_EXIT_CODE_7') throw new Error('EVIDENCE_REASON_MISMATCH:' + row.terminationReason);
  if (row.exitCode !== 7) throw new Error('EVIDENCE_EXIT_CODE_MISMATCH:' + row.exitCode);
  if (row.terminated !== true) throw new Error('EVIDENCE_TERMINATED_MISSING');
  if (String(row.stderrTail).includes('do-not-export')) throw new Error('EVIDENCE_SECRET_LEAK');
  closeR32Store();
})().catch(error => { console.error(error); try { closeR32Store(); } catch {} process.exit(1); });`;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '../..'),
    env: { ...process.env, YANCE_DATA_DIR: dataRoot, NODE_ENV: 'test', TERM: 'dumb' },
    encoding: 'utf8', timeout: 120000
  });
  try { assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`); }
  finally { fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
