'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const authority = require('../services/replyBrainModelAuthority');

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
