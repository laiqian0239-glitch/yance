'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const authority = require('../services/replyBrainModelAuthority');
const routing = require('../services/modelRoutingIntegrityService');

function runtimeModel(overrides = {}) {
  return {
    id: 'ministral',
    name: 'ministral-3:14b',
    provider: 'ollama',
    available: true,
    qualification: 'verified',
    allowedTasks: ['understanding', 'summary'],
    callCount: 29,
    lastSuccessfulInvocation: { at: new Date().toISOString() },
    ...overrides
  };
}

function benchmark(score, overrides = {}) {
  return {
    authority: 'YanceReplyBrainBenchmark',
    status: 'REPLY_BRAIN_FAILED',
    completed: true,
    pass: false,
    score,
    testedAt: new Date().toISOString(),
    qualifyingTasks: [],
    scenarios: [],
    ...overrides
  };
}

test('an available Ministral model with real calls is pending, not quality zero, and can be manually trialled', () => {
  const model = authority.projectModel(runtimeModel());
  assert.equal(model.replyTaskQualifications.quick_reply.state, 'pending');
  assert.equal(model.replyTaskQualifications.deep_reply.state, 'pending');
  assert.equal(model.replyTaskQualifications.quick_reply.selectable, true);
  assert.equal(model.replyTaskQualifications.deep_reply.selectable, true);
  assert.ok(model.manualReplySelectableTasks.includes('deep_reply'));
  assert.equal(model.replyBrainRole, 'conditional-reply');
});

test('an old base-qualification-only zero is displayed as pending because chat scenarios never ran', () => {
  const model = authority.projectModel(runtimeModel({
    lastReplyBrainBenchmark: benchmark(0, { status: 'REPLY_BRAIN_BASE_QUALIFICATION_FAILED', scenarios: [], summary: 'old gate' })
  }));
  assert.equal(model.replyTaskQualifications.deep_reply.state, 'pending');
  assert.equal(model.replyTaskQualifications.deep_reply.selectable, true);
  assert.match(model.replyTaskQualifications.deep_reply.reason, /旧版前置资格/);
});

test('task-specific conditional thresholds allow a 60 quick model and a 70 deep model without granting formal qualification', () => {
  const quick = authority.projectModel(runtimeModel({ id: 'qwen9', name: 'qwen3.5:9b', lastReplyBrainBenchmark: benchmark(60) }));
  const deep = authority.projectModel(runtimeModel({ id: 'gemma12', name: 'gemma3:12b', lastReplyBrainBenchmark: benchmark(70) }));
  assert.equal(quick.replyTaskQualifications.quick_reply.state, 'conditional');
  assert.equal(quick.replyTaskQualifications.quick_reply.selectable, true);
  assert.equal(quick.replyTaskQualifications.deep_reply.selectable, false);
  assert.equal(deep.replyTaskQualifications.deep_reply.state, 'conditional');
  assert.equal(deep.replyTaskQualifications.deep_reply.selectable, true);
  assert.equal(deep.replyBrainQualified, false);
});

test('wrong-language or invented-fact evidence remains a hard block even for manual selection', () => {
  const model = authority.projectModel(runtimeModel({
    lastReplyBrainBenchmark: benchmark(75, {
      scenarios: [{ id: 'german_whatsapp', weight: 25, score: 0, pass: false, issues: [{ code: 'WRONG_LANGUAGE', message: 'wrong' }] }]
    })
  }));
  assert.equal(model.replyTaskQualifications.quick_reply.state, 'blocked');
  assert.equal(model.replyTaskQualifications.quick_reply.selectable, false);
  assert.ok(model.replyTaskQualifications.quick_reply.blockers.includes('WRONG_LANGUAGE'));
});

test('manual conditional route is rejected without an explicit conditional flag and accepted with it', () => {
  const model = runtimeModel();
  const rejected = routing.validateRoutes({
    deep_reply: { primary: model.id, primarySelection: 'manual', enabled: true, allowConditional: false }
  }, [model], { throwOnInvalid: false });
  assert.equal(rejected.repairedRoutes.deep_reply.primary, '');
  assert.equal(rejected.quarantine.length, 1);

  const accepted = routing.validateRoutes({
    deep_reply: { primary: model.id, primarySelection: 'manual', fallbackSelection: 'auto', enabled: true, allowConditional: true, humanReviewRequired: true }
  }, [model], { throwOnInvalid: true, autoSelect: true });
  assert.equal(accepted.repairedRoutes.deep_reply.primary, model.id);
  assert.equal(accepted.repairedRoutes.deep_reply.allowConditional, true);
  assert.equal(accepted.repairedRoutes.deep_reply.humanReviewRequired, true);
});

test('automatic reply routing resolves an actual conditional model and records why it was selected', () => {
  const qwen = runtimeModel({ id: 'qwen9', name: 'qwen3.5:9b', lastReplyBrainBenchmark: benchmark(60) });
  const gemma = runtimeModel({ id: 'gemma12', name: 'gemma3:12b', lastReplyBrainBenchmark: benchmark(70) });
  const resolved = routing.validateRoutes({
    quick_reply: { primarySelection: 'auto', fallbackSelection: 'auto', enabled: true, allowConditional: true }
  }, [qwen, gemma], { throwOnInvalid: true, autoSelect: true }).repairedRoutes.quick_reply;
  assert.ok(resolved.primary);
  assert.ok(resolved.fallback);
  assert.notEqual(resolved.primary, resolved.fallback);
  assert.equal(resolved.allowConditional, true);
  assert.equal(resolved.humanReviewRequired, true);
  assert.match(resolved.autoSelectionReason, /条件试运行|专项评估|门槛/u);
});

test('candidate generation remains blocked until director and commercial translation quality are both ready', () => {
  const translation = { id: 'tr', name: 'translategemma:4b', provider: 'ollama', qualification: 'verified', allowedTasks: ['translation'] };
  const quick = authority.projectModel(runtimeModel({ id: 'quick', name: 'qwen3.5:9b', lastReplyBrainBenchmark: benchmark(60) }));
  const deep = authority.projectModel(runtimeModel({ id: 'deep', name: 'gemma3:12b', lastReplyBrainBenchmark: benchmark(70) }));
  const routes = {
    translation: { primary: 'tr', enabled: true },
    quick_reply: { primary: 'quick', fallback: 'deep', enabled: true, allowConditional: true, humanReviewRequired: true },
    deep_reply: { primary: 'deep', fallback: 'quick', enabled: true, allowConditional: true, humanReviewRequired: true },
    director: { enabled: false }
  };
  const status = authority.evaluate([translation, quick, deep], routes);
  assert.equal(status.pass, false);
  assert.equal(status.candidateGenerationReady, false);
  assert.equal(status.conditional, false);
  assert.equal(status.state, 'REPLY_BRAIN_INCOMPLETE');
  assert.ok(status.missing.includes('导演主模型'));
  assert.ok(status.missing.includes('专用翻译主模型'));
  assert.ok(status.missing.includes('独立专用翻译备用模型'));
});

test('workbench exposes grouped manual selectors, auto explanation, and per-route real testing', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-ai-workbench-runtime.js'), 'utf8');
  assert.match(source, /正式合格/u);
  assert.match(source, /条件试运行/u);
  assert.match(source, /尚未完成评估，可人工试用/u);
  assert.match(source, /测试当前配置/u);
  assert.match(source, /routes\/\$\{encodeURIComponent\(r\.id\)\}\/test/u);
  assert.match(source, /primarySelection/u);
  assert.match(source, /fallbackSelection/u);
});

test('route test API and benchmark workflow are not blocked by the old base-qualification gate', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/models.js'), 'utf8');
  assert.match(source, /基础资格是诊断事实，不再阻止模型参加真正的聊天专项基准/u);
  assert.match(source, /router\.post\('\/routes\/:task\/test'/u);
  assert.match(source, /judgeRouteTest/u);
  assert.doesNotMatch(source, /REPLY_BRAIN_BASE_QUALIFICATION_FAILED/u);
});


test('manual and automatic conditional reply routes persist atomically in a real isolated SQLite registry', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-ai-route-sqlite-'));
  const script = String.raw`
const registry = require('./backend/services/modelRegistry');
const { closeR32Store } = require('./backend/lib/r32StoreSingleton');
(async () => {
  const now = new Date().toISOString();
  const benchmark = score => ({ authority: 'YanceReplyBrainBenchmark', status: 'REPLY_BRAIN_FAILED', completed: true, pass: false, score, testedAt: now, qualifyingTasks: [], scenarios: [] });
  await registry.write({ schemaVersion: 1, models: [
    { id: 'ministral', name: 'ministral-3:14b', provider: 'ollama', available: true, qualification: 'verified', allowedTasks: ['understanding'], callCount: 29, lastSuccessfulInvocation: { at: now } },
    { id: 'gemma', name: 'gemma3:12b', provider: 'ollama', available: true, qualification: 'verified', allowedTasks: ['understanding'], lastReplyBrainBenchmark: benchmark(70), callCount: 4, lastSuccessfulInvocation: { at: now } },
    { id: 'qwen', name: 'qwen3.5:9b', provider: 'ollama', available: true, qualification: 'verified', allowedTasks: ['understanding'], lastReplyBrainBenchmark: benchmark(60), callCount: 13, lastSuccessfulInvocation: { at: now } }
  ], routes: {}, history: [] });
  await registry.setRoutes({
    quick_reply: { primary: 'qwen', fallback: 'gemma', primarySelection: 'manual', fallbackSelection: 'manual', enabled: true, allowConditional: true, humanReviewRequired: true, maxTokens: 220 },
    deep_reply: { primary: 'ministral', fallback: 'gemma', primarySelection: 'manual', fallbackSelection: 'manual', enabled: true, allowConditional: true, humanReviewRequired: true, maxTokens: 480 }
  });
  const manual = registry.read();
  if (manual.routes.quick_reply.primary !== 'qwen' || manual.routes.deep_reply.primary !== 'ministral') throw new Error('MANUAL_ROUTE_PERSISTENCE_FAILED');
  if (manual.routes.deep_reply.allowConditional !== true || manual.routes.deep_reply.humanReviewRequired !== true) throw new Error('CONDITIONAL_ROUTE_FLAGS_FAILED');
  await registry.setRoutes({
    quick_reply: { primarySelection: 'auto', fallbackSelection: 'auto', enabled: true, allowConditional: true, humanReviewRequired: true, maxTokens: 220 },
    deep_reply: { primarySelection: 'auto', fallbackSelection: 'auto', enabled: true, allowConditional: true, humanReviewRequired: true, maxTokens: 480 }
  });
  const automatic = registry.read();
  for (const task of ['quick_reply', 'deep_reply']) {
    const route = automatic.routes[task];
    if (!route.primary || !route.fallback || route.primary === route.fallback) throw new Error('AUTO_ROUTE_RESOLUTION_FAILED:' + task);
    if (!route.autoSelectionReason) throw new Error('AUTO_ROUTE_REASON_MISSING:' + task);
  }
  closeR32Store();
})().catch(error => { console.error(error); try { closeR32Store(); } catch {} process.exit(1); });`;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '../..'),
    env: { ...process.env, YANCE_DATA_DIR: dataRoot, TERM: 'dumb' },
    encoding: 'utf8',
    timeout: 120000
  });
  try {
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
