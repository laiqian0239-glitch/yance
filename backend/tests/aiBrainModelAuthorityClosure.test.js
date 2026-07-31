'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const authority = require('../services/replyBrainModelAuthority');
const routing = require('../services/modelRoutingIntegrityService');
const { aiRoutingReadiness } = require('../services/diagnosticReadiness');

function qualifiedModel(id, name, parameterSize = '14B') {
  return {
    id, name, provider: 'ollama', available: true, qualification: 'verified', parameterSize,
    allowedTasks: ['general', 'quick_reply', 'deep_reply', 'director', 'quality_review'],
    lastTest: { scores: { persona: { pass: true }, hallucination: { pass: true }, json: { pass: true } } },
    lastSuccessfulInvocation: { at: new Date().toISOString() },
    lastReplyBrainBenchmark: { authority: 'YanceReplyBrainBenchmark', status: 'REPLY_BRAIN_QUALIFIED', pass: true, score: 92, testedAt: new Date().toISOString(), qualifyingTasks: ['quick_reply', 'deep_reply', 'director'], scenarios: [] }
  };
}

test('translation and coder models can never qualify as reply brains', () => {
  for (const model of [
    { ...qualifiedModel('t', 'translategemma:4b', '4B'), allowedTasks: ['translation'] },
    { ...qualifiedModel('c', 'qwen-coder:14b', '14B') }
  ]) {
    const row = authority.projectModel(model);
    assert.equal(row.replyBrainQualified, false);
    assert.equal(routing.modelTaskPolicyAllows(model, 'quick_reply'), false);
  }
});

test('a stronger verified chat model ranks ahead of a small chat model for live replies', () => {
  const small = qualifiedModel('small', 'qwen3:5.9b', '5.9B');
  const strong = qualifiedModel('strong', 'ministral-3:14b', '14B');
  assert.ok(authority.replyBrainScore(strong) > authority.replyBrainScore(small));
  assert.ok(routing.routeCandidateScore(strong, 'quick_reply') > routing.routeCandidateScore(small, 'quick_reply'));
});

test('reply brain readiness requires primary and fallback chat models plus director and translation', () => {
  const main = authority.projectModel(qualifiedModel('main', 'ministral-3:14b', '14B'));
  const backup = authority.projectModel(qualifiedModel('backup', 'gemma3:12b', '12B'));
  const translation = authority.projectModel({
    id: 'translation', name: 'translator-free', provider: 'openrouter', qualification: 'verified',
    allowedTasks: ['translation'],
    lastCommercialBenchmark: { completed: true, pass: true, qualifyingTasks: ['translation'], translationScore: 92 }
  });
  const translationBackup = authority.projectModel({
    id: 'translation-backup', name: 'translator-backup', provider: 'openrouter', qualification: 'verified',
    allowedTasks: ['translation'],
    lastCommercialBenchmark: { completed: true, pass: true, qualifyingTasks: ['translation'], translationScore: 90 }
  });
  const routes = {
    quick_reply: { primary: 'main', fallback: 'backup', enabled: true },
    deep_reply: { primary: 'main', fallback: 'backup', enabled: true },
    director: { primary: 'main', fallback: 'backup', enabled: true },
    translation: { primary: 'translation', fallback: 'translation-backup', enabled: true }
  };
  const result = authority.evaluate([main, backup, translation, translationBackup], routes);
  assert.equal(result.pass, true);
  assert.equal(aiRoutingReadiness({ models: [main, backup, translation, translationBackup], routes }).pass, true);
  delete routes.quick_reply.fallback;
  assert.equal(authority.evaluate([main, backup, translation, translationBackup], routes).pass, false);
});

test('audit requires disable-first review before a historically used non-chat model can be removed', () => {
  const coder = { id: 'coder', name: 'deepseek-coder:6.7b', provider: 'ollama', qualification: 'verified', allowedTasks: ['general'], callCount: 4 };
  const row = authority.audit([coder], {}).models[0];
  assert.equal(row.recommendation.action, 'disable');
  assert.equal(row.recommendation.removable, true);
  assert.match(row.recommendation.label, /曾有历史调用/);
});

test('benchmark recommendation selects the strongest qualified model and an independent fallback', () => {
  const main = authority.projectModel(qualifiedModel('main', 'ministral-3:14b', '14B'));
  const backup = authority.projectModel({ ...qualifiedModel('backup', 'gemma3:12b', '12B'), lastReplyBrainBenchmark: { authority: 'YanceReplyBrainBenchmark', status: 'REPLY_BRAIN_QUALIFIED', pass: true, score: 86, testedAt: new Date().toISOString() } });
  const failed = authority.projectModel({ ...qualifiedModel('failed', 'qwen3:5.9b', '5.9B'), lastReplyBrainBenchmark: { authority: 'YanceReplyBrainBenchmark', status: 'REPLY_BRAIN_FAILED', pass: false, score: 62, testedAt: new Date().toISOString() } });
  const recommendation = authority.recommendedReplyRoutes([backup, failed, main], { translation: { primary: 'translation', enabled: true } });
  assert.equal(recommendation.main.id, 'main');
  assert.equal(recommendation.backup.id, 'backup');
  assert.equal(recommendation.routes.quick_reply.primary, 'main');
  assert.equal(recommendation.routes.quick_reply.fallback, 'backup');
  assert.equal(recommendation.routes.translation.primary, 'translation');
  assert.equal(recommendation.candidates.some(row => row.id === 'failed'), false, 'conditional models never enter automatic recommendation candidates');
  assert.equal(recommendation.selections.quick_reply.manualTrialCandidates.some(row => row.id === 'failed'), true);
  assert.equal(recommendation.selections.quick_reply.manualTrialCandidates.find(row => row.id === 'failed').qualification.state, 'conditional');
  assert.notEqual(recommendation.main.id, 'failed');
  assert.notEqual(recommendation.backup.id, 'failed');
});
