'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const projection = require('../../backend/services/modelStatusProjection');
const authority = require('../../backend/services/modelRuntimeAuthority');

function cloud(overrides = {}) {
  return {
    id: 'cloud-main',
    name: 'gpt-4o-mini',
    provider: 'openai-compatible',
    configured: true,
    available: true,
    endpoint: 'https://example.invalid/v1',
    credentialRef: 'model:cloud-main',
    qualification: 'verified',
    allowedTasks: ['quick_reply', 'deep_reply', 'director'],
    lastTest: { testedAt: '2026-07-22T01:00:00.000Z', connectivity: { pass: true, status: 200 }, scores: { persona: { pass: true }, hallucination: { pass: true }, json: { pass: true } } },
    lastReplyBrainBenchmark: { authority: 'YanceReplyBrainBenchmark', status: 'REPLY_BRAIN_QUALIFIED', pass: true, score: 90, testedAt: '2026-07-22T01:00:00.000Z' },
    ...overrides
  };
}

const options = { credentialReady: () => true };

test('verified and routed model without a business success has one VERIFIED_NOT_CALLED state', () => {
  const result = projection.project({
    models: [cloud()],
    routes: { quick_reply: { primary: 'cloud-main', fallback: '', enabled: true } }
  }, options).models[0];
  assert.equal(result.runtimeState, authority.STATES.verifiedNotCalled);
  assert.equal(result.runtimeStateLabel, '资格通过，等待首次业务调用');
  assert.equal(result.routeAssigned, true);
  assert.equal(result.routingEligible, true);
  assert.equal(result.lastSuccessfulInvocation, null);
  assert.doesNotMatch(result.userSummary, /可参与路由.*尚未实际成功调用/u);
});

test('later 429 failure retains last success and becomes DEGRADED_WITH_FALLBACK with one Chinese error', () => {
  const result = projection.project({
    models: [
      cloud({
        lastSuccessfulInvocation: { at: '2026-07-22T01:02:00.000Z', returnedModel: 'gpt-4o-mini' },
        lastInvocationStatus: 'failed',
        lastInvocationAt: '2026-07-22T01:05:00.000Z',
        lastInvocationError: 'Rate limit reached for requests. Please check your plan and billing details.',
        lastInvocationErrorCode: 'rate_limit_exceeded',
        lastInvocationHttpStatus: 429
      }),
      cloud({ id: 'cloud-backup', name: 'backup', credentialRef: 'model:backup' })
    ],
    routes: { quick_reply: { primary: 'cloud-main', fallback: 'cloud-backup', enabled: true } }
  }, options).models.find(row => row.id === 'cloud-main');
  assert.equal(result.runtimeState, authority.STATES.degradedWithFallback);
  assert.equal(result.hasRetainedSuccess, true);
  assert.equal(result.currentFailure.userMessage, '请求过于频繁或额度受限，请稍后重试或检查配额。');
  assert.match(result.userSummary, /备用路由|已保留最后一次成功结果/u);
  assert.equal(result.currentFailure.technicalMessage.includes('Rate limit'), true);
});

test('failed qualification cannot remain routing eligible even when a stale route references the model', () => {
  const result = projection.project({
    models: [cloud({
      qualification: 'failed',
      lastTest: { testedAt: '2026-07-22T01:00:00.000Z', connectivity: { pass: false, status: 401, code: 'invalid_api_key', error: 'API key invalid' } }
    })],
    routes: { quick_reply: { primary: 'cloud-main', fallback: '', enabled: true } }
  }, options).models[0];
  assert.equal(result.runtimeState, authority.STATES.unavailable);
  assert.equal(result.routingEligible, false);
  assert.equal(result.qualificationFailure.userMessage, '模型凭据无效或权限不足，请重新验证安全凭据。');
});

test('successful business invocation clears current failure and produces AVAILABLE', () => {
  const result = projection.project({
    models: [cloud({
      lastSuccessfulInvocation: { at: '2026-07-22T01:10:00.000Z', returnedModel: 'gpt-4o-mini' },
      lastInvocationStatus: 'success',
      lastInvocationAt: '2026-07-22T01:10:00.000Z',
      callCount: 2
    })],
    routes: { quick_reply: { primary: 'cloud-main', fallback: '', enabled: true } }
  }, options).models[0];
  assert.equal(result.runtimeState, authority.STATES.available);
  assert.equal(result.currentFailure, null);
  assert.equal(result.routingEligible, true);
  assert.equal(result.runtimeAvailable, true);
});

test('summary counts authoritative runtime states instead of mixing qualification and invocation facts', () => {
  const result = projection.project({
    models: [
      cloud(),
      cloud({ id: 'available', name: 'available', credentialRef: 'model:available', lastSuccessfulInvocation: { at: '2026-07-22T01:10:00.000Z' }, lastInvocationStatus: 'success' }),
      cloud({ id: 'failed', name: 'failed', credentialRef: 'model:failed', qualification: 'failed', lastTest: { connectivity: { pass: false, status: 401, code: 'invalid_api_key', error: 'bad key' } } })
    ],
    routes: {
      quick_reply: { primary: 'cloud-main', fallback: 'available', enabled: true },
      deep_reply: { primary: 'available', fallback: '', enabled: true },
      summary: { primary: 'failed', fallback: '', enabled: true }
    }
  }, options);
  assert.equal(result.authority, 'ModelRuntimeAuthority');
  assert.equal(result.summary.verifiedNotCalled, 1);
  assert.equal(result.summary.available, 1);
  assert.equal(result.summary.unavailable, 1);
  assert.equal(result.summary.routingEligible, 2);
});

test('AI workbench consumes the authority state and no longer composes contradictory labels', () => {
  const root = path.resolve(__dirname, '../..');
  const source = fs.readFileSync(path.join(root, 'frontend/js/r32-ai-workbench-runtime.js'), 'utf8');
  assert.match(source, /runtimeStateLabel/u);
  assert.match(source, /currentFailure\|\|m\.qualificationFailure/u);
  assert.match(source, /技术详情/u);
  assert.doesNotMatch(source, /'尚未实际成功调用'/u);
  assert.doesNotMatch(source, /可参与路由/u);
  assert.doesNotMatch(source, /当前失败：/u);
});
