'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const authority = require('../../frontend/js/r32-ai-business-presentation-authority');

const repoRoot = path.resolve(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('structured analysis becomes readable Chinese business lines instead of JSON or object strings', () => {
  const value = {
    main_topics: ['Verantwortung übernehmen', 'Klare Ziele setzen'],
    key_insights: ['偏好高效沟通', '重视明确约定'],
    personality_traits: ['direct', 'zielorientiert']
  };
  const lines = authority.summaryLines(value);
  const text = authority.summaryText(value);
  assert.ok(lines.some(row => /主要话题/u.test(row)));
  assert.ok(lines.some(row => /重要洞察/u.test(row)));
  assert.doesNotMatch(text, /\[object Object\]|\{"|"main_topics"/u);
});

test('ALL_MODELS_FAILED becomes Chinese stage failure with visible attempt chain', () => {
  const error = new Error('ALL_MODELS_FAILED');
  error.code = 'ALL_MODELS_FAILED';
  error.payload = {
    aiFailure: {
      code: 'ALL_MODELS_FAILED',
      stage: 'candidate_generation',
      stageLabel: '候选生成',
      messageZh: '候选生成失败：已尝试 2 个模型，均未完成任务',
      fallbackAttempted: true,
      attempts: [
        { model: 'ministral-3:14b', statusLabel: '失败', messageZh: '模型响应超时', code: 'MODEL_TIMEOUT' },
        { model: 'gemma3:12b', statusLabel: '失败', messageZh: '请求过于频繁或当前额度不足', code: 'RATE_LIMITED' }
      ]
    }
  };
  const projected = authority.failureProjection(error, { priorStages: [{ label: '消息理解', status: 'completed' }] });
  assert.match(projected.text, /候选生成失败/u);
  assert.equal(projected.attempts.length, 2);
  assert.equal(projected.fallbackAttempted, true);
  assert.doesNotMatch(projected.text, /^ALL_MODELS_FAILED$/u);
});

test('formal runtime loads AI presentation authority and shows stage/model evidence', () => {
  const index = read('frontend/index.html');
  const runtime = read('frontend/js/r32-ui-runtime.js');
  const server = read('backend/server.js');
  const brain = read('backend/services/contextAwareReplyBrain.js');
  assert.ok(index.indexOf('/js/r32-ai-business-presentation-authority.js') < index.indexOf('/js/r32-ui-runtime.js'));
  assert.match(runtime, /candidate-stage-failure/u);
  assert.match(runtime, /本次模型尝试/u);
  assert.match(runtime, /实际模型与回退链/u);
  assert.match(runtime, /aiSummaryText\(analysis\.summary\|\|analysis\.intent/u);
  assert.match(server, /aiFailure/u);
  assert.match(brain, /aiTaskStageAuthority\.attachFailure/u);
  assert.match(brain, /modelAttempts: Array\.isArray\(modelResult\.attempts\)/u);
});
