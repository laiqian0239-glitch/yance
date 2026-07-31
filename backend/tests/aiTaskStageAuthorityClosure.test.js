'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const authority = require('../services/aiTaskStageAuthority');

function allModelsFailed() {
  const error = new Error('ALL_MODELS_FAILED');
  error.code = 'ALL_MODELS_FAILED';
  error.attempts = [
    { modelId: 'main', model: 'ministral-3:14b', status: 'failed', code: 'MODEL_TIMEOUT', message: 'request timeout' },
    { modelId: 'backup', model: 'gemma3:12b', status: 'failed', code: 'RATE_LIMITED', message: 'HTTP 429 quota exceeded', httpStatus: 429 }
  ];
  return error;
}

test('all-model failure is projected as Chinese candidate-stage evidence with model attempts', () => {
  const projected = authority.projectFailure(allModelsFailed(), {
    stage: 'candidate_generation',
    task: 'quick_reply',
    priorStages: [{ stage: 'understanding', label: '消息理解', status: 'completed' }]
  });
  assert.equal(projected.code, 'ALL_MODELS_FAILED');
  assert.equal(projected.stageLabel, '候选生成');
  assert.match(projected.messageZh, /已尝试 2 个模型/u);
  assert.deepEqual(projected.attemptedModels, ['ministral-3:14b', 'gemma3:12b']);
  assert.match(projected.attempts[0].messageZh, /超时/u);
  assert.match(projected.attempts[1].messageZh, /额度|频繁/u);
  assert.equal(projected.fallbackAttempted, true);
  assert.equal(projected.retryable, true);
});

test('failure attachment preserves a safe stage projection without replacing the technical code', () => {
  const error = allModelsFailed();
  authority.attachFailure(error, { stage: 'merge', task: 'deep_reply' });
  assert.equal(error.code, 'ALL_MODELS_FAILED');
  assert.equal(error.stage, 'merge');
  assert.equal(error.aiStageFailure.stageLabel, '候选综合');
  assert.doesNotMatch(error.userMessageZh, /\[object Object\]/u);
});

test('qualification and credential failures receive actionable Chinese messages', () => {
  assert.match(authority.userMessageZh({ code: 'NO_QUALIFIED_MODEL' }), /资格|模型调用失败/u);
  assert.match(authority.userMessageZh({ code: 'CREDENTIAL_REQUIRED', status: 401 }), /凭据|权限/u);
  assert.match(authority.userMessageZh({ code: 'MODEL_CIRCUIT_OPEN' }), /熔断/u);
});
