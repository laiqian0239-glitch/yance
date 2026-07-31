'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const governance = require('../services/memoryEvidenceGovernanceService');

function fact(overrides = {}) {
  return {
    id: 'fact-age-65', key: 'age', value: '65', status: 'confirmed', factClass: 'explicit', confidence: 100,
    evidence: [{ messageId: 'm1', platformMessageId: 'm1', sourceText: 'Bin 65', direction: 'inbound', speaker: 'peer' }],
    ...overrides
  };
}

test('verified explicit facts are reply eligible while inferences, missing evidence and forgotten rows are blocked', () => {
  const rows = [
    fact(),
    fact({ id: 'inference', key: 'trait', value: '喜欢户外', status: 'inferred', factClass: 'inference', confidence: 70 }),
    fact({ id: 'missing', key: 'country', value: '奥地利', evidence: [], evidenceStatus: 'missing' }),
    fact({ id: 'forgotten', key: 'job', value: '教师', status: 'forgotten', allowInReply: false })
  ];
  assert.deepEqual(governance.selectReplyFacts(rows, { now: '2026-07-25T00:00:00.000Z', cooldownMs: 0 }).map(row => row.id), ['fact-age-65']);
});

test('new explicit single-value fact supersedes the old value but preserves history', () => {
  const merged = governance.mergeFacts(
    [fact({ id: 'age-64', value: '64', confirmedAt: '2026-07-20T00:00:00.000Z' })],
    [fact({ id: 'age-65', value: '65', confirmedAt: '2026-07-25T00:00:00.000Z' })],
    { now: '2026-07-25T00:00:00.000Z' }
  );
  const old = merged.find(row => row.id === 'age-64');
  const current = merged.find(row => row.id === 'age-65');
  assert.equal(old.status, 'superseded');
  assert.equal(old.allowInReply, false);
  assert.equal(old.supersededBy, 'age-65');
  assert.equal(current.status, 'confirmed');
  assert.equal(current.allowInReply, true);
});

test('forget and correct operations are auditable and never silently erase evidence', () => {
  const forgotten = governance.forgetFact([fact()], 'fact-age-65', { now: '2026-07-25T01:00:00.000Z', actor: 'user' });
  assert.equal(forgotten[0].status, 'forgotten');
  assert.equal(forgotten[0].forgottenBy, 'user');
  assert.equal(forgotten[0].evidence.length, 1);

  const corrected = governance.correctFact([fact()], 'fact-age-65', fact({ id: 'fact-age-66', value: '66' }), { now: '2026-07-25T02:00:00.000Z' });
  assert.equal(corrected.find(row => row.id === 'fact-age-65').status, 'superseded');
  assert.equal(corrected.find(row => row.id === 'fact-age-66').correctionOf, 'fact-age-65');
});

test('reply cooldown prevents repeatedly citing the same personal fact', () => {
  const rows = [fact({ lastUsedInReplyAt: '2026-07-25T00:30:00.000Z' })];
  assert.equal(governance.selectReplyFacts(rows, { now: '2026-07-25T01:00:00.000Z', cooldownMs: 6 * 60 * 60 * 1000 }).length, 0);
  assert.equal(governance.selectReplyFacts(rows, { now: '2026-07-25T08:00:00.000Z', cooldownMs: 6 * 60 * 60 * 1000 }).length, 1);
});
