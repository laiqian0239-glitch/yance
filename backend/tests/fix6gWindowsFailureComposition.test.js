'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork, spawnSync } = require('node:child_process');
const routingIntegrity = require('../services/modelRoutingIntegrityService');
const { startModelExecution } = require('../services/modelExecutionHost');
const executionEvidence = require('../services/modelExecutionEvidenceStore');
const replyBrainAuthority = require('../services/replyBrainModelAuthority');
const roleReceipts = require('../services/aiRoleQualificationReceiptAuthority');

function conditionalModel(id, provider, score) {
  return {
    id,
    name: id,
    modelSlug: `${provider}/${id}`,
    provider,
    qualification: 'verified',
    available: true,
    allowedTasks: ['quick_reply', 'deep_reply', 'director'],
    lastSuccessAt: '2026-07-31T12:00:00.000Z',
    lastReplyBrainBenchmark: {
      authority: 'YanceReplyBrainBenchmark',
      status: 'REPLY_BRAIN_FAILED',
      testedAt: '2026-07-31T12:00:00.000Z',
      completed: true,
      pass: false,
      score,
      qualifyingTasks: [],
      scenarios: []
    }
  };
}

function routeFacts(route) {
  return {
    requested: route.requested,
    resolved: route.resolved,
    resolutionState: route.resolutionState,
    primary: route.primary,
    fallback: route.fallback,
    primarySelection: route.primarySelection,
    fallbackSelection: route.fallbackSelection
  };
}

test('legacy FIX6F manual-primary and auto-fallback route migrates deterministically to V2', () => {
  const legacy = {
    primary: 'claude-opus-5',
    fallback: 'gpt-5.6-sol',
    requestedPrimary: 'claude-opus-5',
    requestedFallback: 'gpt-5.6-sol',
    primarySelection: 'manual',
    fallbackSelection: 'auto',
    enabled: true,
    allowConditional: true,
    humanReviewRequired: true
  };

  const once = routingIntegrity.normalizeRoute(legacy, 'quick_reply');
  const twice = routingIntegrity.normalizeRoute(once, 'quick_reply');

  assert.deepEqual(routeFacts(twice), routeFacts(once));
  assert.deepEqual(once.requested.primary, { mode: 'manual', modelId: 'claude-opus-5' });
  assert.deepEqual(once.requested.fallback, { mode: 'auto', modelId: '' });
  assert.equal(once.resolved.fallback.modelId, 'gpt-5.6-sol');
  assert.equal(once.fallbackSelection, 'auto');
});

test('Windows route sequence keeps auto fallback intent, resolves GPT across providers, and ignores unrelated stale routes', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6g-windows-route-'));
  const script = String.raw`
const registry = require('./backend/services/modelRegistry');
const { closeR32Store } = require('./backend/lib/r32StoreSingleton');
const model = (id, provider, score) => ({
  id, name: id, modelSlug: provider + '/' + id, provider,
  qualification: 'verified', available: true,
  allowedTasks: ['quick_reply', 'deep_reply', 'director'],
  lastSuccessAt: '2026-07-31T12:00:00.000Z',
  lastReplyBrainBenchmark: {
    authority: 'YanceReplyBrainBenchmark', status: 'REPLY_BRAIN_FAILED',
    testedAt: '2026-07-31T12:00:00.000Z', completed: true, pass: false,
    score, qualifyingTasks: [], scenarios: []
  }
});
(async () => {
  await registry.write({
    schemaVersion: 3,
    models: [model('claude-opus-5', 'anthropic', 82), model('gpt-5.6-sol', 'openai', 80)],
    routes: {
      summary: { primary: 'missing-summary-model', primarySelection: 'manual', enabled: true }
    },
    history: []
  });
  await registry.setRoute('quick_reply', {
    primary: 'claude-opus-5', primarySelection: 'manual',
    fallback: 'gpt-5.6-sol', fallbackSelection: 'manual',
    enabled: true, allowConditional: true, humanReviewRequired: true
  });
  const state = await registry.setRoute('quick_reply', {
    schemaVersion: 2,
    requested: {
      enabled: true,
      primary: { mode: 'manual', modelId: 'claude-opus-5' },
      fallback: { mode: 'auto', modelId: '' }
    },
    allowConditional: true,
    humanReviewRequired: true
  });
  const route = state.routes.quick_reply;
  if (route.requested.fallback.mode !== 'auto') throw new Error('AUTO_FALLBACK_INTENT_LOST');
  if (route.requested.fallback.modelId !== '') throw new Error('AUTO_FALLBACK_PINNED_TO_OLD_MODEL');
  if (route.resolved.primary.modelId !== 'claude-opus-5') throw new Error('PRIMARY_NOT_RESOLVED');
  if (route.resolved.primary.provider !== 'anthropic') throw new Error('PRIMARY_PROVIDER_NOT_PROJECTED');
  if (route.resolved.fallback.modelId !== 'gpt-5.6-sol') throw new Error('GPT_AUTO_FALLBACK_NOT_RESOLVED');
  if (route.resolved.fallback.provider !== 'openai') throw new Error('FALLBACK_PROVIDER_NOT_PROJECTED');
  if (route.resolutionState !== 'READY') throw new Error('ROUTE_NOT_READY:' + route.resolutionState);
  if (state.routes.summary.primary !== 'missing-summary-model') throw new Error('UNRELATED_STALE_ROUTE_MUTATED');
  closeR32Store();
})().catch(error => { console.error(error); try { closeR32Store(); } catch {} process.exit(1); });`;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '../..'),
    env: { ...process.env, YANCE_DATA_DIR: dataRoot, TERM: 'dumb' },
    encoding: 'utf8',
    timeout: 120000
  });
  try { assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`); }
  finally { fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});



test('automatic recommendation never labels a same-provider model as an independent fallback', () => {
  const evidence = score => ({
    authority: 'YanceReplyBrainBenchmark',
    status: 'REPLY_BRAIN_QUALIFIED',
    testedAt: '2026-07-31T10:00:00.000Z',
    completed: true,
    pass: true,
    score,
    qualifyingTasks: ['quick_reply', 'deep_reply', 'director'],
    scenarios: []
  });
  const model = (id, score) => {
    const benchmark = evidence(score);
    return {
      id,
      name: id,
      provider: 'ollama',
      qualification: 'verified',
      available: true,
      allowedTasks: ['quick_reply', 'deep_reply', 'director'],
      lastTest: { scores: { persona: { pass: true }, hallucination: { pass: true }, json: { pass: true } } },
      lastReplyBrainBenchmark: benchmark,
      roleQualificationReceipts: Object.fromEntries(['quick_reply', 'deep_reply', 'director'].map(task => [
        task,
        roleReceipts.issueFromEvidence({ modelId: id, task, evidence: benchmark, expiresAt: '2030-01-01T00:00:00.000Z' })
      ]))
    };
  };

  const recommendation = replyBrainAuthority.recommendedReplyRoutes([
    model('local-main', 94),
    model('local-backup', 90)
  ]);

  assert.equal(recommendation.routes.quick_reply.primary, 'local-main');
  assert.equal(recommendation.routes.quick_reply.fallback, '');
  assert.equal(recommendation.pass, false);
});

test('route test response preserves requested and resolved authority facts instead of returning only legacy fields', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/models.js'), 'utf8');
  const start = source.indexOf("router.post('/routes/:task/test'");
  const end = source.indexOf("router.patch('/routes/:task'", start);
  const handler = source.slice(start, end);

  assert.match(handler, /requested:\s*route\.requested/u);
  assert.match(handler, /resolved:\s*route\.resolved/u);
  assert.match(handler, /resolutionState:\s*route\.resolutionState/u);
  assert.match(handler, /reasonCodes:\s*route\.reasonCodes/u);
});

test('terminated route execution projects privacy-safe evidence into the API error contract', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6g-windows-worker-'));
  const workerPath = path.join(root, 'worker.js');
  fs.writeFileSync(workerPath, `'use strict';\nprocess.once('message', message => {\n  process.send({ type: 'started', executionId: message.envelope.executionId });\n  process.stderr.write('provider failed apiKey=top-secret\\n');\n  setTimeout(() => process.exit(9), 5);\n});\n`, 'utf8');
  try {
    const handle = startModelExecution({
      model: conditionalModel('gpt-5.6-sol', 'openai', 80),
      task: 'quick_reply',
      messages: [],
      childProcessFactory: (_productionPath, args, options) => fork(workerPath, args, options),
      resolveExecutionSpec: () => ({
        provider: 'cloud', endpoint: 'https://provider.invalid/v1',
        modelName: 'gpt-5.6-sol', modelId: 'gpt-5.6-sol', credential: { apiKey: 'fixture-key' }
      }),
      correlationId: 'route-test-correlation'
    });
    let error = null;
    try { await handle.result; } catch (caught) { error = caught; }
    const receipt = await handle.exit;
    assert.equal(error.code, 'MODEL_EXECUTION_TERMINATED');
    assert.equal(receipt.terminationClass, 'worker-nonzero-exit');

    const projected = executionEvidence.projectError(error);
    assert.equal(projected.executionId, receipt.executionId);
    assert.equal(projected.correlationId, 'route-test-correlation');
    assert.equal(projected.exitCode, 9);
    assert.equal(projected.terminationClass, 'worker-nonzero-exit');
    assert.equal(projected.terminationReason, 'WORKER_EXIT_CODE_9');
    assert.doesNotMatch(projected.stderrTail, /top-secret/u);

    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    assert.match(server, /modelExecutionEvidence:\s*executionEvidence/u);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
