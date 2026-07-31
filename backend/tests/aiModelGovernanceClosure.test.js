'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeModelError, createAllModelsFailedError } = require('../services/modelErrorNormalizer');
const modelStatusProjection = require('../services/modelStatusProjection');
const { AiGateway } = require('../services/aiGateway');
const runtimeErrors = require('../../frontend/js/r32-runtime-errors.js');

const root = path.resolve(__dirname, '../..');

test('nested structured model errors never degrade to object stringification', () => {
  const payload = {
    response: {
      status: 429,
      data: {
        error: [{ code: 'rate_limit_exceeded', detail: { message: '请求过于频繁，请稍后重试' } }]
      }
    }
  };
  const normalized = normalizeModelError(payload);
  assert.equal(normalized.message, '请求过于频繁，请稍后重试');
  assert.equal(normalized.code, 'rate_limit_exceeded');
  assert.equal(normalized.status, 429);
  assert.doesNotMatch(normalized.message, /\[object Object\]/u);
  assert.equal(runtimeErrors.cleanText(payload, '模型调用失败'), '请求过于频繁，请稍后重试');
  const wrapped = new Error('[object Object]');
  wrapped.payload = payload;
  assert.equal(runtimeErrors.cleanText(wrapped, '模型调用失败'), '请求过于频繁，请稍后重试');
  const created = runtimeErrors.createError(payload, { status: 429, fallback: '模型调用失败' });
  assert.equal(created.message, '请求过于频繁，请稍后重试');
  assert.equal(created.code, 'rate_limit_exceeded');
});

test('model status projection retains last successful invocation after a later failure', () => {
  const projected = modelStatusProjection.normalizeModel({
    id: 'cloud-1',
    provider: 'openai-compatible',
    configured: true,
    available: true,
    endpoint: 'https://example.invalid/v1',
    name: 'reply-model',
    credentialRef: 'vault:model',
    qualification: 'verified',
    allowedTasks: ['quick_reply'],
    lastSuccessfulInvocation: {
      at: '2026-07-22T01:00:00.000Z',
      latencyMs: 230,
      returnedModel: 'reply-model'
    },
    lastAttemptStatus: 'failed',
    lastFailedAt: '2026-07-22T01:05:00.000Z',
    lastError: { error: { message: '临时网关故障', code: 'gateway_error' } },
    lastErrorCode: 'gateway_error',
    lastHttpStatus: 502,
    lastTest: { connectivity: { pass: true, status: 200 } }
  }, {}, { credentialReady: () => true, routedTasks: ['quick_reply'] });
  assert.equal(projected.hasRetainedSuccess, true);
  assert.equal(projected.lastSuccessfulInvocation.returnedModel, 'reply-model');
  assert.equal(projected.lastTestError, '临时网关故障');
  assert.doesNotMatch(projected.lastTestError, /\[object Object\]/u);
  assert.equal(projected.runtimeState, modelStatusProjection.STATES.temporarilyBlocked);
  assert.equal(projected.runtimeStateLabel, '最近调用失败，暂时不可用');
  assert.match(projected.userSummary, /已保留最后一次成功结果/u);
});

test('gateway reports every circuit-open route instead of returning an opaque final error', async () => {
  const gateway = new AiGateway();
  gateway.resolveRoute = () => ({
    task: 'quick_reply',
    route: {},
    primary: { id: 'local-1', name: 'Local One' },
    fallback: { id: 'cloud-1', name: 'Cloud One' }
  });
  gateway.isCircuitOpen = () => true;
  await assert.rejects(
    gateway._run({ jobId: 'job-circuit', task: 'quick_reply', messages: [], signal: new AbortController().signal }),
    error => {
      assert.equal(error.code, 'ALL_MODELS_FAILED');
      assert.equal(error.attempts.length, 2);
      assert.deepEqual(error.attempts.map(row => row.status), ['circuit_open', 'circuit_open']);
      assert.match(error.message, /已尝试 2 个模型/u);
      return true;
    }
  );
});

test('aggregate failure exposes normalized attempt evidence', () => {
  const error = createAllModelsFailedError([
    { modelId: 'a', model: 'A', status: 'failed', code: 'timeout', message: '请求超时', httpStatus: 504 },
    { modelId: 'b', model: 'B', status: 'failed', code: 'quota', message: '额度不足', httpStatus: 429 }
  ]);
  assert.equal(error.code, 'ALL_MODELS_FAILED');
  assert.equal(error.status, 429);
  assert.equal(error.attempts[0].modelId, 'a');
  assert.match(error.message, /额度不足/u);
});

test('AI workbench normalizes model errors and labels retained success', () => {
  const source = fs.readFileSync(path.join(root, 'frontend/js/r32-ai-workbench-runtime.js'), 'utf8');
  assert.match(source, /m\.currentFailure\|\|m\.qualificationFailure/u);
  assert.match(source, /runtimeStateLabel/u);
  assert.match(source, /技术详情/u);
  assert.match(source, /YanceRuntimeErrors\?\.createError/u);
  assert.doesNotMatch(source, /尚未实际成功调用/u);
  assert.doesNotMatch(source, /可参与路由/u);
});

test('AI task context rejects stale results when the same conversation advances to a newer generation', () => {
  const gateway = new AiGateway();
  const first = gateway.registerTaskContext('job-old', 'quick_reply', {
    platform: 'facebook', sourceAccountId: 'page-1', sessionKey: 'session-kurt',
    generation: 'message-10', scopeKey: 'reply:kurt:session-kurt'
  });
  gateway.assertTaskContextCurrent(first);
  const latest = gateway.registerTaskContext('job-new', 'quick_reply', {
    platform: 'facebook', sourceAccountId: 'page-1', sessionKey: 'session-kurt',
    generation: 'message-11', scopeKey: 'reply:kurt:session-kurt'
  });
  gateway.assertTaskContextCurrent(latest);
  assert.throws(() => gateway.assertTaskContextCurrent(first), error => error.code === 'AI_STALE_RESULT');
  assert.equal(gateway.status().taskContexts.find(row => row.scopeKey === 'reply:kurt:session-kurt').generation, 'message-11');
});

test('AI task context preserves platform, account, session and request evidence', () => {
  const normalized = require('../services/aiGateway').normalizeTaskContext({
    platform: 'Facebook', accountId: 'page-1', conversationId: 'session-kurt', requestId: 'request-1', analysisGeneration: 7
  }, 'director');
  assert.deepEqual(normalized, {
    platform: 'facebook', sourceAccountId: 'page-1', sessionKey: 'session-kurt', requestId: 'request-1', generation: '7',
    scopeKey: 'facebook|page-1|session-kurt|director', contactId: '', conversationId: 'session-kurt', runtimeBuild: '', modelRouteVersion: ''
  });
});
