'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const routing = require('../services/modelRoutingIntegrityService');
const authority = require('../services/replyBrainModelAuthority');

function pendingModel(overrides = {}) {
  return {
    id: 'ministral',
    name: 'ministral-3:14b',
    provider: 'ollama',
    available: true,
    qualification: 'verified',
    allowedTasks: ['understanding'],
    callCount: 29,
    lastSuccessfulInvocation: { at: new Date().toISOString() },
    ...overrides
  };
}

test('user activation intent remains enabled while an auto route is waiting for a usable model', () => {
  const repaired = routing.validateRoutes({
    quick_reply: {
      primarySelection: 'auto',
      fallbackSelection: 'auto',
      requestedEnabled: true,
      enabled: true,
      allowConditional: true,
      maxTokens: 220
    }
  }, [], { throwOnInvalid: true, autoSelect: true }).repairedRoutes.quick_reply;

  assert.equal(repaired.requestedEnabled, true);
  assert.equal(repaired.enabled, true);
  assert.equal(repaired.operational, false);
  assert.equal(repaired.primary, '');
});

test('automatic recommendation never turns off a route the user explicitly enabled', () => {
  const existing = {
    quick_reply: {
      primarySelection: 'auto',
      fallbackSelection: 'auto',
      requestedEnabled: true,
      enabled: true,
      allowConditional: true
    }
  };
  const recommendation = authority.recommendedReplyRoutes([], existing);
  assert.equal(recommendation.routes.quick_reply.requestedEnabled, true);
  assert.equal(recommendation.routes.quick_reply.enabled, true);
  assert.equal(recommendation.routes.quick_reply.operational, false);
  assert.equal(recommendation.routes.quick_reply.primary, '');
});

test('automatic recommendation respects an explicit user stop', () => {
  const model = pendingModel();
  const existing = {
    deep_reply: {
      primarySelection: 'auto',
      fallbackSelection: 'auto',
      requestedEnabled: false,
      enabled: false,
      allowConditional: true
    }
  };
  const recommendation = authority.recommendedReplyRoutes([model], existing);
  assert.equal(recommendation.routes.deep_reply.requestedEnabled, false);
  assert.equal(recommendation.routes.deep_reply.enabled, false);
});

test('frontend separates saved activation from operational readiness and protects unsaved drafts', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-ai-workbench-runtime.js'), 'utf8');
  assert.match(source, /requestedEnabled:r\.enabled!==false/u);
  assert.match(source, /activationState=!requestedEnabled\?'disabled':resilient\?'resilient':operational\?'primary-only':'waiting-model'/u);
  assert.match(source, /期望启用，但路由未就绪/u);
  assert.match(source, /主模型可运行，但缺少合格独立备用模型/u);
  assert.match(source, /routeDraftDirty/u);
  assert.match(source, /if\(!\(state\.tab==='routing'&&state\.routeDraftDirty\)\)\{[^}]*state\.routes=registryRoutes/u);
});

test('real SQLite keeps the enabled intent through an empty recommendation pass', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-route-activation-'));
  const script = String.raw`
const registry = require('./backend/services/modelRegistry');
const authority = require('./backend/services/replyBrainModelAuthority');
const { closeR32Store } = require('./backend/lib/r32StoreSingleton');
(async () => {
  await registry.write({ schemaVersion: 3, models: [], routes: {}, history: [] });
  await registry.setRoutes({
    quick_reply: { primarySelection: 'auto', fallbackSelection: 'auto', requestedEnabled: true, enabled: true, allowConditional: true, maxTokens: 220 }
  });
  let state = registry.read();
  if (state.routes.quick_reply.requestedEnabled !== true || state.routes.quick_reply.enabled !== true) throw new Error('ACTIVATION_NOT_SAVED');
  const recommendation = authority.recommendedReplyRoutes(state.models, state.routes);
  await registry.applyRecommendedReplyBrainRoutes(recommendation.routes);
  state = registry.read();
  if (state.routes.quick_reply.requestedEnabled !== true) throw new Error('ACTIVATION_INTENT_LOST');
  if (state.routes.quick_reply.enabled !== true) throw new Error('ROUTE_REDISABLED');
  if (state.routes.quick_reply.operational !== false) throw new Error('EMPTY_ROUTE_MARKED_OPERATIONAL');
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
