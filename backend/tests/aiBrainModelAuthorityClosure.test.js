'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const authority = require('../services/replyBrainModelAuthority');
const routing = require('../services/modelRoutingIntegrityService');

function qualifiedModel(id, name, parameterSize = '14B', provider = 'ollama', modelSlug = '') {
  return {
    id, name, provider, modelSlug, available: true, qualification: 'verified', parameterSize,
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
