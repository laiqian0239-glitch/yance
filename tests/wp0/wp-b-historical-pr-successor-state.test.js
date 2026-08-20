'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const m2 = require('../../tools/architecture-closure-v2/verify-wp-b-m2-review');
const m3 = require('../../tools/architecture-closure-v2/verify-wp-b-m3-authorization');

const HISTORICAL_BRANCH = 'acv2/wp-b-durable-execution-outbox';
const SUCCESSOR_BRANCH = 'product/acv2-wp-b-platform-accepted-local-repair-p0';
const MERGED_AT = '2026-08-18T11:20:20Z';

const CASES = Object.freeze([
  Object.freeze({
    name: 'historical branch accepts only its Draft/open/unmerged PR',
    branch: HISTORICAL_BRANCH,
    pr: Object.freeze({ state: 'open', draft: true, merged_at: null }),
    expected: true
  }),
  Object.freeze({
    name: 'historical branch cannot be reactivated by its merged PR',
    branch: HISTORICAL_BRANCH,
    pr: Object.freeze({ state: 'closed', draft: true, merged_at: MERGED_AT }),
    expected: false
  }),
  Object.freeze({
    name: 'successor accepts immutable merged historical evidence even when GitHub retains draft metadata',
    branch: SUCCESSOR_BRANCH,
    pr: Object.freeze({ state: 'closed', draft: true, merged_at: MERGED_AT }),
    expected: true
  }),
  Object.freeze({
    name: 'successor also accepts an historical PR that still remains Draft/open/unmerged',
    branch: SUCCESSOR_BRANCH,
    pr: Object.freeze({ state: 'open', draft: true, merged_at: null }),
    expected: true
  }),
  Object.freeze({
    name: 'successor rejects closed-but-unmerged historical evidence',
    branch: SUCCESSOR_BRANCH,
    pr: Object.freeze({ state: 'closed', draft: true, merged_at: null }),
    expected: false
  }),
  Object.freeze({
    name: 'successor rejects an open historical PR that is no longer Draft',
    branch: SUCCESSOR_BRANCH,
    pr: Object.freeze({ state: 'open', draft: false, merged_at: null }),
    expected: false
  }),
  Object.freeze({
    name: 'successor rejects contradictory open-and-merged historical state',
    branch: SUCCESSOR_BRANCH,
    pr: Object.freeze({ state: 'open', draft: true, merged_at: MERGED_AT }),
    expected: false
  }),
  Object.freeze({
    name: 'successor rejects an unrelated or missing historical PR shape',
    branch: SUCCESSOR_BRANCH,
    pr: Object.freeze({}),
    expected: false
  })
]);

for (const [label, verifier] of [
  ['M2', m2],
  ['M3', m3]
]) {
  test(`${label} historical PR state classifier preserves fail-closed successor semantics`, () => {
    assert.equal(typeof verifier.isHistoricalPrStateValidForBranch, 'function');
    for (const entry of CASES) {
      assert.equal(
        verifier.isHistoricalPrStateValidForBranch(entry.pr, entry.branch, HISTORICAL_BRANCH),
        entry.expected,
        entry.name
      );
    }
  });
}

test('M2 and M3 classifiers stay behaviorally identical for the complete state matrix', () => {
  for (const entry of CASES) {
    const m2Result = m2.isHistoricalPrStateValidForBranch(entry.pr, entry.branch, HISTORICAL_BRANCH);
    const m3Result = m3.isHistoricalPrStateValidForBranch(entry.pr, entry.branch, HISTORICAL_BRANCH);
    assert.equal(m2Result, m3Result, entry.name);
  }
});
