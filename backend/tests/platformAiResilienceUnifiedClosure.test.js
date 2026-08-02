'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JobQueue } = require('../services/jobQueue');
const { resolveQueueTimeoutMs } = require('../services/aiGateway');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const replyPerformancePolicy = require('../services/replyPerformancePolicy');
const routing = require('../services/modelRoutingIntegrityService');
const roleReceipts = require('../services/aiRoleQualificationReceiptAuthority');
const syncCheckpoint = require('../repositories/syncCheckpointRepository');
const localRepairRepository = require('../repositories/localPersistenceRepairRepository');

const ROOT = path.resolve(__dirname, '..', '..');
const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function translationModel(id, provider) {
  const evidence = { authority: 'YanceCommercialModelBenchmark', status: 'COMMERCIAL_MODEL_QUALIFIED', testedAt: '2026-07-31T10:00:00.000Z', completed: true, pass: true, score: 95, qualifyingTasks: ['translation'], translationScore: 95 };
  return {
    id, name: id, provider, available: true, qualification: 'verified', allowedTasks: ['translation'], callCount: 1,
    lastCommercialBenchmark: evidence,
    roleQualificationReceipts: { translation: roleReceipts.issueFromEvidence({ modelId: id, task: 'translation', evidence, expiresAt: '2030-01-01T00:00:00.000Z' }) }
  };
}

test('large local reply modes retain three-to-four minute budgets and explicit three minutes is never clamped', () => {
  assert.equal(replyPerformancePolicy.MODES.rapid.timeoutMs, 180000);
  assert.equal(replyPerformancePolicy.MODES.balanced.timeoutMs, 180000);
  assert.equal(replyPerformancePolicy.MODES.deep.timeoutMs, 240000);
  assert.equal(replyPerformancePolicy.generationOptions({ timeoutMs: 180000 }).options.timeoutMs, 180000);
  assert.equal(replyPerformancePolicy.generationOptions({ timeoutMs: 300000 }).options.timeoutMs, 300000);
});

test('AI queue wait budgets cannot expire before slow local-model execution budgets', () => {
  assert.equal(resolveQueueTimeoutMs('quick_reply'), 180000);
  assert.equal(resolveQueueTimeoutMs('deep_reply'), 240000);
  assert.equal(resolveQueueTimeoutMs('translation', { background: true }), 300000);
  assert.equal(resolveQueueTimeoutMs('quick_reply', { options: { timeoutMs: 300000 } }), 300000);
  assert.equal(resolveQueueTimeoutMs('quick_reply', { queueTimeoutMs: 5000 }), 180000);
  assert.equal(resolveQueueTimeoutMs('deep_reply', { queueTimeoutMs: 15000, options: { timeoutMs: 300000 } }), 300000);
  assert.equal(resolveQueueTimeoutMs('quick_reply', { queueTimeoutMs: 360000 }), 360000);
});

test('context-aware reply generation does not reintroduce a 15-second queue timeout', () => {
  const replySource = source('backend/services/contextAwareReplyBrain.js');
  assert.doesNotMatch(replySource, /queueTimeoutMs\s*:\s*15000/u);
});

test('automatic translation routing is cloud-quality-first unless local-only is explicitly selected', () => {
  const models = [
    translationModel('translategemma:4b', 'ollama'),
    translationModel('cloud-translation', 'openai-compatible')
  ];
  const qualityFirst = routing.repairRegistryDocument({
    models,
    routes: { translation: { enabled: true, primarySelection: 'auto', fallbackSelection: 'auto' } }
  });
  assert.equal(qualityFirst.document.routes.translation.primary, 'cloud-translation');
  assert.equal(qualityFirst.document.routes.translation.fallback, 'translategemma:4b');
  assert.equal(qualityFirst.document.routes.translation.allowCloudFallback, true);

  const localOnly = routing.repairRegistryDocument({
    models,
    routes: { translation: { enabled: true, primarySelection: 'auto', fallbackSelection: 'auto', allowCloudFallback: false } }
  });
  assert.equal(localOnly.document.routes.translation.primary, 'translategemma:4b');
  assert.equal(localOnly.document.routes.translation.fallback, '');
  assert.equal(localOnly.document.routes.translation.allowCloudFallback, false);
});

test('AI queue runs interactive priority before background work once a slot opens', async () => {
  const queue = new JobQueue({ concurrency: 1, name: 'priority-test' });
  const order = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = queue.add(async () => { order.push('running'); await gate; }, { priority: 0 });
  await sleep(5);
  const background = queue.add(async () => { order.push('background'); }, { priority: 10 });
  const interactive = queue.add(async () => { order.push('interactive'); }, { priority: 100 });
  release();
  await Promise.all([first.promise, background.promise, interactive.promise]);
  assert.deepEqual(order, ['running', 'interactive', 'background']);
});

test('AI queue reserves one execution slot for interactive work when background jobs are busy', async () => {
  const queue = new JobQueue({ concurrency: 2, name: 'reserved-slot-test', reservedHighPrioritySlots: 1, highPriorityThreshold: 70 });
  let releaseBackground;
  const backgroundGate = new Promise(resolve => { releaseBackground = resolve; });
  let secondBackgroundStarted = false;
  let interactiveStarted = false;
  const first = queue.add(() => backgroundGate, { priority: 20 });
  const second = queue.add(async () => { secondBackgroundStarted = true; }, { priority: 20 });
  await sleep(10);
  assert.equal(secondBackgroundStarted, false);
  const interactive = queue.add(async () => { interactiveStarted = true; }, { priority: 100 });
  await interactive.promise;
  assert.equal(interactiveStarted, true);
  assert.equal(secondBackgroundStarted, false);
  releaseBackground();
  await Promise.all([first.promise, second.promise]);
  assert.equal(secondBackgroundStarted, true);
});

test('AI queue rejects a task that never starts before its queue deadline', async () => {
  const queue = new JobQueue({ concurrency: 1, name: 'timeout-test' });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const running = queue.add(() => gate, { priority: 0 });
  const waiting = queue.add(async () => 'never', { priority: 0, queueTimeoutMs: 20 });
  await assert.rejects(waiting.promise, error => error.code === 'AI_QUEUE_TIMEOUT');
  release();
  await running.promise;
});

test('WhatsApp durable receipts are scoped by conversation while other platforms keep their contract', () => {
  const first = syncCheckpoint.receiptRemoteKey('whatsapp', 'remote-id', 'account:chat-a');
  const second = syncCheckpoint.receiptRemoteKey('whatsapp', 'remote-id', 'account:chat-b');
  assert.notEqual(first, second);
  assert.equal(syncCheckpoint.receiptRemoteKey('facebook', 'remote-id', 'account:chat-a'), 'remote-id');
});

test('backend announces core readiness before starting AI enhancement services', () => {
  const server = source('backend/server.js');
  const ready = server.indexOf('const readySignal = announceReady()');
  const enhancement = server.indexOf('// AI is an enhancement layer.');
  assert.ok(ready >= 0 && enhancement > ready);
  assert.doesNotMatch(server.slice(0, ready), /aiReplyOutboxService\.start\(\)|aiAutomation\.start\(\)/);
  assert.match(server.slice(enhancement), /setImmediate\(\(\) =>/);
  assert.match(server.slice(enhancement), /coreMessagingAvailable: true/);
});

test('automatic translation accepts both inbound and outbound foreign-language messages while history backfill remains background work', () => {
  const translation = source('backend/services/messageTranslationService.js');
  assert.match(translation, /if \(message\?\.id && translationEligibleMessage\(message\) && translatableText\(message\)\)/);
  assert.match(translation, /this\.enqueue\(message\.id, \{ background: true, timeoutMs: TRANSLATION_MODEL_TIMEOUT_MS \}\)/);
  assert.match(translation, /translationWorkKey/);
  assert.match(translation, /translationSourceHash/);
  assert.match(translation, /timeoutMs: options\.timeoutMs \|\| TRANSLATION_MODEL_TIMEOUT_MS/);
});

test('platform delivery and local persistence are separate and send work is isolated by platform plus account', () => {
  const queue = source('backend/services/sendQueueService.js');
  const repair = source('backend/services/localPersistenceRepairService.js');
  const repairRepository = source('backend/repositories/localPersistenceRepairRepository.js');
  assert.match(queue, /const lane = `\$\{clean\(row\.payload\.platform/);
  assert.match(queue, /Promise\.all\(\[\.\.\.lanes\.values\(\)\]/);
  assert.match(queue, /send-queue:local-persistence-pending/);
  assert.match(queue, /WAITING_CONNECTION_ERRORS/);
  assert.match(repair, /kind === 'outbound-media-upsert'/);
  assert.match(repair, /kind === 'message-receipt'/);
  assert.match(repair, /repository\.recoverInterrupted\(\)/);
  assert.match(repairRepository, /WHERE state='running'/);
});

test('interrupted local persistence repairs are requeued after backend restart', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-local-repair-recovery-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'store.db') });
  try {
    const repair = localRepairRepository.enqueue({ id: 'repair-interrupted', payload: { kind: 'message-upsert', message: { id: 'm1' } } }, store);
    assert.equal(repair.state, 'pending');
    store.db.prepare("UPDATE local_persistence_repairs SET state='running' WHERE id=?").run(repair.id);
    assert.equal(localRepairRepository.recoverInterrupted(store), 1);
    const recovered = localRepairRepository.get(repair.id, store);
    assert.equal(recovered.state, 'retry');
    assert.match(recovered.lastError, /LOCAL_REPAIR_INTERRUPTED/);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('AI activity is a warning rather than an update-install blocker', () => {
  const preflight = source('backend/services/updatePreflightService.js');
  assert.match(preflight, /warnings\.push\(\{ id: 'ai-active'/);
  assert.doesNotMatch(preflight, /blockers\.push\(\{ id: 'ai-active'/);
});

test('model circuit state survives backend restart and successful calls clear it', () => {
  const gateway = source('backend/services/aiGateway.js');
  const registry = source('backend/services/modelRegistry.js');
  assert.match(gateway, /loadPersistedCircuits\(\)/);
  assert.match(gateway, /model\.circuitOpenedUntil/);
  assert.match(gateway, /recordInvocationFailure\(model\.id, error, \{[\s\S]*countForCircuit: recovery\.countsForCircuit === true,[\s\S]*cooldownUntil: nextRetryAt \|\| ''/);
  assert.match(gateway, /noteCooldown\(model\.id, normalized\.retryAfterMs\)/);
  assert.match(registry, /consecutiveFailureCount/);
  assert.match(registry, /circuitOpenedUntil/);
  assert.match(registry, /consecutiveFailureCount: 0/);
});
